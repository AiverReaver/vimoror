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

/**
 * Merge for an uppercase-register append. If either side is linewise the
 * result is linewise, and every seam gets its newline: charwise text appended
 * to a linewise register becomes a full line of its own.
 */
function appended(existing: RegisterValue | undefined, value: RegisterValue): RegisterValue {
  if (existing === undefined) return value;
  // Two blocks STACK: the new rows go below the old ones, ragged. They are NOT
  // padded out to a common width — measured, having guessed the opposite. The
  // register's own width is what makes it a rectangle again when it is put back.
  // Linewise wins over blockwise, so this must be tested before the linewise case.
  if (existing.type === 'blockwise' && value.type === 'blockwise') {
    return { text: `${existing.text}\n${value.text}`, type: 'blockwise' };
  }
  if (existing.type === 'linewise' || value.type === 'linewise') {
    let text = existing.text;
    if (!text.endsWith('\n')) text += '\n';
    text += value.text;
    if (!text.endsWith('\n')) text += '\n';
    return { text, type: 'linewise' };
  }
  return { text: existing.text + value.text, type: existing.type };
}

export type RecordOptions = {
  /** The register the user explicitly asked for, if any. */
  readonly explicit?: string | undefined;
  readonly isYank: boolean;
  readonly type: RegisterType;
  readonly text: string;
  /** True when the deleted text spanned a line boundary or was linewise. */
  readonly multiline: boolean;
  /** True for deletes over `%`-like motions, which always shift into `"1`. */
  readonly forcesNumbered?: boolean;
};

export function recordWrite(regs: Registers, opts: RecordOptions): Registers {
  const { explicit, isYank, type, text, multiline } = opts;
  const value: RegisterValue = { text, type };

  if (explicit === BLACKHOLE) return regs;

  let next = regs;

  if (explicit !== undefined) {
    let mirrored = value;
    if (/[A-Z]/.test(explicit)) {
      const name = explicit.toLowerCase();
      mirrored = appended(next[name], value);
      next = write(next, name, mirrored);
    } else {
      next = write(next, explicit, value);
    }
    // Verified against real Vim, and NOT what `:help quote_number` implies:
    // naming a register on a DELETE still shifts the numbered registers, even
    // for a small delete, and `"-` is left alone. `"a3x` sets "a, "1 and
    // unnamed. A yank into a named register touches neither "1 nor "0.
    if (!isYank) {
      next = shiftNumbered(next);
      next = write(next, '1', value);
    }
    // The unnamed register always mirrors the register written — after an
    // append, that is the register's whole merged value.
    return write(next, UNNAMED, mirrored);
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
    // Small deletes over `%` and friends land in "1 as well as "-.
    if (opts.forcesNumbered === true) {
      next = shiftNumbered(next);
      next = write(next, '1', value);
    }
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
