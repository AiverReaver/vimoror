/**
 * The visual half of the dual pane: a `<canvas>` this component owns and React
 * never touches.
 *
 * That split is the technology table's rule — React for "menus, dialogue, editor
 * panels only, never the game grid" — and it is not stylistic. `GlyphGrid` keeps
 * a dirty-cell cache of what is already on the canvas; a React re-render that
 * replaced the element would silently invalidate that cache against a blank
 * surface. So the element is created once and every frame is an imperative
 * `render()` from an effect.
 *
 * `GlyphGrid` alone, with no CRT pipeline — the editor wants clarity, and the
 * shared-surface claim ("what you author is exactly what ships") is about the
 * glyph grid, the atlas and the cell geometry, which *are* shared. Curvature and
 * phosphor are M4's runtime dress. Two consequences of dropping the pipeline,
 * both checked against it rather than assumed:
 *
 * - **The canvas is handed straight to `GlyphGrid`.** `pipeline.ts` needs a
 *   second, private 2D canvas only because a canvas can hand out exactly one
 *   context type and its visible one is WebGL2. Nothing here ever asks this
 *   element for a GL context — and it must not, since that would make
 *   `getContext('2d')` return null and the constructor throw.
 * - **No `requestAnimationFrame`.** The demo's loop exists because phosphor
 *   persistence and glitch bands are time-varying and the post-FX pass has to
 *   keep running while the buffer is idle. Nothing in `GlyphGrid` reads a clock,
 *   so a render per commit is exactly right and an idle editor draws nothing.
 */

import type { Mode, Pos } from '@vimorror/core';
import type { Entity, EntityKind } from '@vimorror/game';
import { GlyphGrid, bakeFontAtlas, cursorShapeForMode, type CellBuffer, type FontAtlas } from '@vimorror/render';
import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { DEFAULT_GLYPH, rectFrom } from './draft.ts';
import { entityAt, inFrame, stageCells } from './stage-cells.ts';

const CELL_W = 9;
const CELL_H = 18;
const FONT_SIZE_PX = 15;

/**
 * A floor, not a limit. The frame never shrinks below this, so a one-line stage
 * does not render as a sliver, and it grows freely for anything longer — the
 * canvas is sized from the `CellBuffer` it is about to draw, so real content is
 * never clipped (`stageCells` owns the one ceiling, and says why). `Camera`
 * scrolling for a stage bigger than the screen is explicitly out of scope for
 * M3.
 */
const MIN_COLS = 64;
const MIN_ROWS = 18;

/**
 * Render's woff2 is not in its package `exports`, so it is reached by path —
 * exactly as `packages/render/demo/main.ts` reaches it. Vite rewrites the URL
 * and serves the file from outside the app root on its own.
 */
const FONT_URL = new URL('../../../packages/render/assets/fonts/JetBrainsMono-Regular.woff2', import.meta.url).href;

/**
 * Baked once per page, not per mount. Every `bakeFontAtlas` call constructs a
 * fresh `FontFace`, adds it to `document.fonts` (a set of OBJECTS, so the
 * duplicate is kept, never replaced) and allocates an `OffscreenCanvas` — none
 * of which is ever released. Under `StrictMode`'s deliberate double-invoke that
 * is two of each on the first mount alone.
 *
 * The memo is CLEARED on failure. Caching a rejected promise would make one
 * missing font file permanent for the life of the page: `bakeFontAtlas` awaits
 * `font.load()`, so a moved or unshipped woff2 rejects, and without the reset a
 * reload of the pane would replay the same rejection forever.
 */
let atlasOnce: Promise<FontAtlas> | undefined;

function fontAtlas(): Promise<FontAtlas> {
  atlasOnce ??= bakeFontAtlas(FONT_URL, CELL_W, CELL_H, FONT_SIZE_PX).catch((e: unknown) => {
    atlasOnce = undefined;
    throw e;
  });
  return atlasOnce;
}

/**
 * One row per frame row and every row padded to the floor, so `linesToCells`'s
 * own longest-line width calculation lands on a stable frame instead of jumping
 * every time the longest line changes.
 */
function frameLines(lines: readonly string[]): string[] {
  const rows = Math.max(MIN_ROWS, lines.length);
  const out: string[] = [];
  for (let row = 0; row < rows; row += 1) out.push((lines[row] ?? '').padEnd(MIN_COLS, ' '));
  return out;
}

export type GridPaneProps = {
  readonly lines: readonly string[];
  readonly entities: readonly Entity[];
  /**
   * Where the cursor is drawn: the stage's spawn while editing, the live
   * session's cursor while a playtest runs. `undefined` when the draft has no
   * spawn and does not parse.
   */
  readonly spawn: Pos | undefined;
  /**
   * The mode the cursor takes its SHAPE from — a live session's, or `undefined`
   * for a stage at rest, which spawns in normal mode. The mapping is render's
   * (`cursorShapeForMode`), never a shape hardcoded here.
   */
  readonly mode?: Mode | undefined;
  readonly selection: string | undefined;
  readonly onSelect: (id: string | undefined) => void;
  /** The armed paint kind, or `undefined` for the plain click-to-select grid. */
  readonly tool: EntityKind | undefined;
  readonly onPaint: (from: Pos, to: Pos) => void;
};

/**
 * The id the in-progress drag rectangle is drawn under. It only has to miss every
 * real id, and an author cannot type parentheses into one by accident — but even
 * a collision would only tint the wrong cells for as long as the mouse is down.
 */
const GHOST_ID = '(painting)';

export function GridPane({ lines, entities, spawn, mode, selection, onSelect, tool, onPaint }: GridPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<GlyphGrid | null>(null);
  const atlasRef = useRef<FontAtlas | null>(null);
  /** The frame currently on screen, so a click can map a pixel to its cell. */
  const cellsRef = useRef<CellBuffer | null>(null);
  const [atlasState, setAtlasState] = useState<'baking' | 'ready' | string>('baking');
  /**
   * The rectangle being swept, while the button is down. It is React state rather
   * than a ref because it has to REDRAW: a rectangle drag with no feedback is
   * aiming blind, and the cheapest feedback available is the thing the editor
   * already does well — one more entity in the array `stageCells` paints.
   */
  const [drag, setDrag] = useState<{ readonly from: Pos; readonly to: Pos } | undefined>(undefined);

  useEffect(() => {
    void fontAtlas().then(
      (atlas) => {
        atlasRef.current = atlas;
        setAtlasState('ready');
      },
      // Surfaced rather than swallowed: without this the pane sat on "baking the
      // font atlas…" with a blank 300x150 canvas and an unhandled rejection in
      // the console, which reads as slow rather than broken.
      (e: unknown) => setAtlasState(`the font atlas failed to bake: ${String(e)}`),
    );
  }, []);

  // No dependency array: every commit redraws. That is not wasteful — the whole
  // point of `diffCells` is that an unchanged frame costs one scan and zero
  // draws — and it is safer than naming dependencies, since `lines` and
  // `entities` are fresh arrays on most renders anyway.
  useEffect(() => {
    const canvas = canvasRef.current;
    const atlas = atlasRef.current;
    if (canvas === null || atlas === null) return;

    // Cell size must match the atlas's: `#drawCell` reads its SOURCE rect from
    // the atlas and its DESTINATION from these, and a mismatch silently scales
    // every glyph rather than failing.
    gridRef.current ??= new GlyphGrid(canvas, atlas.cellW, atlas.cellH);

    // The ghost is appended, so it paints LAST and sits on top — `stageCells`
    // treats the array as the author's own z-order, and a rectangle being drawn
    // over existing walls has to be visible while it is drawn.
    const ghost: readonly Entity[] =
      drag === undefined || tool === undefined
        ? []
        : [{ id: GHOST_ID, kind: tool, glyph: DEFAULT_GLYPH[tool], ...rectFrom(drag.from, drag.to) }];
    const cells = stageCells(frameLines(lines), [...entities, ...ghost], selection);
    cellsRef.current = cells;

    const width = cells.width * atlas.cellW;
    const height = cells.height * atlas.cellH;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      // Assigning either dimension blanks the 2D context while the dirty-cell
      // cache still claims those pixels are drawn. `diffCells` catches a changed
      // CELL grid on its own, but not a resize that keeps the same rows and
      // cols — there the diff is empty and the canvas would simply stay blank.
      gridRef.current.invalidate();
    }

    gridRef.current.render(cells, atlas, {
      pos: spawn !== undefined && inFrame(cells, spawn) ? { row: spawn.line, col: spawn.col } : null,
      shape: cursorShapeForMode(mode ?? 'normal'),
    });
  });

  function cellAt(event: MouseEvent<HTMLCanvasElement>): Pos | undefined {
    const canvas = canvasRef.current;
    const cells = cellsRef.current;
    if (canvas === null || cells === null) return undefined;

    // Measured off the LAID-OUT box rather than the pixel dimensions, so a
    // canvas the CSS has scaled still maps a click to the right cell.
    const box = canvas.getBoundingClientRect();
    return {
      col: Math.floor(((event.clientX - box.left) / box.width) * cells.width),
      line: Math.floor(((event.clientY - box.top) / box.height) * cells.height),
    };
  }

  /**
   * One pointer, two jobs, resolved on mouse UP for both: with a tool armed the
   * gesture paints, and with none it selects. Routing both through the same
   * event is what keeps a plain click from doing both — a click fires
   * `mousedown`, `mouseup` AND `click`, so an `onClick` selector left beside a
   * `mouseup` painter would place an entity and then immediately select whatever
   * was already under the pointer.
   */
  function onDown(event: MouseEvent<HTMLCanvasElement>): void {
    const cell = cellAt(event);
    if (tool === undefined || cell === undefined) return;
    setDrag({ from: cell, to: cell });
  }

  function onMove(event: MouseEvent<HTMLCanvasElement>): void {
    if (drag === undefined) return;
    const cell = cellAt(event);
    if (cell !== undefined) setDrag({ from: drag.from, to: cell });
  }

  function onUp(event: MouseEvent<HTMLCanvasElement>): void {
    const cell = cellAt(event);
    if (cell === undefined) return;
    if (tool !== undefined && drag !== undefined) {
      setDrag(undefined);
      onPaint(drag.from, cell);
      return;
    }
    onSelect(entityAt(entities, cell)?.id);
  }

  return (
    <div className="pane">
      <h2>preview</h2>
      <canvas
        ref={canvasRef}
        className={tool === undefined ? 'grid' : 'grid painting'}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        // A button released off the canvas never reaches `onUp`, and a drag left
        // armed would then re-arm itself on the next hover and paint a rectangle
        // from wherever the pointer used to be.
        onMouseLeave={() => setDrag(undefined)}
      />
      {atlasState === 'ready' ? null : (
        <p className={atlasState === 'baking' ? 'note' : 'bad'}>
          {atlasState === 'baking' ? 'baking the font atlas…' : atlasState}
        </p>
      )}
    </div>
  );
}
