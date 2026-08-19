/**
 * keyboard.ts — the translation table, and the keys that must produce nothing.
 *
 * The second half matters as much as the first. A key this file invents a token
 * for reaches a recorded `stage.solution` and gets committed; a key it declines
 * merely leaves the browser's own behaviour alone. So the `undefined` cases are
 * asserted one by one rather than left as "everything else".
 *
 * The named keys are checked against `tokenize` rather than against hand-written
 * strings, because the property that matters is that the two entry points AGREE:
 * a keyboard press and the notation an author writes for the same key have to
 * reach the engine as the same token, which is the whole of M3 Wave A's finding
 * in the other direction.
 */

import { tokenize } from '@vimorror/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { keyTokenFor, type KeyEventLike } from './keyboard.ts';

/** A bare press: no modifier held. */
const press = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('a keyboard press and its notation reach the engine as the same token', () => {
  it.each([
    ['Escape', '<Esc>'],
    ['Enter', '<CR>'],
    ['Tab', '<Tab>'],
    ['Backspace', '<BS>'],
    ['Delete', '<Del>'],
  ])('%s is what tokenize(%s) gives', (key, notation) => {
    expect(keyTokenFor(press(key))).toBe(tokenize(notation)[0]);
  });

  it('a ctrl chord matches its notation too', () => {
    expect(keyTokenFor(press('r', { ctrlKey: true }))).toBe(tokenize('<C-r>')[0]);
    expect(keyTokenFor(press('v', { ctrlKey: true }))).toBe(tokenize('<C-v>')[0]);
  });

  it('lowercases the chord, so shift+ctrl+R is still <C-r>', () => {
    expect(keyTokenFor(press('R', { ctrlKey: true }))).toBe('<C-r>');
  });

  it('passes a shifted character through as itself — <S-…> is notation-only', () => {
    // A real browser reports the SHIFTED value in `key`, so the flag is not
    // consulted: `shiftKey` here would be true and changes nothing.
    expect(keyTokenFor(press('A', { shiftKey: true }))).toBe('A');
    expect(keyTokenFor(press('$', { shiftKey: true }))).toBe('$');
    expect(keyTokenFor(press('A'))).toBe('A');
    expect(keyTokenFor(press('$'))).toBe('$');
    expect(keyTokenFor(press('('))).toBe('(');
  });

  it('delivers the spacebar as the character the space motion takes', () => {
    // M3 Wave A's measurement: the space motion fired only for the NAMED
    // `<Space>` token, so a real press did nothing at all. Both spellings are
    // `' '` now, and this is the side that would have inherited the divergence.
    expect(keyTokenFor(press(' '))).toBe(' ');
    expect(tokenize('<Space>')[0]).toBe(' ');
  });

  it("delivers a bare '<' as the un-indent operator, not as notation", () => {
    expect(keyTokenFor(press('<'))).toBe('<');
    expect(tokenize('<lt>')[0]).toBe('<');
  });

  it('PROPERTY: any single-character key passes through unchanged', () => {
    fc.assert(
      fc.property(
        fc.fullUnicodeString({ minLength: 1, maxLength: 1 }).filter((s) => s.length === 1),
        (char) => {
          expect(keyTokenFor(press(char))).toBe(char);
        },
      ),
    );
  });
});

describe('keys that must produce nothing, so the browser keeps them', () => {
  it.each([
    ['ArrowLeft'],
    ['ArrowRight'],
    ['ArrowUp'],
    ['ArrowDown'],
    ['Home'],
    ['End'],
    ['PageDown'],
    ['F1'],
    ['Shift'],
    ['Control'],
    ['Meta'],
    ['CapsLock'],
    ['Insert'],
    // IME composition and a key the browser could not identify.
    ['Process'],
    ['Dead'],
    ['Unidentified'],
  ])('%s', (key) => {
    expect(keyTokenFor(press(key))).toBeUndefined();
  });

  it('an astral-plane character, whose surrogate pair is two units long', () => {
    // Core has no token for it: `isPrintable` is `token.length === 1`, so there
    // is nothing honest to return. The gap is core's, and it is documented as
    // such rather than papered over here.
    expect('😱'.length).toBe(2);
    expect(keyTokenFor(press('😱'))).toBeUndefined();
  });

  it('an empty key, which a `<= 1` length check would pass through', () => {
    expect(keyTokenFor(press(''))).toBeUndefined();
  });

  it('a meta chord, so cmd-R still reloads', () => {
    expect(keyTokenFor(press('r', { metaKey: true }))).toBeUndefined();
  });

  it('an alt chord, so the OS keeps its own shortcuts', () => {
    expect(keyTokenFor(press('j', { altKey: true }))).toBeUndefined();
    // AltGr reports both, and is the documented cost of the strict rule.
    expect(keyTokenFor(press('ą', { ctrlKey: true, altKey: true }))).toBeUndefined();
  });

  it('shift+Tab, which is the only way out of a capture surface', () => {
    // A plain Tab is a real key and IS consumed, which is what makes the pair
    // matter: without the shifted spelling a keyboard-only author cannot leave.
    expect(keyTokenFor(press('Tab'))).toBe('<Tab>');
    expect(keyTokenFor(press('Tab', { shiftKey: true }))).toBeUndefined();
  });

  it('a ctrl chord that is not a letter', () => {
    expect(keyTokenFor(press('1', { ctrlKey: true }))).toBeUndefined();
    expect(keyTokenFor(press('[', { ctrlKey: true }))).toBeUndefined();
    expect(keyTokenFor(press('ArrowLeft', { ctrlKey: true }))).toBeUndefined();
    // Even a named key: ctrl+Escape is an OS gesture, not `<Esc>`.
    expect(keyTokenFor(press('Escape', { ctrlKey: true }))).toBeUndefined();
  });

  it('an inherited property name, which a bare index would return as a token', () => {
    // The `Object.hasOwn` rule `schema.ts` documents on `KEY_MACROS`. Both of
    // these are longer than one character, so the fallthrough catches them too —
    // the point is that neither can ever come back as a function.
    expect(keyTokenFor(press('constructor'))).toBeUndefined();
    expect(keyTokenFor(press('toString'))).toBeUndefined();
  });
});
