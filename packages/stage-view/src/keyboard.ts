/**
 * A keyboard event → one `KeyToken`, or nothing at all.
 *
 * M1's demo had a translator and its own header called it "deliberately not real
 * input handling, that's M4's job". This is that job arriving one milestone
 * early, because playtest and the recorder are **trust-boundary consumers**: a
 * mistranslated key does not merely feel wrong, it becomes a wrong
 * `stage.solution` committed to `content/stages/`. So the rule here is
 * conservative on purpose — a key this file does not recognise returns
 * `undefined`, the caller does not `preventDefault`, and the browser's own
 * behaviour survives. Nothing is ever guessed into a token.
 *
 * Written over a structural event type rather than `KeyboardEvent` so vitest can
 * drive it with plain objects and no DOM. A real `KeyboardEvent` (and React's
 * synthetic one) satisfies it structurally.
 *
 * **Shift needs no handling**, which is worth stating because its absence looks
 * like an omission: `event.key` already carries the shifted character, so `A` and
 * `$` arrive as themselves. Core's `<S-…>` token exists for hand-written
 * notation and nothing on a keyboard produces it.
 *
 * Three deliberate gaps, each a `undefined` rather than a guess:
 *
 * - **Arrows, function keys and the navigation cluster.** Real Vim moves on the
 *   arrows; this game teaches `hjkl`, and inventing a mapping core has no token
 *   for would put a keystroke in a recorded solution that `tokenize` cannot read
 *   back. M4 answered by sharing this file rather than widening it: the runner
 *   translates keys through exactly this table, so the shipped game does not
 *   accept them either, and a solution recorded in the editor is playable in the
 *   game by construction.
 * - **`Alt`/`Meta` chords**, so `Cmd-R` still reloads and `Alt-Tab` still
 *   switches windows. The cost is `AltGr` on a non-US layout, which reports
 *   `ctrlKey && altKey` with the composed character in `event.key` — an author who
 *   hits it needs `event.getModifierState('AltGraph')` here, and a strict rule
 *   until then beats an untested branch in the one file whose mistakes get
 *   committed.
 * - **`shift-Tab`**, which is the keyboard escape from a capture surface that
 *   otherwise swallows every key including `<Tab>` and `<Esc>`. A pointer user
 *   clicks away; without this a keyboard-only author is trapped, which is a real
 *   accessibility failure rather than an inconvenience. Core has no `<S-Tab>`
 *   consumer and Vim inserts nothing for it, so nothing is given up.
 * - **Anything `event.key` spells with more than one character**, which also
 *   catches IME composition (`Process`, `Unidentified`) and astral-plane
 *   characters, whose surrogate pair is two units long. That is core's own
 *   ceiling rather than this file's: `isPrintable` is `token.length === 1`, so
 *   there is no token to produce.
 */

import type { KeyToken } from '@vimorror/core';

export type KeyEventLike = {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  /**
   * Read for exactly one thing — letting `shift-Tab` out of a key-capture
   * surface. A shifted CHARACTER needs no help: `event.key` already carries it.
   */
  readonly shiftKey: boolean;
};

/**
 * The named keys core actually knows, by their `KeyboardEvent.key` spelling.
 *
 * `<NL>` and `<Nul>` are missing because no key produces them — `Enter` is a
 * carriage return here as it is in Vim's own notation, and `keys.ts` documents
 * `<Nul>` as the token nothing on either side generates.
 */
const NAMED: Readonly<Record<string, KeyToken>> = {
  Escape: '<Esc>',
  Enter: '<CR>',
  Tab: '<Tab>',
  Backspace: '<BS>',
  Delete: '<Del>',
};

/**
 * `Object.hasOwn` rather than a bare index, the same rule `schema.ts` documents
 * on `KEY_MACROS` and `stage-cells.ts` on `ENTITY_SKIN`: `event.key` is a string
 * off an untrusted event, and `NAMED['constructor']` would otherwise find an
 * inherited function and return it as a token.
 */
export function keyTokenFor(event: KeyEventLike): KeyToken | undefined {
  if (event.metaKey || event.altKey) return undefined;
  // The way out. Every other key the capture box receives is consumed, `<Esc>`
  // and `<Tab>` included, so one gesture has to stay the browser's.
  if (event.key === 'Tab' && event.shiftKey) return undefined;
  // Ctrl chords are letters only. Core knows `<C-a>`, `<C-i>`, `<C-o>`, `<C-r>`
  // and `<C-v>`; the rest reach it as an in-fiction `unknown-key` rejection,
  // which is the right answer for `<C-b>` and the wrong shape entirely for
  // `<C-1>` or `<C-[>` — notation nobody writes and `literalOf` cannot invert.
  if (event.ctrlKey) return /^[a-zA-Z]$/.test(event.key) ? `<C-${event.key.toLowerCase()}>` : undefined;
  if (Object.hasOwn(NAMED, event.key)) return NAMED[event.key];
  return event.key.length === 1 ? event.key : undefined;
}
