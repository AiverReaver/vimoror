/**
 * The solution recorder — the highest-leverage feature in the plan, and a pure
 * state machine so all of it is testable without a DOM.
 *
 * The claim it makes good on: **one recording yields par, the hint data and a
 * regression test.** Par is the recorded token count. The hint data is
 * `hints.ts`'s `solutionPath`, derived from the solution with no second field to
 * drift. The regression test is the exported stage itself, replayed by
 * `validate:stages` in CI. Nothing here computes any of the three a second time;
 * it captures what was played and hands it to the things that already exist.
 *
 * This file holds no session. The play pane owns the live `GameSession` (mutable,
 * un-serialisable, React-hostile) and hands each `(token, events)` pair here, so
 * everything below is a fold over the event stream `session.feed` already
 * returns — no second copy of the loop, and no need to reach into engine state to
 * learn what a key did.
 *
 * Three rules, each measured against a real session rather than assumed:
 *
 * 1. **A recording containing a REJECTED key cannot arm.** The stage would reject
 *    its own solution — `schema.ts` says exactly that — and the recording cannot
 *    be repaired by dropping the offending key, because a rejection forfeits the
 *    whole half-typed command with it (`engine.ts`'s `#pendingKeys` slice), so the
 *    surviving tokens would splice a dangling operator onto whatever came next.
 *    The check is on ANY `KeyRejected`, not only one whose key the author pressed:
 *    a rejection from INSIDE a replay (`@a`, `:normal`) surfaces on this same
 *    stream with a different key and does *not* forfeit anything, so the schema's
 *    own top-level-token check is blind to it while `validate:stages` — which
 *    filters every `KeyRejected` — is not. Arming through that gap would ship a
 *    stage that fails CI having passed the editor.
 * 2. **A FAILED command stays armable.** `tools/validate-stages.ts` states the
 *    reason in its own header: a human's recorded route may legitimately contain
 *    a motion that failed, and the gate asks for a win using permitted keys, not
 *    a flawless one. Measured on the act2 fixture: `di(kG` refuses `k` at line 0,
 *    still resolves, still ticks, still wins — five tokens, five keystrokes.
 * 3. **A decided recording ignores every further token**, mirroring
 *    `GameSession.feed`, which returns `[]` once the outcome latches. Without
 *    this the token list would grow keys the session never saw, and the armed
 *    solution would carry a tail that does nothing — or, worse, whose tokens
 *    push it past `par`.
 *
 * **`par` is `tokens.length`, not `session.keystrokes`**, and the two are equal
 * at a clean win rather than interchangeable. `schema.ts` compares
 * `tokenize(solution).length > par`, so par must be at least the token count;
 * keystrokes counts only RESOLVED commands, which is the same number exactly when
 * no key was rejected and the win landed at rest — and a win can only land at
 * rest, since the outcome is evaluated inside a tick. Both are carried so the
 * keystone test can assert the equality instead of the code assuming it.
 */

import { render, type KeyToken } from '@vimorror/core';
import { GameSession, type Difficulty, type Outcome, type SessionEvent, type Stage } from '@vimorror/game';

/** A rejected key, with the in-fiction line the session gave for it. */
export type RejectedKey = {
  readonly key: KeyToken;
  readonly line: string;
};

export type Recording = {
  /** Every token fed while the session was still playing, in order. */
  readonly tokens: readonly KeyToken[];
  /** The session's own tally — resolved commands only. See the header. */
  readonly keystrokes: number;
  readonly rejected: readonly RejectedKey[];
  readonly outcome: Outcome;
};

export function startRecording(): Recording {
  return { tokens: [], keystrokes: 0, rejected: [], outcome: { status: 'playing' } };
}

/** Fold one fed token and the events it produced into the recording. */
export function record(rec: Recording, token: KeyToken, events: readonly SessionEvent[]): Recording {
  if (rec.outcome.status !== 'playing') return rec;

  let keystrokes = rec.keystrokes;
  // Annotated, because the guard above has already narrowed `rec.outcome` to
  // `playing` and the assignment below widens it back.
  let outcome: Outcome = rec.outcome;
  const rejected = [...rec.rejected];
  for (const event of events) {
    if (event.type === 'Tick') keystrokes = event.keystrokes;
    else if (event.type === 'KeyRejected') rejected.push({ key: event.key, line: event.line });
    else if (event.type === 'OutcomeDecided') outcome = event.outcome;
  }
  return { tokens: [...rec.tokens, token], keystrokes, rejected, outcome };
}

/** What arming writes into the draft — the two fields, and nothing else. */
export type Armed = {
  readonly solution: string;
  readonly par: number;
};

export type ArmResult =
  | { readonly ok: true; readonly armed: Armed }
  | { readonly ok: false; readonly reason: string };

/**
 * Turn a finished recording into a `solution`/`par` pair, or say why not.
 *
 * Rejections are reported before the outcome because they are the actionable
 * failure: a locked key is a stage-authoring mistake either way, and a recording
 * that hit one usually never won *because* of it.
 */
export function arm(rec: Recording): ArmResult {
  if (rec.rejected.length > 0) {
    const keys = [...new Set(rec.rejected.map((r) => r.key))].map((k) => JSON.stringify(k)).join(', ');
    return {
      ok: false,
      reason:
        `${keys} was rejected during the recording, so the stage would reject its own solution. ` +
        `A rejected key forfeits the whole half-typed command with it, so the recording cannot be ` +
        `repaired by dropping it — grant the key in allowedKeys, or take a route that avoids it, and record again.`,
    };
  }
  if (rec.outcome.status === 'lost') {
    return { ok: false, reason: `the recording ends in a loss (${rec.outcome.by.kind}) — a solution has to win.` };
  }
  if (rec.outcome.status !== 'won') {
    return { ok: false, reason: 'the stage has not been won yet — a solution is a route that wins it.' };
  }
  return { ok: true, armed: { solution: render(rec.tokens), par: rec.tokens.length } };
}

/** Strictest last, so a budget failure reads as the escalation it is. */
export const PRESETS: readonly Difficulty[] = ['verymagic', 'magic', 'nomagic'];

export type PresetReplay = {
  readonly difficulty: Difficulty;
  readonly won: boolean;
  /** What the replay did, in `validate-stages.ts`'s own terms. */
  readonly detail: string;
};

/**
 * The gate, run at record time.
 *
 * This is `tools/validate-stages.ts`'s replay loop reached through the same
 * public API — `new GameSession(stage, { difficulty }).feedKeys(solution)` — and
 * not a second copy of it, because `GameSession` *is* the shared thing (that
 * script's own header says so). It cannot import the script: that file reads
 * `node:fs` at module scope and pushes problems keyed by filename, neither of
 * which exists in a browser.
 *
 * Running it here is what makes CI's answer arrive in the editor instead: a stage
 * whose route wins on `verymagic` and loses on `nomagic` — measured as real, a
 * threat taking one step per three ticks instead of three — is a stage the author
 * finds out about while they still have the recording, not on a red build.
 *
 * The rejection check mirrors the validator's own for the reason `arm` documents:
 * a rejection from inside a replay is invisible to the schema, so without it the
 * editor could report three clean presets on a stage CI then fails.
 */
export function replayAtPresets(stage: Stage, solution: string): readonly PresetReplay[] {
  return PRESETS.map((difficulty) => {
    const session = new GameSession(stage, { difficulty });
    const events = session.feedKeys(solution);
    const rejected = [...new Set(events.filter((e) => e.type === 'KeyRejected').map((e) => e.key))];
    const outcome = session.outcome;
    const detail =
      outcome.status === 'won'
        ? `won in ${session.keystrokes} keystrokes`
        : outcome.status === 'lost'
          ? `lost to ${outcome.by.kind}`
          : 'never won — still playing when the solution ran out';
    return {
      difficulty,
      won: outcome.status === 'won' && rejected.length === 0,
      detail: rejected.length === 0 ? detail : `${detail}; keys rejected: ${rejected.join(' ')}`,
    };
  });
}
