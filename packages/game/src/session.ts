/**
 * `GameSession` — the façade, this package's `pipeline.ts`-equivalent and its
 * only stateful file. Owns a `VimEngine` plus a stage: keys go in through the
 * stage's key policy, each resolved command ticks the world (`tick.ts`),
 * rules run after the tick (`rules.ts`), beats fire once each, and the whole
 * turn comes back as a typed `SessionEvent[]` for M4 to render.
 *
 * Wave D hung the dials here, and this is the only file any of them touch —
 * which is the point. Difficulty (`difficulty.ts`) reaches the loop as four
 * values: a lose list filtered before play, a tick period for the chase, an
 * event this file declines to emit, and a hint policy. Comfort (`gentle.ts`)
 * reaches it as one predicate at the beat-emission point. Neither ever reaches
 * `vim-core`, and `rules.ts`/`tick.ts` never learn that either exists.
 *
 * The event order within one turn is fixed and load-bearing:
 * `Tick` → `ThreatMoved`* → `BeatFired`* → `OutcomeDecided`. Beats are
 * evaluated BEFORE the outcome latches so a beat conditioned on the winning
 * cell still fires on the winning tick — `act2-grammar-awakens`'s exit beat
 * is exactly that shape.
 *
 * A decided session is frozen: once `won` or `lost`, `feed` ignores every
 * further key. The engine underneath is still reachable via `.engine` for
 * whatever M4 wants to show of the corpse.
 */

import {
  VimEngine,
  tokenize,
  type EngineSnapshot,
  type InvalidReason,
  type KeyToken,
  type ResolvedCommand,
} from '@vimorror/core';
import {
  DEFAULT_DIFFICULTY,
  enforcedLose,
  modifiersFor,
  type Difficulty,
  type Modifiers,
} from './difficulty.ts';
import { rejectionLine, stageKeyPolicy } from './gating.ts';
import { allowsBeat, DEFAULT_COMFORT, type Comfort } from './gentle.ts';
import { hintFor, type Hint } from './hints.ts';
import { evalCondition, evaluate, type Outcome, type RuleContext } from './rules.ts';
import { isUndoCommand, scoreRun, type Score } from './scoring.ts';
import { stepThreats } from './tick.ts';
import type { Beat, Condition, Entity, Stage } from './schema.ts';

/** Difficulty and comfort are independent axes; neither defaults from the other. */
export type SessionSettings = {
  readonly difficulty?: Difficulty;
  readonly comfort?: Comfort;
};

export type SessionEvent =
  /** Core's `KeyRejected`, enriched with the in-character line. Never ticks. */
  | { readonly type: 'KeyRejected'; readonly key: KeyToken; readonly reason: InvalidReason; readonly line: string }
  /** A command that ran and FAILED (core's `InvalidCommand`). It still ticks. */
  | { readonly type: 'CommandRefused'; readonly keys: string; readonly reason: InvalidReason; readonly line: string }
  /** One act: a resolved command, with the running keystroke total after it. */
  | { readonly type: 'Tick'; readonly command: ResolvedCommand; readonly keystrokes: number }
  /** A threat took its chase step; `entity` carries the new position. */
  | { readonly type: 'ThreatMoved'; readonly entity: Entity }
  | { readonly type: 'BeatFired'; readonly beat: Beat }
  | { readonly type: 'OutcomeDecided'; readonly outcome: Outcome }
  /**
   * Core's `:w`/`:q`, passed through: zero-I/O core delegates the actual save
   * and the meaning of "quit" to the host, and they leave NO trace in engine
   * state to read back later — this stream is their only conduit.
   */
  | { readonly type: 'BufferSaved'; readonly force: boolean }
  | { readonly type: 'QuitRequested'; readonly force: boolean };

/**
 * A save of a play in progress — `EngineSnapshot` one layer up, and the same
 * lesson: **wrong looks exactly like right here.** Every field below was
 * measured as silently lost before Wave E, and none of them throws when it
 * goes missing. A restored session would hand back the AUTHORED entity array
 * (so every threat teleports to where the author drew it), a zero keystroke
 * tally, a tick count whose parity decides the chase cadence on `verymagic`,
 * a clean-run flag that lies, a decided outcome forgotten, and a fired-beat
 * set armed to fire every beat a second time.
 *
 * The split is authored-vs-evolved, and it is the whole design:
 *
 * - **Evolved state lives here** — the engine, the LIVE entity positions, the
 *   tallies, the outcome, the fired beats, and the two settings the player
 *   chose. `restore()` takes them verbatim.
 * - **Authored state lives in the `Stage`** the host supplies to `restore()`,
 *   and is never carried: `win`/`lose`/`beats`/`par`/`solution`/`allowedKeys`
 *   are re-read from it, so a stage corrected in M3's editor takes effect on
 *   the next load instead of a stale copy persisting inside every save.
 *
 * `stageId` is the guard that keeps those two halves honest — restoring one
 * stage's play onto another's rules would produce a session that runs, evaluates
 * the wrong conditions and reports the wrong outcome, so `restore()` refuses.
 *
 * `firedBeats` is an array rather than the `Set` it restores to for Wave A's
 * reason, verbatim: **`JSON.stringify` renders a `Set` as `{}`**, so a save that
 * "carried" it would typecheck, throw nothing, and load with every beat rearmed.
 * The only test that sees that failure re-snapshots a restored session and
 * compares the JSON strings.
 *
 * M4's `localStorage` save is the consumer and owns the envelope around this —
 * its own `schemaVersion` included; nothing here is versioned.
 */
export type SessionSnapshot = {
  /** The stage this play belongs to. `restore()` refuses a different one. */
  readonly stageId: string;
  readonly engine: EngineSnapshot;
  /** LIVE positions, i.e. every threat where the chase left it. */
  readonly entities: readonly Entity[];
  readonly keystrokes: number;
  /** Decides threat cadence parity: a wrong tick count moves threats on the wrong turns. */
  readonly ticks: number;
  readonly undos: number;
  readonly hintsShown: number;
  readonly outcome: Outcome;
  /** `#firedBeats` flattened — a `Set` JSONs to `{}`. */
  readonly firedBeats: readonly string[];
  readonly difficulty: Difficulty;
  readonly comfort: Comfort;
};

export class GameSession {
  /** The stage AS AUTHORED. Difficulty eases what is enforced, never the content. */
  readonly stage: Stage;
  /** Private so `restore()` can swap in a restored engine; `engine` is the reader. */
  #engine: VimEngine;
  readonly difficulty: Difficulty;
  readonly comfort: Comfort;
  readonly modifiers: Modifiers;
  /** The lose conditions this difficulty actually enforces (`difficulty.ts`). */
  readonly #lose: readonly Condition[];
  #entities: readonly Entity[];
  #keystrokes = 0;
  #ticks = 0;
  #undos = 0;
  #hintsShown = 0;
  #outcome: Outcome = { status: 'playing' };
  #firedBeats = new Set<string>();

  constructor(stage: Stage, settings: SessionSettings = {}) {
    this.stage = stage;
    this.difficulty = settings.difficulty ?? DEFAULT_DIFFICULTY;
    this.comfort = settings.comfort ?? DEFAULT_COMFORT;
    this.modifiers = modifiersFor(this.difficulty);
    this.#lose = enforcedLose(stage, this.modifiers);
    // A parsed stage's options are a COMPLETE EditorOptions by construction —
    // this seam is why the schema refuses to emit a partial.
    this.#engine = new VimEngine(stage.buffer, stage.cursor, stage.options);
    this.#engine.setKeyPolicy(stageKeyPolicy(stage));
    this.#entities = stage.entities;
  }

  get engine(): VimEngine {
    return this.#engine;
  }

  get outcome(): Outcome {
    return this.#outcome;
  }

  /** Keystrokes across resolved commands — what `keystrokes-over` and scoring count. */
  get keystrokes(): number {
    return this.#keystrokes;
  }

  /** LIVE entity positions. The stage's own array never moves; this one does. */
  get entities(): readonly Entity[] {
    return this.#entities;
  }

  get score(): Score {
    return scoreRun(
      { keystrokes: this.#keystrokes, undos: this.#undos, hintsShown: this.#hintsShown },
      this.stage.par,
      this.difficulty,
    );
  }

  /**
   * The next command of the solution from where the player actually stands.
   *
   * `none` (`nomagic`) refuses outright. `on-request` (`magic`) charges the
   * clean-run flag — but only when a hint really comes back, so asking on a
   * finished stage is not a penalty for nothing. `always` (`verymagic`) leaves
   * the tally alone because the run was never clean to begin with: the hint has
   * been on screen the whole time.
   */
  hint(): Hint | undefined {
    // A decided session is frozen for hints too, or a post-mortem hint request
    // would keep charging a score the run has already finished — `hintFor` is
    // exported and pure, so a loss screen can still show the route it took.
    if (this.#outcome.status !== 'playing' || this.modifiers.hints === 'none') return undefined;
    const hint = hintFor(this.stage, { lines: this.#engine.lines, cursor: this.#engine.cursor });
    if (hint !== undefined && this.modifiers.hints === 'on-request') this.#hintsShown += 1;
    return hint;
  }

  feed(key: KeyToken): SessionEvent[] {
    if (this.#outcome.status !== 'playing') return [];
    const out: SessionEvent[] = [];
    for (const e of this.#engine.feed(key)) {
      if (e.type === 'KeyRejected') {
        out.push({ type: 'KeyRejected', key: e.key, reason: e.reason, line: rejectionLine(e.reason) });
      } else if (e.type === 'InvalidCommand') {
        // `verymagic`'s "motions clamp instead of failing". Core already leaves
        // the cursor wherever the motion could not pass, so what Easy eases is
        // the line — the command still resolves, still costs, still ticks.
        if (this.modifiers.silenceFailedMotions && e.reason === 'motion-failed') continue;
        out.push({ type: 'CommandRefused', keys: e.keys, reason: e.reason, line: rejectionLine(e.reason) });
      } else if (e.type === 'BufferSaved' || e.type === 'QuitRequested') {
        out.push(e);
      } else if (e.type === 'CommandResolved') {
        out.push(...this.#tick(e.command));
      }
    }
    return out;
  }

  /** Feed authoring notation. A mid-string win or loss freezes the rest of the string. */
  feedKeys(notation: string): SessionEvent[] {
    return tokenize(notation).flatMap((k) => this.feed(k));
  }

  /** Save a play in progress. JSON-safe by construction — see `SessionSnapshot`. */
  snapshot(): SessionSnapshot {
    return {
      stageId: this.stage.id,
      engine: this.#engine.snapshot(),
      // The LIVE array. `tick.ts` replaces entity objects rather than mutating
      // them, so a shallow copy is a real copy — and this must never be
      // `stage.entities`, or every threat reloads at its authored position.
      entities: [...this.#entities],
      keystrokes: this.#keystrokes,
      ticks: this.#ticks,
      undos: this.#undos,
      hintsShown: this.#hintsShown,
      outcome: this.#outcome,
      firedBeats: [...this.#firedBeats],
      difficulty: this.difficulty,
      comfort: this.comfort,
    };
  }

  /**
   * Load a saved play onto its stage. The stage is supplied rather than carried
   * (see `SessionSnapshot`): authored rules always come from it, evolved state
   * always from the save.
   *
   * Throws on a stage mismatch. That is the one loud failure on a surface where
   * everything else fails quietly: a play restored onto the wrong stage runs
   * perfectly and evaluates the wrong conditions.
   */
  static restore(stage: Stage, snap: SessionSnapshot): GameSession {
    if (snap.stageId !== stage.id) {
      throw new Error(`snapshot belongs to stage "${snap.stageId}", not "${stage.id}"`);
    }
    // Through the ordinary constructor, so `#lose` is re-derived from the
    // restored difficulty rather than being a tenth thing to carry and desync.
    const session = new GameSession(stage, { difficulty: snap.difficulty, comfort: snap.comfort });
    session.#engine = VimEngine.restore(snap.engine);
    // Re-derived, not taken from the engine save: the policy is AUTHORED state,
    // and `stageKeyPolicy` is where `<Esc>` gets its un-lockable grant. A save
    // written before a stage's `allowedKeys` was corrected must not keep gating
    // by the old list.
    session.#engine.setKeyPolicy(stageKeyPolicy(stage));
    session.#entities = [...snap.entities];
    session.#keystrokes = snap.keystrokes;
    session.#ticks = snap.ticks;
    session.#undos = snap.undos;
    session.#hintsShown = snap.hintsShown;
    session.#outcome = snap.outcome;
    session.#firedBeats = new Set(snap.firedBeats);
    return session;
  }

  #tick(command: ResolvedCommand): SessionEvent[] {
    this.#keystrokes += command.keystrokes;
    this.#ticks += 1;
    if (isUndoCommand(command.shape)) this.#undos += 1;
    const out: SessionEvent[] = [{ type: 'Tick', command, keystrokes: this.#keystrokes }];

    // Half speed is a skipped chase step, not a slower one: the world still
    // moves only when the player acts, just not on every act.
    const chases = this.#ticks % this.modifiers.threatPeriod === 0;
    const { entities, moved, reached } = chases
      ? stepThreats(this.#entities, this.#engine.cursor)
      : { entities: this.#entities, moved: [], reached: new Set<string>() };
    this.#entities = entities;
    for (const entity of moved) out.push({ type: 'ThreatMoved', entity });

    const ctx: RuleContext = {
      lines: this.#engine.lines,
      cursor: this.#engine.cursor,
      entities,
      keystrokes: this.#keystrokes,
      reached,
    };

    for (const beat of this.stage.beats) {
      if (this.#firedBeats.has(beat.id) || !evalCondition(beat.on, ctx)) continue;
      // Marked fired whether or not it is emitted, so comfort settings change
      // WHICH beats a player sees and nothing else — same buffer, same ticks,
      // same outcome, and a replay reproduces under either setting.
      this.#firedBeats.add(beat.id);
      if (allowsBeat(beat, this.comfort)) out.push({ type: 'BeatFired', beat });
    }

    const outcome = evaluate({ win: this.stage.win, lose: this.#lose }, ctx);
    if (outcome.status !== 'playing') {
      this.#outcome = outcome;
      out.push({ type: 'OutcomeDecided', outcome });
    }
    return out;
  }
}
