/**
 * The shell's entire command vocabulary: a resolved command's keys in, one
 * screen-level intent out.
 *
 * This is M4-PLAN.md's fact 1 arriving as twelve lines, and the reason it can be
 * twelve lines is worth stating, because the obvious implementations are both
 * wrong. Measured on a live engine rather than reasoned out:
 *
 * - **`:set` does not know the magic options, and does not complain.**
 *   `applyOneSetArg` (`excmd.ts`) matches `shiftwidth`/`expandtab`/… and
 *   silently returns the options unchanged for anything else. So a shell that
 *   waited for an `OptionSet` event, or fed `:set verymagic` and read the
 *   engine's options back, would wait forever. What it does emit is
 *   `CommandResolved` with `keys: ':set verymagic<CR>'` — the full typed text.
 * - **An unknown command still resolves.** `:play<CR>` emits `InvalidCommand
 *   (unknown-command)` *and* `CommandResolved` with `keys: ':play<CR>'`, which
 *   is M3 Wave D's "a failed command still resolves" rule applying to ex
 *   commands. So a verb core has never heard of arrives here intact, and the
 *   shell needs no parallel command-line implementation to drift from core's.
 *
 * **Exact match on the whole string, deliberately.** `keys` is core's own
 * rendering of what was typed, terminator included, so the table's keys are the
 * literal thing the player pressed. Two consequences that a prefix match or a
 * regex would get wrong, both pinned by the test:
 *
 * - `:set sw=4<CR>` is a REAL command that really did something, and must not be
 *   mistaken for a difficulty change. Exact match misses it for free.
 * - `:<Esc>` — the cancelled prompt — also resolves, with `keys: ':<Esc>'`. It
 *   means the player changed their mind, and it must return `undefined`.
 *
 * `<BS>` does not edit the command line: `:plaz<BS><BS>y<CR>` resolves as that
 * literal string and reads as an unknown command. That is core's ceiling, not
 * this file's, and the screens answer it the honest way — `<Esc>` clears the
 * prompt, and a command nobody knows says so in `rejectionLine`'s own words
 * rather than in new copy invented here.
 *
 * Pure, so the title screen and the runner share ONE vocabulary. The runner uses
 * it for exactly one thing: a mid-stage `:set nomagic` really resolved — it cost
 * a keystroke and ticked the world — so it is acknowledged rather than silently
 * dropped.
 */

import type { Difficulty } from '@vimorror/game';

export type ShellCommand =
  | { readonly kind: 'set-difficulty'; readonly difficulty: Difficulty }
  | { readonly kind: 'play' }
  | { readonly kind: 'stages' }
  | { readonly kind: 'settings' };

/**
 * Written out rather than generated from `DIFFICULTIES`, so the file reads as
 * the vocabulary it is. `shell-commands.test.ts` walks `DIFFICULTIES` and
 * asserts every difficulty has an entry — the same both-directions drift guard
 * the repo already uses for `EDITS`/`FIELD_ORDER` and for `campaign.json`
 * against `content/stages/`.
 */
const VOCABULARY: Readonly<Record<string, ShellCommand>> = {
  ':set verymagic<CR>': { kind: 'set-difficulty', difficulty: 'verymagic' },
  ':set magic<CR>': { kind: 'set-difficulty', difficulty: 'magic' },
  ':set nomagic<CR>': { kind: 'set-difficulty', difficulty: 'nomagic' },
  ':play<CR>': { kind: 'play' },
  ':stages<CR>': { kind: 'stages' },
  ':settings<CR>': { kind: 'settings' },
};

/**
 * `Object.hasOwn` rather than a bare index, the rule `keyboard.ts` and
 * `stage-cells.ts` both state: `keys` is a string built from untrusted
 * keystrokes, and `VOCABULARY['constructor']` would otherwise find an inherited
 * function and return it as a command.
 */
export function shellCommandFor(keys: string): ShellCommand | undefined {
  return Object.hasOwn(VOCABULARY, keys) ? VOCABULARY[keys] : undefined;
}

/**
 * What a player types to reach `command`, without the terminator — so a button
 * beside the prompt can be labelled with the keystrokes it stands in for, which
 * is the only way the buttons teach rather than merely work.
 *
 * A second spelling of the same rule, and therefore a drift risk in both
 * directions: the test closes it by round-tripping every entry of `VOCABULARY`
 * back through `shellCommandFor`, so a verb renamed on one side and not the
 * other fails there rather than mislabelling the front door.
 */
export function commandText(command: ShellCommand): string {
  return command.kind === 'set-difficulty' ? `:set ${command.difficulty}` : `:${command.kind}`;
}
