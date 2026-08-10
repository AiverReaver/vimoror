/**
 * Registers.
 *
 * The numbered-register shift is one of the three places engines reliably get
 * Vim wrong, so the rules are spelled out rather than inferred:
 *
 *  - A yank sets `"0` and the unnamed register — but only when no explicit
 *    register was given.
 *  - A delete of less than one line sets `"-` (small delete) and unnamed, and
 *    does NOT touch the numbered registers.
 *  - A linewise or multi-line delete shifts `"1`→`"2`…→`"9` and writes the new
 *    text into `"1`.
 *  - An explicit uppercase register appends instead of replacing.
 *  - `"_` is the black hole: it swallows writes and never reads back.
 */

import type { RegisterType, RegisterValue, Registers } from './types.ts';

export const BLACKHOLE = '_';
export const UNNAMED = '"';
export const SMALL_DELETE = '-';
export const YANK = '0';

export function emptyRegisters(): Registers {
  return {};
}

export function readRegister(regs: Registers, name: string): RegisterValue | undefined {
  if (name === BLACKHOLE) return undefined;
  const key = name.toLowerCase();
  return regs[key];
}

function write(regs: Registers, name: string, value: RegisterValue): Registers {
  return { ...regs, [name]: value };
}

function append(regs: Registers, name: string, value: RegisterValue): Registers {
  const existing = regs[name];
  if (existing === undefined) return write(regs, name, value);
  // Appending to a linewise register keeps it linewise and newline-separated.
  const joiner = existing.type === 'linewise' && !existing.text.endsWith('\n') ? '\n' : '';
  return write(regs, name, {
    text: existing.text + joiner + value.text,
    type: value.type === 'linewise' || existing.type === 'linewise' ? 'linewise' : existing.type,
  });
}

export type RecordOptions = {
  /** The register the user explicitly asked for, if any. */
  readonly explicit?: string | undefined;
  readonly isYank: boolean;
  readonly type: RegisterType;
  readonly text: string;
  /** True when the deleted text spanned a line boundary or was linewise. */
  readonly multiline: boolean;
};

export function recordWrite(regs: Registers, opts: RecordOptions): Registers {
  const { explicit, isYank, type, text, multiline } = opts;
  const value: RegisterValue = { text, type };

  if (explicit === BLACKHOLE) return regs;

  let next = regs;

  if (explicit !== undefined) {
    next = /[A-Z]/.test(explicit) ? append(next, explicit.toLowerCase(), value) : write(next, explicit, value);
    // Verified against real Vim, and NOT what `:help quote_number` implies:
    // naming a register on a DELETE still shifts the numbered registers, even
    // for a small delete, and `"-` is left alone. `"a3x` sets "a, "1 and
    // unnamed. A yank into a named register touches neither "1 nor "0.
    if (!isYank) {
      next = shiftNumbered(next);
      next = write(next, '1', value);
    }
    // The unnamed register always mirrors the most recent write, even when an
    // explicit register was named.
    return write(next, UNNAMED, value);
  }

  if (isYank) {
    next = write(next, YANK, value);
    return write(next, UNNAMED, value);
  }

  if (multiline || type === 'linewise') {
    next = shiftNumbered(next);
    next = write(next, '1', value);
  } else {
    next = write(next, SMALL_DELETE, value);
  }

  return write(next, UNNAMED, value);
}

function shiftNumbered(regs: Registers): Registers {
  const next = { ...regs };
  for (let i = 9; i > 1; i -= 1) {
    const from = next[String(i - 1)];
    if (from === undefined) delete next[String(i)];
    else next[String(i)] = from;
  }
  return next;
}
