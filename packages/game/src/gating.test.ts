/**
 * gating.ts — policy construction and the in-character map.
 *
 * Totality over `InvalidReason` is enforced at COMPILE time by the record's
 * type; what the runtime tests add is that no line is empty or duplicated,
 * since a blank or copy-pasted line is a silent no-op with extra steps.
 */

import { describe, expect, it } from 'vitest';
import { REJECTION_LINES, rejectionLine, stageKeyPolicy } from './index.ts';

describe('stageKeyPolicy', () => {
  it('returns undefined for an ungated stage — omitted means NO policy, not an empty one', () => {
    expect(stageKeyPolicy({ allowedKeys: undefined })).toBeUndefined();
  });

  it('expands specs into the per-keystroke token set core checks', () => {
    const policy = stageKeyPolicy({ allowedKeys: ['hjkl', '<Esc>', 'gg'] });
    expect(policy?.allowed).toEqual(new Set(['h', 'j', 'k', 'l', '<Esc>', 'g']));
  });

  it('expands {printable} to all 95 printable characters', () => {
    const policy = stageKeyPolicy({ allowedKeys: ['{printable}'] });
    expect(policy?.allowed?.has(' ')).toBe(true);
    expect(policy?.allowed?.has('~')).toBe(true);
  });

  it('<Esc> is never lockable, whatever allowedKeys says', () => {
    // A stage that permits `i` but not `<Esc>` would soft-lock the player in
    // insert mode: no return to rest, no tick, no win, no lose, forever.
    const policy = stageKeyPolicy({ allowedKeys: ['hjkl'] });
    expect(policy?.allowed?.has('<Esc>')).toBe(true);
  });
});

describe('rejection lines', () => {
  it('every reason has a distinct, non-empty in-character line', () => {
    const lines = Object.values(REJECTION_LINES);
    expect(lines.every((l) => l.length > 0)).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('rejectionLine looks up the map', () => {
    expect(rejectionLine('key-locked')).toBe(REJECTION_LINES['key-locked']);
  });
});
