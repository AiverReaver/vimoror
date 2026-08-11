/**
 * The comparator: replay every committed golden through our engine and diff
 * buffer, cursor and registers against what real Vim did.
 *
 * This is where the one documented coordinate conversion happens — Vim reports
 * 1-based BYTE columns, the engine uses 0-based CHARACTER indices. Converting
 * anywhere else would leak Vim's representation into the engine.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VimEngine } from '../../packages/vim-core/src/index.ts';
import { tokenize } from '../../packages/vim-core/src/keys.ts';
import { DEFAULT_OPTIONS, type EditorOptions } from '../../packages/vim-core/src/operators.ts';
import type { RegisterType } from '../../packages/vim-core/src/types.ts';
import type { Golden } from './generate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadGoldens(family: string): Golden[] {
  return JSON.parse(readFileSync(join(HERE, 'goldens', `${family}.json`), 'utf8')) as Golden[];
}

/** Vim's 1-based byte column → our 0-based character index. */
export function byteColToCharIndex(line: string, byteCol: number): number {
  const targetBytes = byteCol - 1;
  let bytes = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (bytes >= targetBytes) return i;
    bytes += Buffer.byteLength(line[i]!, 'utf8');
  }
  return line.length;
}

/** Our 0-based character index → Vim's 1-based byte column, for diff messages. */
export function charIndexToByteCol(line: string, charIndex: number): number {
  return Buffer.byteLength(line.slice(0, charIndex), 'utf8') + 1;
}

const REG_TYPE: Record<string, RegisterType> = { v: 'charwise', V: 'linewise' };

function vimRegType(t: string): RegisterType {
  if (t.startsWith('\x16')) return 'blockwise';
  return REG_TYPE[t] ?? 'charwise';
}

export type Diff = {
  readonly field: string;
  readonly expected: unknown;
  readonly actual: unknown;
};

/**
 * Translate a case's `:set` overrides into engine options, so a case that runs
 * real Vim with `shiftwidth=2` runs our engine that way too. Anything the
 * engine does not model yet is ignored rather than silently mistranslated.
 */
export function optionsFrom(args: readonly string[] | undefined): EditorOptions {
  let opts: EditorOptions = { ...DEFAULT_OPTIONS };
  for (const raw of args ?? []) {
    const arg = raw.trim();
    const num = /^(shiftwidth|sw|tabstop|ts)=(\d+)$/.exec(arg);
    if (num) {
      const value = Number.parseInt(num[2]!, 10);
      opts = num[1] === 'shiftwidth' || num[1] === 'sw' ? { ...opts, shiftwidth: value } : { ...opts, tabstop: value };
      continue;
    }
    if (arg === 'expandtab' || arg === 'et') opts = { ...opts, expandtab: true };
    if (arg === 'noexpandtab' || arg === 'noet') opts = { ...opts, expandtab: false };
    if (arg === 'autoindent' || arg === 'ai') opts = { ...opts, autoindent: true };
    if (arg === 'noautoindent' || arg === 'noai') opts = { ...opts, autoindent: false };
  }
  return opts;
}

export function runGolden(g: Golden): Diff[] {
  const engine = new VimEngine(
    g.buffer,
    {
      line: g.cursor[0] - 1,
      col: byteColToCharIndex(g.buffer[g.cursor[0] - 1] ?? '', g.cursor[1]),
    },
    optionsFrom(g.options),
  );

  for (const key of tokenize(g.keys)) engine.feed(key);

  const diffs: Diff[] = [];
  const actualLines = [...engine.lines];

  if (JSON.stringify(actualLines) !== JSON.stringify(g.expect.buffer)) {
    diffs.push({ field: 'buffer', expected: g.expect.buffer, actual: actualLines });
  }

  const expectedLine = g.expect.cursor[0] - 1;
  const expectedCol = byteColToCharIndex(g.expect.buffer[expectedLine] ?? '', g.expect.cursor[1]);
  if (engine.cursor.line !== expectedLine || engine.cursor.col !== expectedCol) {
    diffs.push({
      field: 'cursor',
      expected: `line ${expectedLine} col ${expectedCol}`,
      actual: `line ${engine.cursor.line} col ${engine.cursor.col}`,
    });
  }

  // Registers are compared BOTH ways. Vim omits empty registers from the
  // golden, so "absent from the golden" asserts empty-or-unset — an engine
  // register holding real text that Vim left empty is a divergence (this is
  // what catches an engine that clamps where Vim fails: buffer and cursor sit
  // untouched either way, and only the stray register betrays it). The engine
  // is allowed to have not-yet-implemented registers absent rather than wrong.
  //
  // `expect.curswant` is captured in every golden but deliberately NOT
  // compared yet: it needs virtual-column conversion plus MAXCOL handling
  // against the engine's desiredCol. Tracked in docs/CHECKLIST.md.
  const actualRegs = engine.snapshot().registers;
  for (const [name, expected] of Object.entries(g.expect.registers)) {
    if (name === '/') continue; // search register lands in Wave 4
    const actual = actualRegs[name];
    const wantType = vimRegType(expected.type);
    if (actual === undefined) {
      diffs.push({ field: `register "${name}`, expected: expected.text, actual: '(unset)' });
    } else if (actual.text !== expected.text || actual.type !== wantType) {
      diffs.push({
        field: `register "${name}`,
        expected: `${JSON.stringify(expected.text)} (${wantType})`,
        actual: `${JSON.stringify(actual.text)} (${actual.type})`,
      });
    }
  }
  for (const [name, actual] of Object.entries(actualRegs)) {
    if (name === '/' || actual.text === '') continue;
    if (!(name in g.expect.registers)) {
      diffs.push({
        field: `register "${name}`,
        expected: '(empty or unset in vim)',
        actual: `${JSON.stringify(actual.text)} (${actual.type})`,
      });
    }
  }

  return diffs;
}

export function describeDiffs(g: Golden, diffs: readonly Diff[]): string {
  const lines = [
    `${g.id}  buffer=${JSON.stringify(g.buffer)} cursor=${JSON.stringify(g.cursor)} keys=${JSON.stringify(g.keys)}`,
  ];
  if (g.note) lines.push(`  note: ${g.note}`);
  for (const d of diffs) {
    lines.push(`  ${d.field}:`);
    lines.push(`    vim   : ${JSON.stringify(d.expected)}`);
    lines.push(`    engine: ${JSON.stringify(d.actual)}`);
  }
  return lines.join('\n');
}
