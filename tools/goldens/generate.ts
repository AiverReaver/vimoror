/**
 * generate.ts — spawn real Vim over every case in cases/*.yaml and commit the
 * results to goldens/*.json.
 *
 *   pnpm goldens:generate                    regenerate all families
 *   pnpm goldens:generate -- word.yaml       regenerate one family
 *   pnpm goldens:verify                      prove batching is state-free
 *
 * Goldens are generated locally and COMMITTED, so CI never needs Vim.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { encodeKeys } from './keynotation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, 'cases');
const GOLDENS_DIR = join(HERE, 'goldens');
const WORK_DIR = join(HERE, '.work');
const GEN_VIM = join(HERE, 'gen.vim');
const VIM = process.env['VIMORROR_VIM'] ?? '/usr/bin/vim';

export type CaseSpec = {
  id: string;
  buffer: string[];
  cursor: [number, number];
  /** Human-authored notation, e.g. "ci(X<Esc>". Always the full sequence. */
  keys: string;
  /**
   * `keys` split at command boundaries. Authored as a YAML list when a case
   * makes more than one discrete change; the oracle breaks the undo block
   * between groups so `u` behaves as it does interactively. A plain string
   * `keys` is one group, which is correct for any single-command case.
   */
  groups: string[];
  options?: string[];
  note?: string;
  /**
   * The author declares that Vim reports an error here — a deliberately failing
   * command (`"zp` with nothing in `"z`). Some failures beep silently, others
   * raise a real exception out of `feedkeys`, so "did Vim error" is not a
   * reliable signal on its own; declaring it makes an UNEXPECTED error loud and
   * a declared failure that silently succeeded loud as well.
   */
  expectError?: boolean;
};

export type VimResult = {
  id: string;
  buffer: string[];
  /** 1-based line, 1-based BYTE column, as Vim reports it. */
  cursor: [number, number];
  curswant: number;
  registers: Record<string, { text: string; type: string }>;
  error: string;
};

export type Golden = CaseSpec & {
  /** `keys` with notation resolved, for engines that want the literal bytes. */
  encodedKeys: string;
  expect: Omit<VimResult, 'id'>;
};

// --- case loading -----------------------------------------------------------

function loadFamily(file: string): CaseSpec[] {
  const raw: unknown = parseYaml(readFileSync(join(CASES_DIR, file), 'utf8'));

  if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as { cases?: unknown }).cases)) {
    throw new Error(`${file}: expected a top-level "cases:" list`);
  }

  const seen = new Set<string>();
  return (raw as { cases: unknown[] }).cases.map((entry, i) => {
    const where = `${file}[${i}]`;
    if (entry === null || typeof entry !== 'object') throw new Error(`${where}: not a mapping`);
    const c = entry as Record<string, unknown>;

    if (typeof c['id'] !== 'string' || c['id'] === '') throw new Error(`${where}: missing id`);
    if (seen.has(c['id'])) throw new Error(`${where}: duplicate id ${c['id']}`);
    seen.add(c['id']);

    // A bare string buffer is a convenience for single-line cases; multi-line
    // content should use an explicit list so trailing whitespace stays visible.
    const buffer =
      typeof c['buffer'] === 'string'
        ? c['buffer'].split('\n')
        : Array.isArray(c['buffer']) && c['buffer'].every((l) => typeof l === 'string')
          ? (c['buffer'] as string[])
          : null;
    if (buffer === null) throw new Error(`${where}: buffer must be a string or list of strings`);
    if (buffer.length === 0) throw new Error(`${where}: buffer must have at least one line`);

    const cursor = c['cursor'] ?? [1, 1];
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 2 ||
      !cursor.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1)
    ) {
      throw new Error(`${where}: cursor must be [line, col], both 1-based`);
    }

    const groups =
      typeof c['keys'] === 'string'
        ? [c['keys']]
        : Array.isArray(c['keys']) && c['keys'].every((k) => typeof k === 'string')
          ? (c['keys'] as string[])
          : null;
    if (groups === null) throw new Error(`${where}: keys must be a string or a list of command groups`);

    const options = c['options'];
    if (options !== undefined && !(Array.isArray(options) && options.every((o) => typeof o === 'string'))) {
      throw new Error(`${where}: options must be a list of :set argument strings`);
    }

    const spec: CaseSpec = {
      id: c['id'],
      buffer,
      cursor: cursor as [number, number],
      keys: groups.join(''),
      groups,
    };
    if (options !== undefined) spec.options = options as string[];
    if (typeof c['note'] === 'string') spec.note = c['note'];
    if (c['expectError'] !== undefined) {
      if (typeof c['expectError'] !== 'boolean') throw new Error(`${where}: expectError must be a boolean`);
      spec.expectError = c['expectError'];
    }
    return spec;
  });
}

// --- the oracle -------------------------------------------------------------

export function runVim(cases: CaseSpec[], tag: string): VimResult[] {
  mkdirSync(WORK_DIR, { recursive: true });
  const specPath = join(WORK_DIR, `spec-${tag}.json`);
  const outPath = join(WORK_DIR, `out-${tag}.json`);

  // Notation is resolved to real characters HERE; JSON's own \u escaping is
  // reversed by Vim's json_decode, so feedkeys() sees real bytes.
  const payload = cases.map((c) => ({
    id: c.id,
    buffer: c.buffer,
    cursor: c.cursor,
    groups: c.groups.map(encodeKeys),
    ...(c.options ? { options: c.options } : {}),
  }));
  writeFileSync(specPath, JSON.stringify(payload));

  const proc = spawnSync(VIM, ['-u', 'NONE', '-i', 'NONE', '-N', '-es', '-S', GEN_VIM], {
    env: { ...process.env, VIMORROR_SPEC: specPath, VIMORROR_OUT: outPath },
    encoding: 'utf8',
    timeout: 120_000,
  });

  if (!existsSync(outPath)) {
    throw new Error(
      `vim produced no output (status ${String(proc.status)})\n` +
        `stderr: ${proc.stderr ?? ''}\nstdout: ${proc.stdout ?? ''}`,
    );
  }

  const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as { results: VimResult[]; fatal: string };
  if (parsed.fatal) throw new Error(`gen.vim aborted: ${parsed.fatal}`);
  if (parsed.results.length !== cases.length) {
    throw new Error(`expected ${cases.length} results, got ${parsed.results.length}`);
  }
  return parsed.results;
}

// --- entry point ------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const verifyIsolation = argv.includes('--verify-isolation');
  const filters = argv.filter((a) => !a.startsWith('--'));

  if (!existsSync(VIM)) {
    console.error(`No Vim at ${VIM}. Set VIMORROR_VIM to override.`);
    process.exit(1);
  }

  const files = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .filter((f) => filters.length === 0 || filters.some((x) => f === x || f === `${x}.yaml`));

  if (files.length === 0) {
    console.error(`No case files matched${filters.length ? ` ${filters.join(', ')}` : ''}.`);
    process.exit(1);
  }

  mkdirSync(GOLDENS_DIR, { recursive: true });
  let total = 0;
  let failed = 0;

  for (const file of files) {
    const family = file.replace(/\.yaml$/, '');
    const cases = loadFamily(file);
    const results = runVim(cases, family);

    const goldens: Golden[] = cases.map((spec, i) => {
      const r = results[i]!;
      if (r.id !== spec.id) throw new Error(`result order mismatch: ${r.id} vs ${spec.id}`);
      // A declared failure is not a problem; an UNdeclared one is, and so is a
      // declared one that did not actually happen.
      if (r.error && spec.expectError !== true) {
        failed += 1;
        console.error(`  ! ${spec.id}: vim reported ${r.error}`);
      }
      if (!r.error && spec.expectError === true) {
        failed += 1;
        console.error(`  ! ${spec.id}: expectError was declared but vim reported no error`);
      }
      const { id: _id, ...expect } = r;
      return { ...spec, encodedKeys: encodeKeys(spec.keys), expect };
    });

    // Batching all cases into one Vim process is ~100x faster than one
    // process per case, but is only sound if the per-case reset really is
    // total. This proves it rather than assuming it.
    if (verifyIsolation) {
      for (const spec of cases) {
        const [solo] = runVim([spec], 'iso');
        const batched = goldens.find((g) => g.id === spec.id)!.expect;
        const { id: _id, ...soloExpect } = solo!;
        if (JSON.stringify(soloExpect) !== JSON.stringify(batched)) {
          failed += 1;
          console.error(`  ! ${spec.id}: batched run differs from isolated run — state is leaking`);
          console.error(`    isolated: ${JSON.stringify(soloExpect)}`);
          console.error(`    batched:  ${JSON.stringify(batched)}`);
        }
      }
    }

    writeFileSync(join(GOLDENS_DIR, `${family}.json`), `${JSON.stringify(goldens, null, 2)}\n`);
    total += goldens.length;
    console.log(`  ${family}: ${goldens.length} cases`);
  }

  console.log(`\n${total} goldens written to tools/goldens/goldens/${verifyIsolation ? ' (isolation verified)' : ''}`);
  if (failed > 0) {
    console.error(`${failed} problem(s) — goldens were still written; inspect before committing.`);
    process.exit(1);
  }
}

// Guarded so `fuzz.ts` can import `runVim` without re-running this file's own
// generate-everything main() as a side effect of the import.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
