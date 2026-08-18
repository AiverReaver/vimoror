/**
 * triage.ts — turn a fuzz mismatch into something a human can act on.
 *
 *   pnpm fuzz:triage                 minimize the 6 shortest mismatches
 *   WANT=12 N=4000 SEED=3 pnpm fuzz:triage
 *   IDS=1 pnpm fuzz:triage           print only the failing case ids
 *
 * `pnpm test:fuzz` answers "is anything wrong" and prints whatever it finds, in
 * generation order. That is the wrong shape for fixing things: a random
 * mismatch is a 60-key sequence over a five-line buffer, and almost all of it
 * is irrelevant to the bug. `docs/HANDOFF.md`'s triage instructions say to pick
 * "the shortest remaining mismatches (short atom count = least confounded)",
 * which is exactly what this does — and then goes further and MINIMIZES them.
 *
 * Two modes, both reusing the same oracle and comparator as the committed
 * goldens (`runVim`, `runGolden`), so a triaged case is still just an
 * uncommitted golden:
 *
 * - **minimize** (default) — sort mismatches by atom count, then greedily drop
 *   one atom at a time for as long as the case still mismatches, then do the
 *   same to the buffer's lines. Each round is ONE batched Vim process, so a
 *   40-atom case minimizes in well under a second of Vim time. Output is a case
 *   small enough to paste straight into `cases/*.yaml`. The 2026-08-18 run
 *   reduced a 60-key sequence to `yaW` on `['   ']`, which was a real bug.
 * - **ids** (`IDS=1`) — print just the failing ids, for set-diffing across a
 *   code change: capture before, capture after, `comm` the two. A net mismatch
 *   COUNT cannot tell "fixed 5, broke 2" from "fixed 3", and the whitespace-`aW`
 *   fix really did have a candidate regression to rule out (two wrongs had been
 *   cancelling on one shape), so the set is the thing worth comparing.
 *
 * Minimization is greedy single-atom removal, not full delta debugging: it can
 * stop at a local minimum where dropping any ONE atom fixes the case but
 * dropping two would not.
 * // ponytail: good enough at these sizes — every case it has been run on
 * // reduced to one or two atoms. Reach for ddmin only if something stalls big.
 */

import fc from 'fast-check';

import { describeDiffs, runGolden } from './compare.ts';
import { runVim, type CaseSpec, type Golden } from './generate.ts';
import { caseArb, isSafe } from './fuzz.ts';

type Case = { buffer: string[]; cursor: [number, number]; groups: string[] };
type Mismatch = { c: Case; diffs: ReturnType<typeof runGolden>; golden: Golden; id: string };

const BATCH = 250;

/** Run cases through real Vim and this engine, and keep the ones that disagree. */
function mismatchesOf(cases: readonly Case[], label: string, ids?: readonly string[]): Mismatch[] {
  const specs: CaseSpec[] = [];
  const keep: { c: Case; id: string }[] = [];
  cases.forEach((c, i) => {
    const keys = c.groups.join('');
    // An empty sequence has nothing to diff, and the sanitizer is what keeps a
    // generated `:q`/`:!` from taking the batched Vim process down with it.
    if (keys.length === 0 || !isSafe(keys)) return;
    const id = ids?.[i] ?? `${label}-${i}`;
    specs.push({ id, buffer: c.buffer, cursor: c.cursor, keys, groups: c.groups });
    keep.push({ c, id });
  });

  const out: Mismatch[] = [];
  for (let start = 0; start < specs.length; start += BATCH) {
    const batch = specs.slice(start, start + BATCH);
    const results = runVim(batch, `${label}-${start}`);
    batch.forEach((spec, i) => {
      const { id: _id, ...expect } = results[i]!;
      const golden: Golden = { ...spec, encodedKeys: spec.keys, expect };
      const diffs = runGolden(golden);
      const from = keep[start + i]!;
      if (diffs.length > 0) out.push({ c: from.c, diffs, golden, id: from.id });
    });
  }
  return out;
}

const renderedLength = (c: Case): number => c.groups.join('').length;

/** Greedily drop atoms, then buffer lines, for as long as the case still mismatches. */
function minimize(start: Case, label: string): Case {
  let best = start;

  while (best.groups.length > 1) {
    const candidates = best.groups.map((_, i) => ({
      ...best,
      groups: best.groups.filter((__, j) => j !== i),
    }));
    const still = mismatchesOf(candidates, `${label}-atoms`);
    if (still.length === 0) break;
    best = still.sort((a, b) => renderedLength(a.c) - renderedLength(b.c))[0]!.c;
  }

  while (best.buffer.length > 1) {
    // The cursor is 1-BASED here, matching `CaseSpec`, so a dropped line must
    // not leave it past the end — those candidates are skipped rather than
    // clamped, since moving the cursor would change the case being minimized.
    const candidates = best.buffer
      .map((_, i) => ({ ...best, buffer: best.buffer.filter((__, j) => j !== i) }))
      .filter((c) => c.cursor[0] <= c.buffer.length);
    const still = mismatchesOf(candidates, `${label}-lines`);
    if (still.length === 0) break;
    best = still[0]!.c;
  }

  return best;
}

export function main(): void {
  const seed = Number(process.env['SEED'] ?? 1);
  const n = Number(process.env['N'] ?? 1500);
  const want = Number(process.env['WANT'] ?? 6);
  const idsOnly = process.env['IDS'] === '1';

  const sample = fc.sample(caseArb, { numRuns: n, seed }) as Case[];
  const ids = sample.map((_, i) => `c-${i}`);
  const bad = mismatchesOf(sample, 'scan', ids);

  if (idsOnly) {
    console.log(bad.map((m) => m.id).join('\n'));
    return;
  }

  console.error(`seed=${seed}: ${bad.length} mismatch(es) of ${sample.length}\n`);

  const shortest = bad
    .sort((a, b) => a.c.groups.length - b.c.groups.length || renderedLength(a.c) - renderedLength(b.c))
    .slice(0, want);

  shortest.forEach((m, i) => {
    const min = minimize(m.c, `min${i}`);
    const again = mismatchesOf([min], `re${i}`)[0];
    console.log(`=== ${m.id}  ->  ${min.groups.length} atom(s), ${renderedLength(min)} key chars`);
    console.log(`    buffer: ${JSON.stringify(min.buffer)}`);
    console.log(`    cursor: [${min.cursor[0]}, ${min.cursor[1]}]   (1-based, as cases/*.yaml wants)`);
    console.log(`    keys:   ${JSON.stringify(min.groups.join(''))}`);
    // Re-run rather than reusing the scan's diffs: they describe the ORIGINAL
    // case, and after minimization the interesting divergence may be narrower.
    if (again !== undefined) console.log(describeDiffs(again.golden, again.diffs).split('\n').slice(1).join('\n'));
    console.log('');
  });
}

main();
