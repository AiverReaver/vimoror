/**
 * validate-stages.ts — every file in `content/stages/` is a valid stage.
 *
 * `pnpm validate:stages`
 *
 * At M2 this is a thin schema check plus the two rules a single stage cannot
 * see on its own: ids are unique across the corpus, and a file is named after
 * the stage it holds. `MergedPlan.md` names this script as the CI gate that
 * "replays every golden solution headlessly through core and asserts a win
 * using only `allowedKeys`" — that half is M3's, because asserting a win means
 * evaluating win conditions, and the evaluator is `rules.ts` in Wave C.
 *
 * The seam for it is `checkStage` below: parse, then (at M3) restore an engine
 * from the stage, feed `stage.solution` under a `KeyPolicy` built from
 * `stage.allowedKeys`, and assert `rules.evaluate(...)` reports a win. The
 * schema already proves the solution's keys are permitted and that par is
 * reachable, so replay only has to prove it actually lands.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatIssues, safeParseStage } from '../packages/game/src/index.ts';

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

  return result.data.id;
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
