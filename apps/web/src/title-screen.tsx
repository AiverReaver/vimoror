/**
 * The front door: an authored buffer, a real `VimEngine`, and no simulated
 * anything.
 *
 * **The engine's own command line is the shell's command line.** That is
 * M4-PLAN.md's fact 1 and the one design rule this file exists to honour. The
 * `:` prompt below is not a text input styled to look like Vim — it is
 * `engine.pending.keyBuffer` rendered through core's own `render()`, filled by
 * the same `keyTokenFor` the runner uses, resolved by the same engine the
 * stages run on. Three things fall out of that for free rather than being
 * built:
 *
 * - `hjkl`, `w`, `b`, `G`, `/` and every other motion work on the title, because
 *   the title is a buffer. So does `u`.
 * - A typo is answered in the game's voice by `rejectionLine('unknown-command')`
 *   — the same line a stage would give — instead of by new copy invented here.
 * - The vocabulary cannot drift from what the prompt accepts, because
 *   `shell-commands.ts` reads what core says resolved and the buttons dispatch
 *   the same `ShellCommand` values the parser returns.
 *
 * Four decisions, each measured rather than assumed:
 *
 * - **`GlyphGrid`, not `createRenderer`.** The CRT pipeline is the play
 *   surface's dress; this is `grid-pane.tsx`'s pattern, and the reason is
 *   concrete: `Renderer.dispose()` frees textures and the program but **not the
 *   WebGL2 context** (`crt-shader.ts` deletes three objects and stops), a canvas
 *   element's context is reclaimed only when the element is collected, and
 *   Chrome force-loses the oldest at about sixteen. Title → select → stage →
 *   leave → title is three mounts a cycle, doubled under `StrictMode`. Nothing
 *   about the title needs a time-varying pass, so it draws on commit and holds
 *   no context at all.
 * - **The buffer is editable, and that is left alone.** A key policy cannot fix
 *   it: measured, `setKeyPolicy` gates every key INCLUDING the letters typed
 *   inside a pending `:` line, so denying `a`/`c`/`i` to protect the title also
 *   makes `:set magic` untypeable. The honest answer is that this is a real
 *   buffer — `dd` deletes a line of it, `u` puts it back, and the buttons below
 *   never depend on the text still being there.
 * - **`<BS>` does not edit the command line.** Measured: `:plaz<BS><BS>y<CR>`
 *   resolves as that literal string and reads as an unknown command. That is
 *   core's ceiling and M4 does not touch core, so the prompt says how to clear
 *   it instead of pretending to edit.
 * - **Keys are captured on the document and stand down for a focused control**,
 *   the runner's rule verbatim, so `shift-Tab` reaches the buttons and `<Esc>`
 *   on a button gives the keyboard back.
 */

import { render as renderKeys, VimEngine } from '@vimorror/core';
import { rejectionLine, type Difficulty } from '@vimorror/game';
import { cursorShapeForMode, GlyphGrid, type Camera, type FontAtlas } from '@vimorror/render';
import { getFontAtlas, inFrame, keyTokenFor } from '@vimorror/stage-view';
import { useEffect, useRef, useState } from 'react';

import { frameCells, frameGeometry } from './frame.ts';
import { ResourcesLink } from './settings-screen.tsx';
import { commandText, shellCommandFor, type ShellCommand } from './shell-commands.ts';

/**
 * The title, as content. Authored here rather than in `content/` because it is
 * not a stage — it has no win condition, no par and no solution — and the
 * campaign manifest is the only ordering `content/` owns.
 *
 * Every line is original text, the licensing invariant applying to copy exactly
 * as it does to stages. The lines below the wordmark teach the way in, and they
 * are inside the buffer rather than in the chrome so that a player who moves the
 * cursor is reading the instructions with it.
 *
 * **The wordmark is a 5x5 block alphabet with every pixel doubled
 * horizontally, and that is geometry rather than style.** A cell is 9x18 CSS
 * pixels (`font.ts`), so one block pixel per cell renders each letter at half
 * its intended aspect — measured on screen, the first version read as scattered
 * dots rather than as strokes, because the gap between two `#` on a row is 9px
 * while the gap between two rows is 18px. Two cells per pixel is 18x18, square,
 * and the letters resolve.
 *
 * **It is stacked because doubling made it too wide, and the stack is better
 * anyway.** Eight doubled letters on one line is 96 columns — measured, that
 * clipped the final R at a 900px window and set a frame two thirds wider than
 * any stage's. Split, it is 64 columns and 10 rows, which is the same order of
 * frame the runner draws, fits any window a stage fits, and shows the name's
 * own joke: VIM, and then the rest of it.
 */
const TITLE_BUFFER: readonly string[] = [
  '  ##      ##  ##########  ##      ##',
  '  ##      ##      ##      ####  ####',
  '  ##      ##      ##      ##  ##  ##',
  '    ##  ##        ##      ##      ##',
  '      ##      ##########  ##      ##',
  '        ######    ########    ########      ######    ########',
  '      ##      ##  ##      ##  ##      ##  ##      ##  ##      ##',
  '      ##      ##  ########    ########    ##      ##  ########',
  '      ##      ##  ##    ##    ##    ##    ##      ##  ##    ##',
  '        ######    ##      ##  ##      ##    ######    ##      ##',
  '',
  '  a text editor is a room, and you are not the first thing in it.',
  '',
  '  this is a real buffer. h j k l moves the cursor. u undoes you.',
  '',
  '  :play      choose a room and go in',
  '  :stages    the same door, spelled for the map',
  '  :settings  comfort, effects, and how much this wants you',
  '',
  '  :set verymagic    :set magic    :set nomagic',
  '',
  '  press : then type, then Enter. <Esc> clears a line you started.',
];

const GEOMETRY = frameGeometry({ buffer: TITLE_BUFFER });
const CAMERA: Camera = { topline: 0, height: GEOMETRY.rows, width: GEOMETRY.cols };

/** Every command the buttons offer, in the order the buffer teaches them. */
const VERBS: readonly ShellCommand[] = [{ kind: 'play' }, { kind: 'stages' }, { kind: 'settings' }];

export type TitleScreenProps = {
  readonly difficulty: Difficulty;
  /** The command line and the buttons both come through here. Nothing else does. */
  readonly onCommand: (command: ShellCommand) => void;
};

export function TitleScreen({ difficulty, onCommand }: TitleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<GlyphGrid | null>(null);
  const atlasRef = useRef<FontAtlas | null>(null);
  /** Created once per mount. A `useState` initializer would build one under
   * `StrictMode` and throw it away; this keeps exactly the one that is used. */
  const engineRef = useRef<VimEngine | null>(null);
  engineRef.current ??= new VimEngine([...TITLE_BUFFER]);

  const [atlasError, setAtlasError] = useState<string | undefined>(undefined);
  /** The live `:` prompt and the last thing the engine said about it. A fresh
   * object per key, so every keystroke commits and the canvas redraws. */
  const [view, setView] = useState<{ readonly prompt: string; readonly message: string | undefined }>({
    prompt: '',
    message: undefined,
  });

  useEffect(() => {
    void getFontAtlas().then(
      (atlas) => {
        atlasRef.current = atlas;
        // A fresh object, so the draw effect below has a commit to run in — the
        // atlas arrives after the first render and nothing else would schedule one.
        setView((previous) => ({ ...previous }));
      },
      (e: unknown) => setAtlasError(`the font atlas failed to bake: ${String(e)}`),
    );
  }, []);

  // No dependency array, `grid-pane.tsx`'s rule and its reasoning: `diffCells`
  // makes an unchanged frame one scan and zero draws, and the engine is a
  // mutable ref whose changes no dependency list could name.
  useEffect(() => {
    const canvas = canvasRef.current;
    const atlas = atlasRef.current;
    const engine = engineRef.current;
    if (canvas === null || atlas === null || engine === null) return;

    // Cell size must match the atlas's — `#drawCell` reads its source rect from
    // the atlas and its destination from these, and a mismatch silently scales
    // every glyph rather than failing.
    gridRef.current ??= new GlyphGrid(canvas, atlas.cellW, atlas.cellH);

    const cells = frameCells(engine.lines, [], CAMERA);

    const width = cells.width * atlas.cellW;
    const height = cells.height * atlas.cellH;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      // Assigning either dimension blanks the 2D context while the dirty-cell
      // cache still claims those pixels are drawn, and a resize that keeps the
      // same rows and cols is exactly what `diffCells` cannot see.
      gridRef.current.invalidate();
    }

    gridRef.current.render(cells, atlas, {
      pos: inFrame(cells, engine.cursor) ? { row: engine.cursor.line, col: engine.cursor.col } : null,
      shape: cursorShapeForMode(engine.mode),
    });
  });

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      const engine = engineRef.current;
      if (engine === null) return;
      // A focused control keeps its own keys, so Enter activates a button
      // instead of being eaten by the buffer.
      if (event.target !== document.body) return;

      const token = keyTokenFor(event);
      // No token, no `preventDefault`: `Cmd-R` still reloads and `shift-Tab`
      // still moves focus out to the buttons.
      if (token === undefined) return;
      event.preventDefault();

      let command: ShellCommand | undefined;
      let message: string | undefined;
      for (const e of engine.feed(token)) {
        // `InvalidCommand` arrives BEFORE the `CommandResolved` for the same
        // line, so a verb the shell knows overwrites core's refusal below
        // rather than racing it.
        if (e.type === 'InvalidCommand' || e.type === 'KeyRejected') message = rejectionLine(e.reason);
        else if (e.type === 'CommandResolved') {
          const found = shellCommandFor(e.command.keys);
          if (found !== undefined) {
            command = found;
            message = undefined;
          }
        }
      }

      setView({ prompt: renderKeys(engine.pending.keyBuffer), message });
      if (command !== undefined) onCommand(command);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCommand]);

  /** Every control gives the keyboard back, or the next keystroke goes nowhere. */
  function press(command: ShellCommand, event: { readonly currentTarget: HTMLElement }): void {
    event.currentTarget.blur();
    onCommand(command);
  }

  return (
    <div
      className="screen title"
      onKeyDown={(event) => {
        // The way back in from a focused control — the same gesture the runner
        // uses, and `<Esc>` is right because it is already the game's "return".
        if (event.key === 'Escape' && event.target instanceof HTMLElement) event.target.blur();
      }}
    >
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>

      <p className="status">
        {/* The prompt is core's, character for character. An empty buffer shows
            the invitation instead, so the line never collapses. */}
        {view.prompt === '' ? (
          <span className="dim">press : to open the command line</span>
        ) : (
          <span className="ghost">{view.prompt}</span>
        )}
        {view.message === undefined ? null : <span className="refused"> · {view.message}</span>}
      </p>

      <div className="run-actions">
        {VERBS.map((verb) => (
          <button key={verb.kind} type="button" onClick={(event) => press(verb, event)}>
            {verb.kind} <code className="dim">{commandText(verb)}</code>
          </button>
        ))}
      </div>

      <p className="status">
        difficulty <code>{commandText({ kind: 'set-difficulty', difficulty })}</code>
        <span className="dim"> · type it at the prompt, or open settings · shift-tab reaches the buttons</span>
      </p>

      {atlasError === undefined ? null : <p className="bad">{atlasError}</p>}
      <ResourcesLink />
    </div>
  );
}
