/**
 * validate-stages.ts — every file in `content/stages/` is a valid stage.
 *
 * `pnpm validate:stages`
 *
 * Three checks, in cost order.
 *
 * 1. **The schema**, per file.
 * 2. **The two rules a single stage cannot see on its own**: ids are unique
 *    across the corpus, and a file is named after the stage it holds.
 * 3. **The replay** — `MergedPlan.md`'s own words for this gate: "replays every
 *    golden solution headlessly through core and asserts a win using only
 *    `allowedKeys`". Written as M3's half, landed early because M2 Wave C's
 *    `GameSession` already is the thing that does it: it builds the engine, hangs
 *    the stage's `KeyPolicy` on it, ticks, and evaluates `rules.ts`. Hand-rolling
 *    those four steps here would be a second copy of the loop to drift from.
 *
 * The replay runs at **all three difficulties**, which costs one loop and buys
 * M2's fourth done-line criterion as a standing CI check ("the same stage runs
 * on all three presets"). That loop was checked against a stage built to split
 * them rather than assumed to be worth it: a goal three cells away with a threat
 * six cells off wins on `verymagic` and **loses on `magic` and `nomagic`**,
 * because `verymagic` halves the chase and the threat takes one step in the three
 * ticks the route costs instead of three. A single-preset gate would have shipped
 * that stage. The budget cannot split them the same way — the schema already
 * rejects a solution longer than its own `keystrokes-over` — so threat cadence is
 * the mechanism that makes this loop earn its keep.
 *
 * Deliberately NOT checked, each for a reason:
 *
 * - **`keystrokes <= par`.** The schema already rejects a solution longer than
 *   par, and a session counts only RESOLVED commands, so this can never fire.
 * - **A `CommandRefused` in the solution.** M3's recorder records real play, and
 *   a human's recorded route may legitimately contain a motion that failed. The
 *   spec asks for a win using permitted keys, not a flawless one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GameSession,
  formatIssues,
  safeParseStage,
  type Difficulty,
  type Stage,
} from '../packages/game/src/index.ts';

/** Strictest last, so a budget failure reads as the escalation it is. */
const PRESETS: readonly Difficulty[] = ['verymagic', 'magic', 'nomagic'];

const STAGES_DIR = fileURLToPath(new URL('../content/stages', import.meta.url));

type Problem = { readonly file: string; readonly detail: string };

function checkStage(file: string, problems: Problem[]): string | undefined {
  const path = join(STAGES_DIR, file);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push({ file, detail: `  not valid JSON: ${(e as Error).message}` });
    return undefined;
  }

  const result = safeParseStage(raw);
  if (!result.success) {
    problems.push({ file, detail: formatIssues(result.error) });
    return undefined;
  }

  // A stage is loaded by id; keeping the filename equal to it means that is a
  // path join rather than a scan of the whole corpus — and it names the file
  // when a copy-pasted stage forgets to change its id, which the duplicate
  // check below can only report as a pair.
  const expected = basename(file, '.json');
  if (result.data.id !== expected) {
    problems.push({ file, detail: `  id is "${result.data.id}" but the filename says "${expected}"` });
  }

  replaySolution(result.data, file, problems);

  return result.data.id;
}

/** Feed the shipped solution through a real session and require a win, at every preset. */
function replaySolution(stage: Stage, file: string, problems: Problem[]): void {
  for (const difficulty of PRESETS) {
    const session = new GameSession(stage, { difficulty });
    const events = session.feedKeys(stage.solution);

    // "Using only `allowedKeys`". The schema proves every key of the solution is
    // permitted, so a rejection here means the POLICY disagrees with the schema
    // — the two surfaces having drifted, which is worth its own message.
    const rejected = events.filter((e) => e.type === 'KeyRejected');
    if (rejected.length > 0) {
      const keys = [...new Set(rejected.map((e) => e.key))].map((k) => JSON.stringify(k)).join(', ');
      problems.push({ file, detail: `  on ${difficulty}: the solution's own keys were rejected: ${keys}` });
    }

    if (session.outcome.status !== 'won') {
      const how =
        session.outcome.status === 'lost'
          ? `lost to ${JSON.stringify(session.outcome.by)}`
          : 'never won — the stage is still playing when the solution runs out';
      problems.push({
        file,
        detail: `  on ${difficulty}: replaying \`${stage.solution}\` ${how}`,
      });
    }
  }
}

const files = readdirSync(STAGES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

const problems: Problem[] = [];
const seen = new Map<string, string>();

for (const file of files) {
  const id = checkStage(file, problems);
  if (id === undefined) continue;
  const previous = seen.get(id);
  if (previous !== undefined) problems.push({ file, detail: `  duplicate stage id "${id}", already used by ${previous}` });
  else seen.set(id, file);
}

for (const { file, detail } of problems) console.error(`${file}\n${detail}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) across ${files.length} stage file(s).`);
  process.exit(1);
}

console.log(`${files.length} stage file(s) valid.`);
