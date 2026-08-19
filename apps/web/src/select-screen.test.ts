/**
 * The act fold, and the one property of it that matters: it groups CONSECUTIVE
 * runs and never reorders.
 *
 * The shipped campaign is already in act order, so on real content a sort and a
 * fold are indistinguishable — which is exactly why the drift is worth pinning.
 * A sort would silently "fix" a manifest that doubles back, hiding a curriculum
 * mistake behind a tidy screen.
 */

import { describe, expect, it } from 'vitest';

import { stages } from './campaign.ts';
import { byAct } from './select-screen.tsx';

/** Only `act` and `id` matter here; the rest of a `Stage` is beside the point. */
const stage = (id: string, act: number) => ({ id, act }) as unknown as Parameters<typeof byAct>[0][number];

describe('byAct', () => {
  it('groups the shipped campaign as three act-1 stages then one act-2', () => {
    expect(byAct(stages).map((g) => [g.act, g.stages.map((s) => s.id)])).toEqual([
      [1, ['act1-two-worlds', 'act1-four-directions', 'act1-word-power']],
      [2, ['act2-grammar-awakens']],
    ]);
  });

  it('keeps every stage, in the order given', () => {
    expect(byAct(stages).flatMap((g) => g.stages.map((s) => s.id))).toEqual(stages.map((s) => s.id));
  });

  it('opens a NEW group when an act recurs — it does not gather strays', () => {
    const manifest = [stage('a', 1), stage('b', 2), stage('c', 1)];
    expect(byAct(manifest).map((g) => [g.act, g.stages.map((s) => s.id)])).toEqual([
      [1, ['a']],
      [2, ['b']],
      [1, ['c']],
    ]);
  });

  it('is empty for an empty campaign rather than producing a headless group', () => {
    expect(byAct([])).toEqual([]);
  });
});
