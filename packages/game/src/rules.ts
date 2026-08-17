/**
 * Win/lose evaluation — pure, run once per tick, after the threats have moved.
 *
 * One condition vocabulary, three consumers: `win` (ALL must hold), `lose`
 * (ANY fires), and a story beat's `on` (evaluated by `session.ts` with the
 * same `evalCondition`). Conditions read LIVE entity positions — threats move,
 * the stage's own array never does — and the transient `reached` set, because
 * `threat-reaches-cursor` is an event-shaped condition: it is true on the tick
 * a threat moves onto the cursor and on no other.
 *
 * **Lose is checked before win.** On the tick where both would fire — the
 * threat lands on you exactly as you land on the exit — the threat gets you.
 * This is a horror game; mercy on ties would be the genre lying about itself.
 * The schema keeps the common case honest anyway: a `keystrokes-over` budget
 * below the shipped solution's length is rejected at parse time, so a stage
 * can never lose-on-tie against its own solution.
 */

import type { Pos } from '@vimorror/core';
import { entityById, occupies } from './entities.ts';
import type { Condition, Entity, Stage } from './schema.ts';

export type RuleContext = {
  readonly lines: readonly string[];
  readonly cursor: Pos;
  /** LIVE entity positions, i.e. `session.ts`'s copy after this tick's `stepThreats`. */
  readonly entities: readonly Entity[];
  /** Keystrokes across RESOLVED commands only — rejected keys never counted. */
  readonly keystrokes: number;
  /** Threat ids that moved onto the cursor THIS tick (`ThreatTick.reached`). */
  readonly reached: ReadonlySet<string>;
};

export type Outcome =
  | { readonly status: 'playing' }
  | { readonly status: 'won' }
  /** `by` names the condition that fired, so M4 can say WHICH death this was. */
  | { readonly status: 'lost'; readonly by: Condition };

export function evalCondition(c: Condition, ctx: RuleContext): boolean {
  switch (c.kind) {
    case 'cursor-on': {
      const target = entityById(ctx.entities, c.entity);
      return target !== undefined && occupies(target, ctx.cursor);
    }
    case 'buffer-equals':
      return c.lines.length === ctx.lines.length && c.lines.every((line, i) => line === ctx.lines[i]);
    case 'keystrokes-over':
      // Strictly over: winning on exactly the budget's last keystroke is a win.
      return ctx.keystrokes > c.max;
    case 'threat-reaches-cursor':
      return ctx.reached.size > 0;
  }
}

export function evaluate(stage: Pick<Stage, 'win' | 'lose'>, ctx: RuleContext): Outcome {
  const fired = stage.lose.find((c) => evalCondition(c, ctx));
  if (fired !== undefined) return { status: 'lost', by: fired };
  if (stage.win.every((c) => evalCondition(c, ctx))) return { status: 'won' };
  return { status: 'playing' };
}
