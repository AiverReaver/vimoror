/**
 * The stage runner: a `GameSession`, a canvas, and nothing that decides anything.
 *
 * The design rule M4 inherited from M3 is the whole of this file — **the shell
 * invents no rules of its own** — and it is worth naming what that costs here,
 * because every one of these was a place a runner could plausibly have grown a
 * second opinion:
 *
 * - **Scoring** is `session.score`. **Hints** are `session.hint()`, whose policy
 *   (`always` free, `on-request` charging the clean run, `none` refusing) is
 *   already decided inside it — this file reads `modifiersFor(difficulty).hints`
 *   for one thing only, which BUTTON to draw. **Gating** is the session's key
 *   policy, and a rejection arrives with its in-character `line` already
 *   written. **Comfort** filtering happened before `BeatFired` was emitted.
 *   **The outcome** is `OutcomeDecided`, and `by` names the condition, so the
 *   loss copy is a lookup rather than a judgment.
 * - **Difficulty and comfort arrive as props, and the SESSION is the authority
 *   on them once it exists.** A default here would be a fourth copy of a
 *   decision `difficulty.ts` already owns; and a resumed run enforces the
 *   difficulty it was played at, because `GameSession.restore` takes it from
 *   the snapshot, so the header and the hint button read `session.difficulty`
 *   rather than the prop that seeded it.
 * - **The save is written, never read.** `onSnapshot` fires on session start
 *   and after every fed key; `initialSnapshot` is a seed the parent chose. This
 *   file never touches `localStorage`, so the codec has exactly one caller.
 *
 * Four things are decisions rather than wiring:
 *
 * - **React never touches the canvas, and the draw is a rAF loop.** The first
 *   half is the technology table's rule and `GlyphGrid`'s dirty-cell cache
 *   enforcing it (a re-render that swapped the element would leave the cache
 *   describing a blank surface); the second is because phosphor persistence and
 *   the glitch bands are time-varying, so the post-FX pass has to keep running
 *   over an idle buffer. **Cells** recompute only on a keystroke, which is the
 *   only thing that can change them — the pass itself runs every frame.
 * - **Keys are captured on the document, not on a focusable box.** The editor's
 *   playtest needed a box because the page around it is full of text inputs; the
 *   runner IS the page. The cost is that a focused control would otherwise never
 *   see its own Enter, so the handler stands down for any target that is not the
 *   body, `shift-Tab` (which `keyTokenFor` deliberately refuses) is the way to
 *   reach the hint button, and every control blurs itself on click so the next
 *   keystroke goes back to the stage. It also stands down entirely once the
 *   outcome is decided — without that, `<Tab>` would be swallowed by a frozen
 *   session and the win overlay's own buttons would be unreachable by keyboard.
 * - **The session is a ref and the HUD is state.** A `GameSession` is mutable and
 *   un-serialisable, so it cannot live in state; what React renders is a flat
 *   copy taken at the end of each fed key. The same split the editor's
 *   `play-pane.tsx` arrived at, for the same reason.
 * - **An engine throw freezes the stage and says so.** `pnpm test:fuzz` is
 *   known-nonzero live state, so a throw mid-play is not hypothetical, and a
 *   half-applied keystroke means the session's own tallies are no longer
 *   trustworthy. Retry is the only way on, exactly as the editor drops a
 *   recording rather than logging and continuing.
 *
 * The viewport clip that `DrawArgs.cells` requires of its caller lives in
 * `frame.ts`, pure and tested — a shipped stage really can scroll once play has
 * grown its buffer, and the one part of the clip no playtest can reach (a
 * rectangle straddling the top edge) is documented there.
 */

import { render as renderKeys, type Mode } from '@vimorror/core';
import {
  GameSession,
  modifiersFor,
  type Comfort,
  type Condition,
  type Difficulty,
  type Hint,
  type Outcome,
  type Score,
  type SessionSnapshot,
  type Stage,
} from '@vimorror/game';
import { createRenderer, followCursor, type Camera, type CellBuffer, type Renderer } from '@vimorror/render';
import { atlasScaleFor, CELL_H, CELL_W, getFontAtlas, keyTokenFor } from '@vimorror/stage-view';
import { useEffect, useRef, useState } from 'react';

import { playStinger } from './audio.ts';
import { frameCells, frameGeometry, MIN_COLS, MIN_ROWS } from './frame.ts';
import { commandText, shellCommandFor } from './shell-commands.ts';

/** Why the stage ended, in the game's voice. `by` is the condition that fired,
 * so this is a lookup over `rules.ts`'s own vocabulary and never a guess. */
function lossLine(by: Condition): string {
  switch (by.kind) {
    case 'keystrokes-over':
      return `More than ${by.max} keys. The room does not stay open that long.`;
    case 'threat-reaches-cursor':
      return 'It reached you. It was only ever moving when you moved.';
    case 'cursor-on':
      return 'You came to rest somewhere that had been waiting for you to.';
    case 'buffer-equals':
      return 'The text settled into a shape that was not yours.';
  }
}

/** What React renders — a flat copy of the session, taken after each fed key. */
type RunView = {
  readonly mode: Mode;
  /** The mid-command ghost: what core is holding but has not resolved yet. */
  readonly ghost: string;
  readonly keystrokes: number;
  /** A rejection, a refusal or a `:w` acknowledgement. Cleared by the next key. */
  readonly message: string | undefined;
  /** The most recent beat. Persists across keys — a beat is meant to linger. */
  readonly beat: string | undefined;
  readonly outcome: Outcome;
  /** Read once when the outcome latches, so the overlay never reads a live ref. */
  readonly score: Score | undefined;
};

function viewOf(session: GameSession, previous?: RunView): RunView {
  return {
    mode: session.engine.mode,
    ghost: renderKeys(session.engine.pending.keyBuffer),
    keystrokes: session.keystrokes,
    message: undefined,
    beat: previous?.beat,
    outcome: session.outcome,
    score: undefined,
  };
}

export type RunnerProps = {
  readonly stage: Stage;
  readonly difficulty: Difficulty;
  /**
   * Must be referentially stable across renders OR value-equal — the session
   * restarts when it changes, and the dependency below is derived from the
   * object's own keys so a parent that rebuilds an equal object is safe.
   */
  readonly comfort: Comfort;
  /** 0..1, straight to the shader uniform. Wave C's comfort layer owns the value. */
  readonly effectsIntensity: number;
  /**
   * A play in flight to pick back up, or `undefined` to start the stage.
   *
   * **A seed, read when a session starts and never watched.** It is held in a
   * ref rather than listed in the session effect's dependencies, because the
   * effect is what restarts the stage and a snapshot changes on every keystroke
   * — depending on it would restart the run under the player once per key. The
   * ref is consumed only when its `stageId` matches, which is what makes
   * StrictMode's double-invoke, a `next stage` that changes the prop, and a
   * `retry` that clears it all land on the right session without a fourth flag.
   */
  readonly initialSnapshot: SessionSnapshot | undefined;
  /** Called on session start and after every fed key. `save.ts` is the consumer. */
  readonly onSnapshot: (snapshot: SessionSnapshot) => void;
  /** Won or lost, once, as it latches. The stage id travels with it because
   * `Score` does not carry one. */
  readonly onOutcome: (stageId: string, outcome: Outcome, score: Score) => void;
  /** `:q` (`force: false`) keeps the resume snapshot; `:q!` discards it. */
  readonly onExit: (force: boolean) => void;
  /** `undefined` at the end of the campaign, which is what hides the button. */
  readonly onNext: (() => void) | undefined;
};

export function Runner({
  stage,
  difficulty,
  comfort,
  effectsIntensity,
  initialSnapshot,
  onSnapshot,
  onOutcome,
  onExit,
  onNext,
}: RunnerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  /** The frame currently on screen. Rebuilt on a keystroke, drawn every frame. */
  const cellsRef = useRef<CellBuffer | null>(null);
  const cameraRef = useRef<Camera>({ topline: 0, height: MIN_ROWS, width: MIN_COLS });
  /** A ref so a slider tick reaches the loop without recreating the renderer. */
  const intensityRef = useRef(effectsIntensity);
  intensityRef.current = effectsIntensity;

  /** The seed, consumed by `stageId` rather than by a flag — see the prop. */
  const seedRef = useRef<SessionSnapshot | undefined>(initialSnapshot);

  const [view, setView] = useState<RunView | undefined>(undefined);
  const [hint, setHint] = useState<Hint | undefined>(undefined);
  const [crash, setCrash] = useState<string | undefined>(undefined);
  /** A resume that could not be honoured. Not a crash — the stage is playable. */
  const [dropped, setDropped] = useState<string | undefined>(undefined);
  /**
   * The difficulty the SESSION is running at, which is not always the prop.
   *
   * `GameSession.restore` takes difficulty from the snapshot by design —
   * authored rules come from the stage, evolved state from the save — so a run
   * left mid-stage and resumed after the player changed `:set` at the title
   * continues at the difficulty it was played at. The session is the authority
   * on its own difficulty, so the header, the hint policy and the loss rules
   * all read this rather than the prop, and none of them can disagree with what
   * is actually being enforced.
   */
  const [runDifficulty, setRunDifficulty] = useState<Difficulty>(difficulty);
  const [atlasError, setAtlasError] = useState<string | undefined>(undefined);
  const [postFx, setPostFx] = useState<string | undefined>(undefined);
  /** Bumped by retry. The session effect is the only thing that reads it. */
  const [runKey, setRunKey] = useState(0);
  /**
   * The raw ratio, not the integer scale: a query pinned at `2dppx` stops firing
   * once the ratio has moved off it, so re-arming has to happen on every change
   * rather than only on the ones that change the atlas.
   */
  const [dpr, setDpr] = useState(() => window.devicePixelRatio);

  const scale = atlasScaleFor(dpr);
  const geom = frameGeometry(stage);
  const hintPolicy = modifiersFor(runDifficulty).hints;
  /**
   * Derived from the object's own keys rather than from its identity, so a parent
   * that rebuilds an equal `Comfort` cannot restart the stage under the player —
   * and so a field added to `Comfort` is picked up without an edit here. Sorted
   * because key order is not a guarantee worth relying on.
   */
  const comfortKey = (Object.keys(comfort) as (keyof Comfort)[])
    .sort()
    .map((key) => `${key}=${String(comfort[key])}`)
    .join(',');

  // A window dragged between monitors changes the ratio, which changes the atlas
  // the grid must be baked at — see `font.ts`. Re-armed at the new ratio each
  // time, since the query only fires on leaving the one it names.
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = (): void => setDpr(window.devicePixelRatio);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [dpr]);

  // Declared before the renderer so the first frame has cells to draw. The
  // renderer's own body is async behind the atlas anyway, so this is belt and
  // braces rather than the thing that makes it work.
  useEffect(() => {
    // Consumed by id, not cleared: StrictMode invokes this twice and a
    // consume-once ref would give the second run a fresh session, silently
    // throwing away the resume the first run honoured.
    const seed = seedRef.current?.stageId === stage.id ? seedRef.current : undefined;

    let session: GameSession;
    let droppedReason: string | undefined;
    try {
      session = seed === undefined ? new GameSession(stage, { difficulty, comfort }) : GameSession.restore(stage, seed);
    } catch (e) {
      // `restore()` is the one deliberately loud surface in the game layer — a
      // stage mismatch throws, and `VimEngine.restore` throws on an engine
      // snapshot it cannot read. Both mean the same thing here: the save is not
      // this stage's any more (renamed, removed, corrupted, hand-edited), and a
      // fresh session is the only honest answer. Never a crash on a loading
      // screen, and never a silent one either.
      session = new GameSession(stage, { difficulty, comfort });
      droppedReason = `the saved run could not be resumed (${(e as Error).message}) — this stage started fresh.`;
    }

    const camera: Camera = { topline: 0, height: geom.rows, width: geom.cols };
    sessionRef.current = session;
    cameraRef.current = camera;
    cellsRef.current = frameCells(session.engine.lines, session.entities, camera);
    setView(viewOf(session));
    setCrash(undefined);
    setDropped(droppedReason);
    setRunDifficulty(session.difficulty);
    // Read off the SESSION, not the prop: a resumed run enforces the difficulty
    // it was played at, and `hintPolicy` is therefore not in the dependencies
    // below — it is derived from state this effect itself sets.
    const policy = modifiersFor(session.difficulty).hints;
    // `always` (verymagic) is free and on screen from the start; the other two
    // policies start with nothing, and `none` never gets a button at all.
    setHint(policy === 'always' ? session.hint() : undefined);
    // Stored before the first key, so a stage opened and abandoned without a
    // keystroke still resumes — and so the mid-play snapshot after every fed
    // batch has nothing to special-case. That pair is also why there is no
    // `visibilitychange` listener: every change to a session goes through
    // `feed`, so there is no state a visibility change could catch that the
    // last feed has not already written.
    onSnapshot(session.snapshot());
    return () => {
      sessionRef.current = null;
    };
    // `comfort` enters as `comfortKey` and `geom` as its two numbers,
    // deliberately: both are rebuilt every render, and depending on their
    // identity would restart the stage on every parent commit.
  }, [stage, difficulty, comfortKey, runKey, geom.cols, geom.rows, onSnapshot]);

  useEffect(() => {
    // Captured per effect run rather than read back off a ref in cleanup, so
    // StrictMode's double-invoke cannot have the first run's cleanup dispose the
    // second run's renderer.
    let renderer: Renderer | undefined;
    let frame = 0;
    let cancelled = false;

    void getFontAtlas(scale).then(
      (atlas) => {
        const canvas = canvasRef.current;
        const cells = cellsRef.current;
        if (cancelled || canvas === null || cells === null) return;

        // Sized before `createRenderer`, which reads these to build its private
        // grid canvas and to allocate the phosphor accumulator. The backing store
        // is in DEVICE pixels (the atlas's cells) and the CSS box in logical ones.
        canvas.width = cells.width * atlas.cellW;
        canvas.height = cells.height * atlas.cellH;
        canvas.style.width = `${cells.width * CELL_W}px`;
        canvas.style.height = `${cells.height * CELL_H}px`;

        renderer = createRenderer(canvas, { atlas });
        setPostFx(renderer.kind);

        const draw = (): void => {
          frame = requestAnimationFrame(draw);
          const session = sessionRef.current;
          const onScreen = cellsRef.current;
          if (session === null || onScreen === null) return;

          // A different stage, or a frame that grew, arrives here rather than
          // through a remount: `resize` reallocates the accumulator and
          // invalidates the dirty-cell cache, which is exactly what a blanked
          // canvas needs and what `diffCells` cannot see on its own.
          const width = onScreen.width * atlas.cellW;
          const height = onScreen.height * atlas.cellH;
          if (canvas.width !== width || canvas.height !== height) {
            renderer?.resize(width, height);
            canvas.style.width = `${onScreen.width * CELL_W}px`;
            canvas.style.height = `${onScreen.height * CELL_H}px`;
          }

          renderer?.draw({
            cells: onScreen,
            camera: cameraRef.current,
            // BUFFER space. `pipeline.ts` maps it through `bufferPosToScreen`
            // itself, which is why nothing here computes a screen coordinate.
            cursor: { pos: session.engine.cursor, mode: session.engine.mode },
            effectsIntensity: intensityRef.current,
          });
        };
        frame = requestAnimationFrame(draw);
      },
      // Surfaced rather than swallowed, the lesson `grid-pane.tsx` recorded: a
      // missing woff2 otherwise reads as a slow page rather than a broken one.
      (e: unknown) => setAtlasError(`the font atlas failed to bake: ${String(e)}`),
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      renderer?.dispose();
    };
  }, [scale]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      const session = sessionRef.current;
      if (session === null) return;
      // A frozen session would ignore the key anyway; standing down here is
      // about `preventDefault` — the overlay's own buttons need `<Tab>` and
      // `<CR>` back, and a crashed session has nothing trustworthy to feed.
      if (session.outcome.status !== 'playing' || crash !== undefined) return;
      // A focused control keeps its own keys. Play happens with focus on the
      // body, which is where it starts and where a control's `blur()` returns it.
      if (event.target !== document.body) return;

      const token = keyTokenFor(event);
      // No token, no `preventDefault`: `Cmd-R` still reloads, the arrows still
      // scroll, and `shift-Tab` still moves focus out to the chrome.
      if (token === undefined) return;
      event.preventDefault();

      let events;
      try {
        events = session.feed(token);
      } catch (e) {
        // The tallies are no longer trustworthy — a throw means this keystroke's
        // effect is undefined — so the stage stops here rather than continuing
        // with a score that quietly lies.
        setCrash(`the engine threw on ${JSON.stringify(token)}: ${(e as Error).message}`);
        return;
      }

      const camera = followCursor(cameraRef.current, session.engine.cursor.line);
      cameraRef.current = camera;
      // Unconditionally, not on a "did anything change" test: any key can edit
      // the buffer, and a frame is a thousand cells that `diffCells` throws away
      // for free when nothing moved.
      cellsRef.current = frameCells(session.engine.lines, session.entities, camera);

      setView((previous) => {
        let next = viewOf(session, previous);
        for (const e of events) {
          if (e.type === 'KeyRejected' || e.type === 'CommandRefused') next = { ...next, message: e.line };
          // A mid-stage `:set nomagic` really resolved — it cost its keystrokes
          // and ticked the world — so it is answered rather than swallowed.
          // Core's `:set` does not know the magic options and reports NOTHING
          // for one it cannot apply (`applyOneSetArg` returns the options
          // unchanged), so without this branch the player pays for the command
          // and hears silence.
          //
          // **The answer is a refusal, and the message says exactly that.**
          // M4-PLAN.md's fact 1 proposes "takes effect on your next stage",
          // and that copy was written and then measured false: the runner has
          // no way to tell the shell, and adding one restarts the session under
          // the player, because `difficulty` is in the session effect's
          // dependencies precisely so a change between stages takes hold. See
          // the note in `docs/CHECKLIST.md` — deferring the change until the
          // next session wants state in `app.tsx` plus a fourth entry point
          // (retry is internal here), which is a lot of machinery for a line of
          // copy. Saying no is honest and costs nothing.
          else if (e.type === 'Tick') {
            const shell = shellCommandFor(e.command.keys);
            if (shell?.kind === 'set-difficulty') {
              next = { ...next, message: `${commandText(shell)} — difficulty is chosen between stages, not inside one.` };
            }
          } else if (e.type === 'BeatFired') next = { ...next, beat: e.beat.text };
          else if (e.type === 'BufferSaved') next = { ...next, message: 'written.' };
          else if (e.type === 'OutcomeDecided') next = { ...next, outcome: e.outcome, score: session.score };
        }
        return next;
      });

      // Outside the `setView` updater deliberately — that callback runs during
      // render and must stay pure, and all three of these are effects on the
      // world: one writes `localStorage`, one makes a noise, one navigates.
      //
      // **A decided run is not snapshotted at all**, which is the whole reason
      // this is an either/or rather than two statements. `app.tsx` clears
      // `current` when an outcome latches, and a snapshot written after that —
      // or before it, and then not cleared — would offer a finished stage back
      // as "resume", which is the one thing `current` must never mean.
      const decided = events.find((e) => e.type === 'OutcomeDecided');
      if (decided !== undefined && decided.type === 'OutcomeDecided') {
        onOutcome(stage.id, decided.outcome, session.score);
        playStinger(decided.outcome.status === 'won' ? 'win' : 'lose');
      } else {
        onSnapshot(session.snapshot());
      }

      // Recomputed while free, cleared while not: an `on-request` hint is spent
      // where the player asked for it, so it must not silently follow them to the
      // next position without charging again.
      setHint(hintPolicy === 'always' ? session.hint() : undefined);

      // `:q` and `:q!` are the same event with a different `force`, which is
      // Vim's own distinction arriving as UI for nothing.
      const quit = events.find((e) => e.type === 'QuitRequested');
      if (quit !== undefined && quit.type === 'QuitRequested') onExit(quit.force);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [crash, hintPolicy, onExit, onOutcome, onSnapshot, stage.id]);

  /** Every control gives the keyboard back, or the next keystroke goes nowhere. */
  function blurAfter(event: { readonly currentTarget: HTMLElement }): void {
    event.currentTarget.blur();
  }

  function askHint(event: { readonly currentTarget: HTMLElement }): void {
    blurAfter(event);
    // `hint()` is the authority on the price: on `on-request` it charges the
    // clean-run flag, and only when a hint really comes back.
    const session = sessionRef.current;
    if (session !== null) setHint(session.hint());
  }

  const outcome = view?.outcome ?? { status: 'playing' as const };
  const decided = outcome.status !== 'playing';

  /**
   * The way back in from a focused control. A keydown on the body does not
   * bubble through this element — the body is its ANCESTOR — so this handler
   * sees exactly the case it is for: a button holding the keyboard while the
   * stage wants it. `<Esc>` is the right key because it is already the game's
   * "return to normal", and the document handler has stood down anyway.
   */
  function onChromeKeyDown(event: { readonly key: string; readonly target: EventTarget | null }): void {
    if (event.key === 'Escape' && event.target instanceof HTMLElement) event.target.blur();
  }

  return (
    <div className="run" onKeyDown={onChromeKeyDown}>
      <header className="run-head">
        <span>
          act {stage.act} · {stage.title}
        </span>
        <span className="dim">
          :set {runDifficulty} · par {stage.par} · post-fx {postFx ?? '…'}
        </span>
      </header>

      <div className="stage">
        <canvas ref={canvasRef} />

        {view?.beat === undefined ? null : <p className="dialogue">{view.beat}</p>}

        {!decided ? null : (
          <div className="outcome" role="status">
            {outcome.status === 'won' ? (
              <>
                {/* Never colour alone: the marker and the word both say which
                    this is, so the green is the third signal rather than the
                    only one. */}
                <p className="ok">[+] you are through</p>
                {view?.score === undefined ? null : (
                  <p className="note">
                    {view.score.keystrokes} keys, par {view.score.par} —{' '}
                    {view.score.delta < 0
                      ? `${-view.score.delta} under`
                      : view.score.delta === 0
                        ? 'exactly par'
                        : `${view.score.delta} over`}
                    {' · '}
                    {view.score.clean
                      ? '[*] clean run'
                      : `[ ] assisted (${view.score.undos} undo, ${view.score.hintsShown} hint)`}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="bad">[-] it ended here</p>
                <p className="note">{lossLine(outcome.by)}</p>
              </>
            )}
            {/* All three blur, and the two that start a new stage need it most.
                Found by `apps/web/e2e/save-round-trip.spec.ts`: this overlay
                unmounts on the commit AFTER the click, so a player who clicks
                `next stage` and immediately types loses that keystroke to the
                still-focused button — `onKeyDown` stands down for any target
                that is not the body. Every other control in this file already
                did this; these three were the exception the header claimed did
                not exist. */}
            <div className="run-actions">
              <button
                type="button"
                onClick={(event) => {
                  blurAfter(event);
                  // Cleared BEFORE the bump: retry means this stage from the
                  // top, and a seed left in place would restore the run that
                  // just ended.
                  seedRef.current = undefined;
                  setRunKey((n) => n + 1);
                }}
              >
                retry
              </button>
              {onNext === undefined ? null : (
                <button type="button" onClick={(event) => { blurAfter(event); onNext(); }}>
                  next stage
                </button>
              )}
              <button type="button" onClick={(event) => { blurAfter(event); onExit(false); }}>
                leave
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="status">
        <span className="mode">{view?.mode ?? 'normal'}</span>
        {' · '}
        {view?.keystrokes ?? 0}/{stage.par} keys
        {view?.ghost === undefined || view.ghost === '' ? null : <span className="ghost"> · typed: {view.ghost}</span>}
        {view?.message === undefined ? null : <span className="refused"> · {view.message}</span>}
      </p>

      <div className="run-actions">
        {hintPolicy === 'none' || decided ? null : (
          <button type="button" onClick={askHint} disabled={hintPolicy === 'always'}>
            {hintPolicy === 'always' ? 'hint is always on' : 'hint'}
          </button>
        )}
        <button type="button" onClick={(event) => { blurAfter(event); onExit(false); }}>
          leave stage
        </button>
        <span className="dim">shift-tab reaches these buttons · esc returns to the stage</span>
      </div>

      {hint === undefined ? null : (
        <p className="hint">
          next: <code>{hint.keys}</code> ({hint.index}/{hint.total}
          {hint.onPath ? '' : ', off the route'})
        </p>
      )}

      {dropped === undefined ? null : <p className="note">{dropped}</p>}
      {atlasError === undefined ? null : <p className="bad">{atlasError}</p>}
      {crash === undefined ? null : <p className="bad">{crash} — retry to start the stage again.</p>}
    </div>
  );
}
