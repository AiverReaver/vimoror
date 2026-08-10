/**
 * The harness's own smoke test.
 *
 * These expectations are transcribed BY HAND from the table in MergedPlan.md,
 * which recorded what the original prototype observed from real Vim 9.1. They
 * are not copied from the generated goldens — that would be circular. If the
 * rebuilt harness reproduces all seven, it is wired up the way the prototype
 * was, and every other golden it generates can be trusted.
 *
 * This runs against the COMMITTED goldens, so it needs no Vim.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Golden } from './generate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const goldens = JSON.parse(readFileSync(join(HERE, 'goldens', 'proven.json'), 'utf8')) as Golden[];

const byId = new Map(goldens.map((g) => [g.id, g]));

function golden(id: string): Golden {
  const g = byId.get(id);
  if (!g) throw new Error(`missing golden ${id} — run pnpm goldens:generate`);
  return g;
}

describe('the seven prototype-proven cases', () => {
  it('d2w — operator + count + motion', () => {
    const g = golden('proven/d2w');
    expect(g.expect.buffer).toEqual(['gamma delta']);
    expect(g.expect.registers['"']?.text).toBe('alpha beta ');
  });

  it('ci( — text object with inner change', () => {
    const g = golden('proven/ci-paren');
    expect(g.expect.buffer).toEqual(['fn(X) end']);
    expect(g.expect.registers['"']?.text).toBe('a, b, c');
  });

  it('dw at end of line does NOT eat the newline', () => {
    const g = golden('proven/dw-eol-wart');
    // The wart: dw on the last word of a line stops at the line end instead
    // of joining the next line, unlike dw anywhere else.
    expect(g.expect.buffer).toEqual(['foo ']);
    expect(g.expect.buffer).toHaveLength(1);
  });

  it('named register survives a later unnamed delete', () => {
    const g = golden('proven/named-register');
    expect(g.expect.buffer).toEqual(['keep me']);
    expect(g.expect.registers['a']?.text).toBe('keep me\n');
    expect(g.expect.registers['"']?.text).toBe('kill me\n');
    // Linewise deletes also shift into "1 — the numbered-register rule the
    // plan flags as one of the three places engines get Vim wrong.
    expect(g.expect.registers['1']?.text).toBe('kill me\n');
    expect(g.expect.registers['a']?.type).toBe('V');
  });

  it(':s///g substitutes every match on the line', () => {
    const g = golden('proven/subst-g');
    expect(g.expect.buffer).toEqual(['Q a Q a Q']);
    // Regression guard for function-search-undo: :s sets the last search
    // pattern, and the harness must observe it in the acting frame.
    expect(g.expect.registers['/']?.text).toBe('x');
  });

  it('. repeats the last change, not the last keystroke', () => {
    const g = golden('proven/dot-repeat');
    expect(g.expect.buffer).toEqual(['four']);
  });

  it('; repeats f as a motion, so only x is the change', () => {
    const g = golden('proven/find-repeat');
    expect(g.expect.buffer).toEqual(['a,bc,d']);
  });
});

describe('harness invariants', () => {
  it('no case errored inside Vim', () => {
    for (const g of goldens) expect(g.expect.error, `${g.id} errored`).toBe('');
  });

  it('cursor columns are 1-based and within the reported line', () => {
    for (const g of goldens) {
      const [line, col] = g.expect.cursor;
      expect(line, `${g.id} line`).toBeGreaterThanOrEqual(1);
      expect(line, `${g.id} line`).toBeLessThanOrEqual(g.expect.buffer.length);
      const text = g.expect.buffer[line - 1] ?? '';
      // Vim reports byte columns; col may sit one past the end on an empty
      // line, where it reports 1 for a zero-length line.
      expect(col, `${g.id} col`).toBeGreaterThanOrEqual(1);
      expect(col, `${g.id} col`).toBeLessThanOrEqual(Math.max(1, Buffer.byteLength(text)));
    }
  });

  it('control characters survived encoding as real bytes, not as text', () => {
    const esc = golden('proven/ci-paren');
    expect(esc.encodedKeys).toBe('ci(X\x1b');
    expect(esc.encodedKeys).not.toContain('<Esc>');
    const cr = golden('proven/subst-g');
    expect(cr.encodedKeys).toBe(':s/x/Q/g\r');
  });
});
