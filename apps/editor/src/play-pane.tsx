/**
 * Playtest in place, and the recorder's UI.
 *
 * "In place" is literal: the pane owns a live `GameSession` and publishes a
 * `PlayView` upward, and `app.tsx` hands that view to the SAME `GridPane` the
 * author was just editing. There is no second canvas and no play mode for the
 * preview to switch into — the grid draws the session's buffer, cursor, mode and
 * live entity positions instead of the draft's, and everything else on the page
 * stays where it was.
 *
 * **There is one live mode, not the plan's `playing | recording` pair.** Every
 * playtest is recorded, because a playtest that reaches a win *is* a solution
 * worth arming, and two modes would have been the same session and the same fold
 * with one boolean deciding whether a button renders. So the pane has one live
 * state, and the arm button is offered as soon as anything is recorded — `arm`
 * itself is the authority on whether a recording can become a solution, and it
 * has a reason for every refusal. (The plan already described recording as "the
 * same session with the token stream captured"; this is that sentence taken at
 * its word.)
 *
 * Three things here are decisions rather than wiring:
 *
 * - **Keys are captured by a focusable box, not by a window listener.** The
 *   metadata panel is full of text inputs, and a document-level handler would
 *   feed `title` keystrokes to the engine. The box is the trust boundary: keys
 *   reach the session only while it holds focus, and it says which state it is in.
 * - **The session is a ref, and so is the fold's authority.** A `GameSession` is
 *   mutable and un-serialisable, so it can never live in the reducer (`store.ts`
 *   is pure by construction) — and the `Recording` is kept beside it rather than
 *   read back off the rendered view, because a keystroke's record must not depend
 *   on React having re-rendered since the previous one. React does flush discrete
 *   events synchronously today, so reading the prop worked; the failure if that
 *   ever stopped being true is a token list silently shorter than the session's
 *   own keystroke count, which arms a solution missing keys. The view carries a
 *   copy for rendering.
 * - **An engine throw stops the session and says so.** `pnpm test:fuzz` is
 *   known-nonzero live state, so an unexpected throw mid-playtest is not
 *   hypothetical — and a half-applied keystroke makes the recording untrustworthy,
 *   which is why the session is dropped rather than logged-and-continued. Nothing
 *   armable survives.
 *
 * `solution` and `par` are written through the same `field-set` action the
 * metadata panel uses, which is where the author edits them afterwards — arming
 * writes par at the recorded token count and generosity is added there, never
 * here, and never below the count the schema would reject.
 */

import { render, type Mode, type PendingView, type Pos } from '@vimorror/core';
import {
  GameSession,
  type Difficulty,
  type Entity,
  type SessionEvent,
} from '@vimorror/game';
import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';

import { parseDraft, type DraftParse, type StageDraft } from './draft.ts';
import { keyTokenFor } from './keyboard.ts';
import {
  PRESETS,
  arm,
  record,
  replayAtPresets,
  startRecording,
  type PresetReplay,
  type Recording,
} from './recorder.ts';
import type { EditorAction } from './store.ts';

/**
 * What a live session looks like to the rest of the page. `app.tsx` reads the
 * first four for the grid; the pane reads the rest for itself.
 */
export type PlayView = {
  readonly lines: readonly string[];
  readonly cursor: Pos;
  readonly mode: Mode;
  /** LIVE positions — the authored array never moves, so a threat's chase shows. */
  readonly entities: readonly Entity[];
  readonly pending: PendingView;
  readonly rec: Recording;
  readonly log: readonly string[];
};

/**
 * A bound on the log, not a feature: it renders every frame, and an author who
 * leans on a key would otherwise grow an unbounded array in the render path.
 */
const LOG_MAX = 200;

/**
 * Beats, rejection lines and the outcome — the plan's own list, and deliberately
 * not ticks or threat moves. Both of those are already on screen: the keystroke
 * counter for one, the grid redrawing for the other, so logging them would bury
 * the three lines an author is actually reading.
 */
function logLines(events: readonly SessionEvent[]): string[] {
  const out: string[] = [];
  for (const event of events) {
    if (event.type === 'KeyRejected') out.push(`${event.key}  ${event.line}`);
    else if (event.type === 'CommandRefused') out.push(`${event.keys}  ${event.line}`);
    else if (event.type === 'BeatFired') {
      out.push(`beat ${event.beat.id}${event.beat.startling ? ' (startling)' : ''}: ${event.beat.text}`);
    } else if (event.type === 'OutcomeDecided') {
      // `playing` is unreachable — the session emits this only once the outcome
      // latches — so it logs nothing rather than being folded into either half.
      if (event.outcome.status === 'won') out.push('— WON —');
      else if (event.outcome.status === 'lost') out.push(`— LOST to ${event.outcome.by.kind} —`);
    } else if (event.type === 'BufferSaved') out.push(':w — the host would write the buffer here');
    else if (event.type === 'QuitRequested') out.push(':q — the host would leave the stage here');
  }
  return out;
}

function viewOf(session: GameSession, rec: Recording, log: readonly string[]): PlayView {
  return {
    lines: session.engine.lines,
    cursor: session.engine.cursor,
    mode: session.engine.mode,
    entities: session.entities,
    pending: session.engine.pending,
    rec,
    log,
  };
}

export type PlayPaneProps = {
  readonly draft: StageDraft;
  /** `app.tsx`'s own parse, reused — a second one would be a second answer. */
  readonly parse: DraftParse;
  readonly view: PlayView | undefined;
  readonly onView: (view: PlayView | undefined) => void;
  readonly dispatch: Dispatch<EditorAction>;
};

export function PlayPane({ draft, parse, view, onView, dispatch }: PlayPaneProps) {
  const sessionRef = useRef<GameSession | null>(null);
  /** The live fold — see the header. The view is a render-time copy of this. */
  const liveRef = useRef<{ rec: Recording; log: readonly string[] }>({ rec: startRecording(), log: [] });
  const captureRef = useRef<HTMLDivElement | null>(null);
  /**
   * `nomagic` by default — the strictest preset, so a recording that survives it
   * has faced full threat cadence and an enforced keystroke budget. A route armed
   * on `verymagic` can still fail CI at the other two.
   */
  const [difficulty, setDifficulty] = useState<Difficulty>('nomagic');
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [replays, setReplays] = useState<readonly PresetReplay[] | undefined>(undefined);

  const live = view !== undefined;

  // The capture box mounts with the view, so focus has to wait for the commit
  // that renders it — an author who clicks "playtest" and types must not lose
  // their first keystroke to the button that started it.
  useEffect(() => {
    // The `else` matters: `app.tsx` drops the view when a different stage is
    // opened, and an unmounted box fires no `onBlur`, so the flag would stay
    // stuck at "capturing" over a session that no longer exists.
    if (live) captureRef.current?.focus();
    else setCapturing(false);
  }, [live]);

  function start(): void {
    if (!parse.ok) return;
    setNotice(undefined);
    setReplays(undefined);
    const session = new GameSession(parse.stage, { difficulty });
    sessionRef.current = session;
    liveRef.current = { rec: startRecording(), log: [] };
    onView(viewOf(session, liveRef.current.rec, liveRef.current.log));
  }

  function stop(): void {
    sessionRef.current = null;
    setCapturing(false);
    onView(undefined);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const session = sessionRef.current;
    if (session === null || view === undefined) return;
    const token = keyTokenFor(event);
    // No token, no `preventDefault`: tab still moves focus out of the box and
    // cmd-R still reloads, which is what makes the capture surface escapable.
    if (token === undefined) return;
    event.preventDefault();
    try {
      const events = session.feed(token);
      const { rec, log } = liveRef.current;
      // Bounded HERE rather than in `viewOf`: the ref is the array that
      // accumulates, so slicing only the rendered copy would have left the
      // unbounded growth exactly where the comment on LOG_MAX says it must not be.
      liveRef.current = { rec: record(rec, token, events), log: [...log, ...logLines(events)].slice(-LOG_MAX) };
      onView(viewOf(session, liveRef.current.rec, liveRef.current.log));
    } catch (e) {
      // The recording is untrustworthy from here — a throw means the keystroke's
      // effect is undefined — so it goes away with the session rather than
      // staying armable.
      stop();
      setNotice(`the engine threw on ${JSON.stringify(token)}: ${(e as Error).message}`);
    }
  }

  function armRecording(): void {
    if (view === undefined) return;
    const result = arm(liveRef.current.rec);
    if (!result.ok) {
      setNotice(result.reason);
      setReplays(undefined);
      return;
    }
    const { solution, par } = result.armed;
    // Parsed from a LOCAL copy of the armed draft rather than waiting for the
    // dispatch to come back around, so the preset replay is part of the same
    // click that armed it.
    const armedParse = parseDraft({ ...draft, solution, par });
    setNotice(
      armedParse.ok
        ? `armed: solution ${solution}, par ${par}`
        : `armed: solution ${solution}, par ${par} — the presets were not replayed, the stage has other issues`,
    );
    setReplays(armedParse.ok ? replayAtPresets(armedParse.stage, solution) : undefined);
    dispatch({ kind: 'field-set', field: 'solution', value: solution });
    dispatch({ kind: 'field-set', field: 'par', value: par });
  }

  const outcome = view?.rec.outcome;
  /** The mid-command ghost: what core is holding but has not resolved yet. */
  const ghost = view === undefined ? '' : render(view.pending.keyBuffer);

  return (
    <div className="pane">
      <h2>playtest</h2>

      <div className="field">
        <span className="field-label" title="the preset this session runs at">
          preset
        </span>
        <select
          value={difficulty}
          disabled={live}
          aria-label="difficulty preset"
          onChange={(event) => setDifficulty(event.target.value as Difficulty)}
        >
          {PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
        {live ? (
          <button type="button" onClick={stop}>
            stop
          </button>
        ) : (
          <button type="button" onClick={start} disabled={!parse.ok}>
            playtest
          </button>
        )}
      </div>

      {parse.ok ? null : <p className="note">the stage has to parse before it can be played</p>}

      {view === undefined ? null : (
        <>
          <div
            className={capturing ? 'capture capturing' : 'capture'}
            ref={captureRef}
            tabIndex={0}
            role="application"
            aria-label="playtest key capture"
            onKeyDown={onKeyDown}
            onFocus={() => setCapturing(true)}
            onBlur={() => setCapturing(false)}
          >
            {capturing ? 'capturing — every key goes to the stage (shift-tab to leave)' : 'click here to play'}
          </div>

          <p className="note">
            {view.mode} · {view.rec.keystrokes} keystrokes · {view.rec.tokens.length}{' '}
            {view.rec.tokens.length === 1 ? 'key' : 'keys'} recorded
            {ghost === '' ? '' : ` · typed: ${ghost}`}
          </p>

          {outcome === undefined || outcome.status === 'playing' ? null : (
            <p className={outcome.status === 'won' ? 'ok' : 'bad'}>
              {outcome.status === 'won' ? 'won' : `lost to ${outcome.by.kind}`}
            </p>
          )}

          {/* Enabled as soon as anything is recorded, NOT only on a win. `arm`
              is the authority on whether a recording can become a solution and it
              returns a reason for every refusal — gating the button on the
              outcome re-implemented one third of that rule here and hid the other
              two thirds, so a recording that tripped a locked key and therefore
              never won had no way to say so. Found in the browser: the reason is
              the whole point of the button existing before the win. */}
          <button type="button" onClick={armRecording} disabled={view.rec.tokens.length === 0}>
            arm as solution + par
          </button>

          {view.log.length === 0 ? null : (
            <pre className="log">{view.log.join('\n')}</pre>
          )}
        </>
      )}

      {notice === undefined ? null : <p className="note">{notice}</p>}

      {replays === undefined ? null : (
        <ul className="presets">
          {replays.map((replay) => (
            <li key={replay.difficulty} className={replay.won ? 'ok' : 'bad'}>
              {replay.difficulty}: {replay.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
