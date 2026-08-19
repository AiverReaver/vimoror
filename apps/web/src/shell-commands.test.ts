/**
 * The vocabulary table, both directions, plus the keys that must NOT be
 * commands.
 *
 * Every `keys` string below was measured on a live `VimEngine` rather than
 * written from the notation rules — `probeResolved` at the bottom re-derives
 * them from the engine itself, so a change in how core renders a resolved
 * command breaks this suite instead of silently making the title screen deaf.
 */

import { VimEngine } from '@vimorror/core';
import { DIFFICULTIES, type Difficulty } from '@vimorror/game';
import { describe, expect, it } from 'vitest';

import { commandText, shellCommandFor, type ShellCommand } from './shell-commands.ts';

/** What core actually puts in `CommandResolved.keys` for a typed line. */
function probeResolved(notation: string): string[] {
  const engine = new VimEngine(['a buffer to type at']);
  return engine
    .feedKeys(notation)
    .filter((e) => e.type === 'CommandResolved')
    .map((e) => e.command.keys);
}

describe('the vocabulary', () => {
  it('reads every difficulty as a set-difficulty command', () => {
    for (const difficulty of Object.keys(DIFFICULTIES) as Difficulty[]) {
      expect(shellCommandFor(`:set ${difficulty}<CR>`)).toEqual({ kind: 'set-difficulty', difficulty });
    }
  });

  it.each([
    [':play<CR>', 'play'],
    [':stages<CR>', 'stages'],
    [':settings<CR>', 'settings'],
  ])('reads %s as %s', (keys, kind) => {
    expect(shellCommandFor(keys)).toEqual({ kind });
  });

  it('round-trips through commandText — the label and the table cannot drift', () => {
    const commands: ShellCommand[] = [
      ...(Object.keys(DIFFICULTIES) as Difficulty[]).map((difficulty) => ({ kind: 'set-difficulty', difficulty }) as const),
      { kind: 'play' },
      { kind: 'stages' },
      { kind: 'settings' },
    ];
    for (const command of commands) {
      expect(shellCommandFor(`${commandText(command)}<CR>`)).toEqual(command);
    }
  });
});

describe('what is deliberately not a command', () => {
  it.each([
    // A real `:set` that really changed an option. The trap a prefix match falls into.
    ':set sw=4<CR>',
    ':set expandtab<CR>',
    // The prompt the player cancelled. It resolves, and it means "never mind".
    ':<Esc>',
    ':w<CR>',
    ':q<CR>',
    ':q!<CR>',
    // Ordinary normal-mode commands share the same event.
    'dd',
    'j',
    // Near misses.
    ':play',
    ':PLAY<CR>',
    ':play!<CR>',
    ':set VeryMagic<CR>',
    ':set  verymagic<CR>',
    '',
  ])('%s is not a shell command', (keys) => {
    expect(shellCommandFor(keys)).toBeUndefined();
  });

  it('is not fooled by an inherited property name', () => {
    expect(shellCommandFor('constructor')).toBeUndefined();
    expect(shellCommandFor('toString')).toBeUndefined();
  });
});

describe('against a live engine', () => {
  it.each([':set verymagic', ':set magic', ':set nomagic', ':play', ':stages', ':settings'])(
    '%s resolves to keys this table recognises',
    (typed) => {
      const resolved = probeResolved(`${typed}<CR>`);
      expect(resolved).toEqual([`${typed}<CR>`]);
      expect(shellCommandFor(resolved[0]!)).toBeDefined();
    },
  );

  it('a cancelled prompt resolves and is not a command', () => {
    expect(probeResolved(':<Esc>')).toEqual([':<Esc>']);
    expect(shellCommandFor(':<Esc>')).toBeUndefined();
  });

  it('`:set sw=4` resolves and is not a difficulty change', () => {
    const [keys] = probeResolved(':set sw=4<CR>');
    expect(keys).toBe(':set sw=4<CR>');
    expect(shellCommandFor(keys!)).toBeUndefined();
  });
});
