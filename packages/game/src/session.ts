/**
 * `GameSession` — the façade, this package's `pipeline.ts`-equivalent and its
 * only stateful file. Owns a `VimEngine` plus a stage: keys go in through the
 * stage's key policy, each resolved command ticks the world (`tick.ts`),
 * rules run after the tick (`rules.ts`), beats fire once each, and the whole
 * turn comes back as a typed `SessionEvent[]` for M4 to render.
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
  type InvalidReason,
  type KeyToken,
  type ResolvedCommand,
} from '@vimorror/core';
import { rejectionLine, stageKeyPolicy } from './gating.ts';
import { evalCondition, evaluate, type Outcome, type RuleContext } from './rules.ts';
import { stepThreats } from './tick.ts';
import type { Beat, Entity, Stage } from './schema.ts';

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

export class GameSession {
  readonly stage: Stage;
  readonly engine: VimEngine;
  #entities: readonly Entity[];
  #keystrokes = 0;
  #outcome: Outcome = { status: 'playing' };
  #firedBeats = new Set<string>();

  constructor(stage: Stage) {
    this.stage = stage;
    // A parsed stage's options are a COMPLETE EditorOptions by construction —
    // this seam is why the schema refuses to emit a partial.
    this.engine = new VimEngine(stage.buffer, stage.cursor, stage.options);
    this.engine.setKeyPolicy(stageKeyPolicy(stage));
    this.#entities = stage.entities;
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

  feed(key: KeyToken): SessionEvent[] {
    if (this.#outcome.status !== 'playing') return [];
    const out: SessionEvent[] = [];
    for (const e of this.engine.feed(key)) {
      if (e.type === 'KeyRejected') {
        out.push({ type: 'KeyRejected', key: e.key, reason: e.reason, line: rejectionLine(e.reason) });
      } else if (e.type === 'InvalidCommand') {
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

  #tick(command: ResolvedCommand): SessionEvent[] {
    this.#keystrokes += command.keystrokes;
    const out: SessionEvent[] = [{ type: 'Tick', command, keystrokes: this.#keystrokes }];

    const { entities, moved, reached } = stepThreats(this.#entities, this.engine.cursor);
    this.#entities = entities;
    for (const entity of moved) out.push({ type: 'ThreatMoved', entity });

    const ctx: RuleContext = {
      lines: this.engine.lines,
      cursor: this.engine.cursor,
      entities,
      keystrokes: this.#keystrokes,
      reached,
    };

    for (const beat of this.stage.beats) {
      if (!this.#firedBeats.has(beat.id) && evalCondition(beat.on, ctx)) {
        this.#firedBeats.add(beat.id);
        out.push({ type: 'BeatFired', beat });
      }
    }

    const outcome = evaluate(this.stage, ctx);
    if (outcome.status !== 'playing') {
      this.#outcome = outcome;
      out.push({ type: 'OutcomeDecided', outcome });
    }
    return out;
  }
}
