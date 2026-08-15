/**
 * Macros — `q` record, `@`/`@@` replay.
 *
 * The recording is RAW keystrokes, not resolved commands — same reasoning as
 * `dot.ts`'s insert-session half: a macro can cross mode boundaries (into
 * insert, into visual, into another macro replay) and what plays back must be
 * exactly what was typed, warts included.
 *
 * Replay works off the token array, never off `macroText`'s rendered string.
 * Re-tokenizing recorded text would be lossy and dangerous: a macro that
 * entered insert mode and literally typed `<Foo>` would round-trip through
 * `tokenize()` as *notation* and throw — the exact trap `keys.ts` documents
 * for control-byte vs. bracket-notation confusion. `macroText` exists only to
 * mirror the recording into the register's visible text, because real Vim
 * genuinely stores a macro's keystrokes as that register's content (verified:
 * `qa$xq` leaves `"a` holding the two literal characters `$x`).
 */

import { literalOf } from './keys.ts';
import type { KeyToken } from './types.ts';

export type MacroRecording = {
  readonly register: string;
  readonly keys: readonly KeyToken[];
};

/** Keyed by lowercase register name — the same case-folding `registers.ts` uses. */
export type MacroStore = Readonly<Record<string, readonly KeyToken[]>>;

/**
 * `q{reg}` accepts 0-9, a-z, A-Z (append) — not `_`/`-`. `:help q` also lists
 * `"`, but that one is deliberately NOT supported: measured with a scratch
 * probe, recording into `"` writes the finished text into `"0` as well as
 * `""`, an internal register-0/unnamed aliasing quirk specific to that one
 * target. Out of scope here — the curriculum only ever records into a named
 * register.
 */
export function isValidRecordRegister(key: string): boolean {
  return /^[a-zA-Z0-9]$/.test(key);
}

/** `@{reg}` reads back case-insensitively, plus the literal `@` for `@@`. */
export function isValidReplayRegister(key: string): boolean {
  return /^[a-z0-9"@]$/.test(key);
}

/** Merge a finished recording in. Uppercase appends to the existing content. */
export function storeRecording(store: MacroStore, register: string, keys: readonly KeyToken[]): MacroStore {
  const isAppend = /[A-Z]/.test(register);
  const name = register.toLowerCase();
  const existing = isAppend ? (store[name] ?? []) : [];
  return { ...store, [name]: [...existing, ...keys] };
}

/** The literal text a recorded register shows when read — see file header. */
export function macroText(keys: readonly KeyToken[]): string {
  return keys.map((k) => literalOf(k) ?? k).join('');
}
