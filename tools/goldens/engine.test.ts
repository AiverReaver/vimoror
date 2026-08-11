/**
 * The primary test: our engine vs real Vim, over every committed golden.
 *
 * FAMILIES lists the golden families the engine is currently expected to pass.
 * It grows one entry per wave. Keeping it explicit means an unimplemented wave
 * reads as "not yet claimed" rather than as a silent gap in coverage.
 */

import { describe, expect, it } from 'vitest';

import { describeDiffs, loadGoldens, runGolden } from './compare.ts';

const FAMILIES = [
  'wave1',
  'wave2-delete',
  'wave2-change',
  'wave2-yank',
  'wave2-doubled',
  'wave2-shortcuts',
  'wave2-caseops',
  'wave2-indent',
  'wave2-insert',
  'wave3-paste',
  'wave3-textobj',
];

for (const family of FAMILIES) {
  describe(`goldens: ${family}`, () => {
    const goldens = loadGoldens(family);

    it('has cases', () => {
      expect(goldens.length).toBeGreaterThan(0);
    });

    for (const g of goldens) {
      it(g.id, () => {
        const diffs = runGolden(g);
        if (diffs.length > 0) throw new Error(`\n${describeDiffs(g, diffs)}`);
      });
    }
  });
}
