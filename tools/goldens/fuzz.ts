/**
 * fuzz.ts — Wave 4g: random key-sequence differential testing against real
 * Vim. Goldens pin specific cases; this is what finds the warts nobody
 * thought to write one for.
 *
 *   pnpm test:fuzz            10,000 sequences (default)
 *   pnpm test:fuzz -- 500     override the count
 *   VIMORROR_FUZZ_SEED=1 pnpm test:fuzz    reproducible run
 *
 * Reuses the exact same oracle (`runVim`, from `generate.ts`) and comparator
 * (`runGolden`, from `compare.ts`) the committed goldens use — a fuzzed case
 * is really just an uncommitted golden, diffed on buffer + cursor + registers
 * and then thrown away.
 *
 * The alphabet is SAFE BY CONSTRUCTION: `:q :w :x ZZ ZQ :!` and shell escapes
 * are never emitted by any generator below (`Z` never appears at all; every
 * ex-command atom is built from a fixed set of command words — `d s m t
 * normal g v` — that never includes write/quit/shell). `isSafe()` is a
 * second, independent check applied to every fully-rendered sequence right
 * before it is ever handed to the batched Vim process — a plain substring
 * scan, so it catches a dangerous command wherever it appears in the
 * rendered text, including inside a `:g`/`:v` body, without needing to know
 * anything about nesting.
 *
 * Two more exclusions are not about safety but about known, documented,
 * PERMANENT divergences from real Vim that this project's oracle cannot
 * measure (see docs/HANDOFF.md's `:g`/`:v` notes and `tools/goldens/README.md`
 * detail 11's `:s ... c` finding): a `:g`/`:v` body never nests another
 * `:g`/`:v`, and `:s` is never generated with the `c` (confirm) flag. Both
 * would produce guaranteed, uninteresting mismatches unrelated to any real
 * engine bug.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';

import { describeDiffs, runGolden } from './compare.ts';
import { runVim, type CaseSpec, type Golden } from './generate.ts';

const VIM = process.env['VIMORROR_VIM'] ?? '/usr/bin/vim';

// --- the sanitizer -----------------------------------------------------------

/**
 * Scans rendered key notation for anything that would take the batched Vim
 * process down with it: `:q* :w* :x* :!`, wherever they appear (including
 * inside a `:g`/`:v` body — that's just more text in the same string), plus
 * `ZZ`/`ZQ`. Walks past a genuine ex range (digits `. $ % + -` and `'{mark}`)
 * before checking the command word, so `:normal w<CR>` (a plain word motion,
 * whose argument happens to contain the letter after "normal ") is not
 * mistaken for `:w`.
 */
export function isSafe(notation: string): boolean {
  if (/ZZ|ZQ/.test(notation)) return false;

  let from = 0;
  for (;;) {
    const colon = notation.indexOf(':', from);
    if (colon === -1) return true;
    let p = colon + 1;
    while (notation[p] === ' ') p += 1;
    for (;;) {
      const c = notation[p];
      if (c !== undefined && /[0-9.$%,+-]/.test(c)) {
        p += 1;
      } else if (c === "'" && /[a-zA-Z]/.test(notation[p + 1] ?? '')) {
        p += 2;
      } else {
        break;
      }
    }
    if (notation[p] === '!') return false; // `:!cmd` shell escape
    const word = /^[a-zA-Z]/.exec(notation.slice(p));
    if (word !== null && 'qwx'.includes(word[0]!.toLowerCase())) return false;
    from = colon + 1;
  }
}

// --- the alphabet --------------------------------------------------------

const COUNT = fc.constantFrom('', '2', '3', '9');
const REG = fc.constantFrom('', '"a', '"b', '"z', '"0', '"_');
const FINDCHAR = fc.constantFrom('a', 'b', 'c', ' ', '.');
// No `q`: a count on `cc`/`C` can overshoot the buffer's line count and FAIL
// without entering insert mode at all — the same clamp-vs-fail count rule
// `dd`/`D` already have (docs/HANDOFF.md's undo-minting notes). When that
// happens, the "insert text" that was meant to follow is instead read as
// fresh normal-mode keys. Every other letter just does some local, contained
// thing in that case alone; `q` followed by a letter silently starts an
// UNBOUNDED macro recording — found by fuzzing when `"b2Cqjf<Esc>` failed to
// enter insert mode, `q` + `j` started recording into register j, and it
// then ran for the rest of the batch, silently swallowing every later
// case's keystrokes into "j" (a Vim global `s:Setup()` has no ex command to
// reset — the same class of cross-case leak README detail 12 documents for
// `reg_recording()`/`@@`memory).
const WORD = fc.stringMatching(/^[a-ce-z]{1,4}$/);

// No bare `0`: real Vim's grammar makes `0` a continuing count digit whenever
// ANY digit already precedes it, never a fresh "column zero" motion — so
// `COUNT + '0'` (e.g. this atom's own `3` + `0` = "30") is NEVER "count 3,
// motion 0", it's ALWAYS the single, genuinely incomplete count "30" with no
// motion consumed yet. A group left dangling on a bare pending count like
// that is dropped at the feedkeys group boundary in real Vim (the same
// "incomplete command dropped when the typeahead empties" hazard
// tools/goldens/README.md's detail 7 documents) but silently carries into
// the NEXT atom in our engine's flat token replay, which has no such
// boundary — found by fuzzing when `...3;309ix<Esc>` (meant as five
// independent atoms) produced 9 x's in real Vim and 309 in the engine, `^`
// already covers "start of line" without the ambiguity.
const SIMPLE_MOTION = fc.constantFrom(
  'h', 'l', '^', '$', 'j', 'k', 'w', 'W', 'b', 'B', 'e', 'E', 'ge', 'gE',
  '%', '{', '}', '(', ')', 'gg', 'G', '+', '-', '_',
);
const FIND_MOTION = fc.tuple(fc.constantFrom('f', 'F', 't', 'T'), FINDCHAR).map(([k, c]) => k + c);
const MOTION = fc.tuple(COUNT, fc.oneof(SIMPLE_MOTION, FIND_MOTION, fc.constantFrom(';', ','))).map(([c, m]) => c + m);

const OBJECT = fc.tuple(fc.constantFrom('i', 'a'), fc.constantFrom('w', 'W', '"', "'", '(', '{', '[', 'p')).map(([k, o]) => k + o);
// `>`/`<` (shift) are deliberately excluded: `keys.ts`'s tokenizer treats a
// bare `<` as the start of `<...>` notation and pairs it with the FIRST `>`
// anywhere later in the same rendered string — which, once other atoms are
// concatenated after it, is very often a stray `>` from an unrelated atom,
// not this one's own. Already well covered by wave2-indent/wave3-visualops.
const OPERATOR = fc.constantFrom('d', 'y', 'gu', 'gU', 'g~');
const DOUBLED = fc.constantFrom('dd', 'yy', 'guu', 'gUU', 'g~~');

/** count + register + operator + (motion | text object), or a doubled form. */
const operatorAtom: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(REG, COUNT, OPERATOR, MOTION).map(([r, c, op, m]) => r + c + op + m),
  fc.tuple(REG, COUNT, OPERATOR, OBJECT).map(([r, c, op, o]) => r + c + op + o),
  fc.tuple(REG, COUNT, DOUBLED).map(([r, c, d]) => r + c + d),
);

// `c`/`cc`/`C` all enter insert mode. Kept apart from `operatorAtom` and
// `simpleEditAtom` so text + `<Esc>` is ALWAYS bundled into the same atom —
// an insert session left open at the end of one atom is a dangling command
// at a feedkeys group boundary, which real Vim silently abandons (the same
// "incomplete command dropped when the typeahead empties" hazard
// tools/goldens/README.md's detail 7 documents for undo blocks) while this
// engine's flat token replay just keeps typing into it. Found by fuzzing.
const changeAtom: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(REG, COUNT, fc.constant('c'), fc.oneof(MOTION, OBJECT), WORD).map(([r, c, op, m, t]) => `${r}${c}${op}${m}${t}<Esc>`),
  fc.tuple(REG, COUNT, WORD).map(([r, c, t]) => `${r}${c}cc${t}<Esc>`),
  fc.tuple(REG, COUNT, WORD).map(([r, c, t]) => `${r}${c}C${t}<Esc>`),
);

const simpleEditAtom: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(REG, COUNT, fc.constantFrom('x', 'X', 'D', 'Y', '~', 'u', '<C-r>')).map(([r, c, k]) => r + c + k),
  fc.tuple(REG, COUNT, fc.constant('r'), FINDCHAR).map(([r, c, k, ch]) => r + c + k + ch),
  fc.constant('.'),
  fc.tuple(COUNT, fc.constantFrom('g-', 'g+')).map(([c, k]) => c + k),
  fc.constantFrom('<C-o>', '<C-i>'),
);

const insertAtom: fc.Arbitrary<string> = fc.tuple(
  COUNT,
  fc.constantFrom('i', 'a', 'I', 'A', 'o', 'O'),
  WORD,
).map(([c, k, text]) => `${c}${k}${text}<Esc>`);

const pasteAtom: fc.Arbitrary<string> = fc.tuple(REG, COUNT, fc.constantFrom('p', 'P')).map(([r, c, k]) => r + c + k);

const markAtom: fc.Arbitrary<string> = fc.tuple(fc.constantFrom('m', '`', "'"), fc.constantFrom('a', 'b')).map(([k, l]) => k + l);

const searchAtom: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.constantFrom('/', '?'), WORD).map(([k, w]) => `${k}${w}<CR>`),
  fc.constantFrom('n', 'N', '*', '#'),
);

const visualInsertOp = fc.tuple(fc.constantFrom('c', 'C', 's'), WORD).map(([op, t]) => `${op}${t}<Esc>`);
const visualAtom: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom('v', 'V', '<C-v>'),
  fc.array(MOTION, { minLength: 1, maxLength: 3 }),
  fc.oneof(
    // No `>`/`<` here either — same bare-bracket hazard as OPERATOR above.
    fc.constantFrom('d', 'y', 'x', '~', 'u', 'U', 'gu', 'gU', 'g~', 'D', 'X', 'Y', 'p', 'P', 'o', '<Esc>'),
    visualInsertOp,
  ),
).map(([enter, moves, op]) => enter + moves.join('') + op);

// A dedicated sub-alphabet for `:normal`'s argument: no `:`, no `Z`, no `q`/`@`
// (macros are out of scope here — see the module header), and — this one is
// NOT optional — no `changeAtom`/`insertAtom` either, because their embedded
// `<Esc>` is fatal here in a way it isn't anywhere else. `:normal <arg><CR>`
// is typed at the real `:` prompt as raw keystrokes; `doExNormal`'s own
// comment already says why an `<Esc>` cannot appear in its argument — Esc
// typed at a command-line prompt cancels that command line before `<CR>`
// is ever reached, REGARDLESS of what's still queued behind it. The dropped
// `<CR>` and everything queued after the cancelled Esc then replay as
// ordinary normal-mode keys instead of ex-command text — found by fuzzing
// when this accidentally spelled out a `q{letter}` macro-record start,
// which then silently kept recording (macros are otherwise never emitted;
// nothing in the rest of this file ever presses `q` to stop it) and
// accumulated every subsequent case's keystrokes into one register for the
// rest of the batch, exactly the cross-case leak README detail 12 documents.
const normalArgAtom = fc.oneof(MOTION, simpleEditAtom, pasteAtom);
const normalArg = fc.array(normalArgAtom, { minLength: 1, maxLength: 3 }).map((a) => a.join(''));

const RANGE = fc.constantFrom('', '.', '%', '1,2', '.,+1', '.,$');
const DEST = fc.constantFrom('0', '$', '.', '+1');

/** One safe ex-command line (no trailing `<CR>` — callers add it). Excludes `global`/`vglobal`/write/quit by construction. */
const exBody: fc.Arbitrary<string> = fc.oneof(
  fc.constant('d'),
  fc.tuple(fc.constant('s/'), WORD, fc.constant('/'), WORD, fc.constant('/'), fc.constantFrom('', 'g')).map((p) => p.join('')),
  fc.tuple(fc.constant('normal '), normalArg).map(([k, a]) => k + a),
  fc.tuple(fc.constant('m'), DEST).map(([k, d]) => k + d),
  fc.tuple(fc.constant('t'), DEST).map(([k, d]) => k + d),
);

const exCmdAtom: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(RANGE, fc.constant('d')).map(([r, c]) => `:${r}${c}<CR>`),
  fc.tuple(RANGE, fc.constant('m'), DEST).map(([r, c, d]) => `:${r}${c}${d}<CR>`),
  fc.tuple(RANGE, fc.constant('t'), DEST).map(([r, c, d]) => `:${r}${c}${d}<CR>`),
  fc.tuple(RANGE, fc.constant('s/'), WORD, fc.constant('/'), WORD, fc.constant('/'), fc.constantFrom('', 'g')).map(
    ([r, ...rest]) => `:${r}${rest.join('')}<CR>`,
  ),
  fc.tuple(RANGE, fc.constant('normal '), normalArg).map(([r, k, a]) => `:${r}${k}${a}<CR>`),
  fc.tuple(RANGE, fc.constantFrom('g', 'v'), fc.constant('/'), WORD, fc.constant('/'), exBody).map(
    ([r, gv, slash, pat, slash2, body]) => `:${r}${gv}${slash}${pat}${slash2}${body}<CR>`,
  ),
  fc.tuple(RANGE).map(([r]) => `:${r}<CR>`),
);

const atom: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: MOTION },
  { weight: 4, arbitrary: operatorAtom },
  { weight: 2, arbitrary: changeAtom },
  { weight: 3, arbitrary: simpleEditAtom },
  { weight: 2, arbitrary: insertAtom },
  { weight: 2, arbitrary: pasteAtom },
  { weight: 1, arbitrary: markAtom },
  { weight: 1, arbitrary: searchAtom },
  { weight: 2, arbitrary: visualAtom },
  { weight: 1, arbitrary: exCmdAtom },
);

/** Buffers weighted toward the shapes that break engines — same spirit as `properties.test.ts`'s `arbLines`. */
const arbLine = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.stringMatching(/^[a-z]{1,8}$/),
  fc.stringMatching(/^[a-z]{1,4} [a-z]{1,4}$/),
  fc.stringMatching(/^[a-z]{1,3}[.,(){}[\]"']{1,2}[a-z]{1,3}$/),
);
const arbBuffer = fc.array(arbLine, { minLength: 1, maxLength: 6 });

export const caseArb: fc.Arbitrary<{ buffer: string[]; cursor: [number, number]; groups: string[] }> = arbBuffer.chain((buffer) =>
  fc.record({
    line: fc.integer({ min: 0, max: buffer.length - 1 }),
    col: fc.integer({ min: 0, max: 8 }),
    groups: fc.array(atom, { minLength: 1, maxLength: 8 }),
  }).map(({ line, col, groups }) => ({ buffer, cursor: [line + 1, col + 1] as [number, number], groups })),
);

// --- runner --------------------------------------------------------------

export function main(): void {
  const argv = process.argv.slice(2);
  const count = Number.parseInt(argv[0] ?? '', 10) || 10_000;
  const seedEnv = process.env['VIMORROR_FUZZ_SEED'];

  if (!existsSync(VIM)) {
    console.error(`No Vim at ${VIM}. Set VIMORROR_VIM to override.`);
    process.exit(1);
  }

  console.log(`generating ${count} random sequences...`);
  const raw = fc.sample(caseArb, seedEnv ? { numRuns: count, seed: Number(seedEnv) } : count);

  const specs: CaseSpec[] = [];
  let rejected = 0;
  raw.forEach((c, i) => {
    const keys = c.groups.join('');
    if (!isSafe(keys)) {
      rejected += 1;
      return;
    }
    specs.push({ id: `fuzz-${i}`, buffer: c.buffer, cursor: c.cursor, keys, groups: c.groups });
  });
  console.log(`${specs.length} cases to run (${rejected} rejected by the sanitizer)`);

  const BATCH = 250;
  let ran = 0;
  let mismatches = 0;

  for (let start = 0; start < specs.length; start += BATCH) {
    const batch = specs.slice(start, start + BATCH);
    const results = runVim(batch, `fuzz-${start}`);

    for (let i = 0; i < batch.length; i += 1) {
      const spec = batch[i]!;
      const r = results[i]!;
      const { id: _id, ...expect } = r;
      const golden: Golden = { ...spec, encodedKeys: spec.keys, expect };

      const diffs = runGolden(golden);
      ran += 1;
      if (diffs.length > 0) {
        mismatches += 1;
        console.error(describeDiffs(golden, diffs));
        console.error('');
      }
    }
    console.log(`  ...${Math.min(start + BATCH, specs.length)}/${specs.length}`);
  }

  console.log(`\n${ran} sequences run, ${mismatches} mismatch(es).`);
  if (mismatches > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
