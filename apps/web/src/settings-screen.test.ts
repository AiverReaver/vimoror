/**
 * The one decision in the settings module that is a policy rather than a
 * control: what `effectsIntensity` starts at.
 *
 * Pinned here rather than checked in the browser because the browser cannot
 * check it — `prefers-reduced-motion` is an OS setting, so the reduced-motion
 * branch is the half a hand-verification never reaches, and it is the half that
 * matters. A stub is the only way to see both.
 *
 * The query string itself is asserted, not just the outcome. A typo in a media
 * query does not throw: `matchMedia('(prefers-reduced-motion)')` and
 * `matchMedia('(prefers-reduced-mostion: reduce)')` both return an object whose
 * `matches` is `false`, which reads exactly like a profile that never asked for
 * reduced motion — so the failure mode is a player who set the accessibility
 * preference and gets full-strength effects anyway.
 */

import { DEFAULT_COMFORT, DEFAULT_DIFFICULTY } from '@vimorror/game';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from './settings-screen.tsx';

const original = globalThis.matchMedia;

/** Records what was asked, answers `matches`. */
function stubMatchMedia(matches: boolean): { readonly queries: string[] } {
  const queries: string[] = [];
  globalThis.matchMedia = ((query: string) => {
    queries.push(query);
    return { matches } as MediaQueryList;
  }) as typeof globalThis.matchMedia;
  return { queries };
}

afterEach(() => {
  if (original === undefined) delete (globalThis as { matchMedia?: unknown }).matchMedia;
  else globalThis.matchMedia = original;
  vi.restoreAllMocks();
});

describe('defaultSettings', () => {
  it('asks for reduced motion by the exact media feature', () => {
    const { queries } = stubMatchMedia(false);
    defaultSettings();
    expect(queries).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('starts effects at 0 for a profile that asked for reduced motion', () => {
    stubMatchMedia(true);
    expect(defaultSettings().effectsIntensity).toBe(0);
  });

  it('starts effects at 0.6 otherwise — picked by eye on the real CRT pass', () => {
    stubMatchMedia(false);
    expect(defaultSettings().effectsIntensity).toBe(0.6);
  });

  it('survives having no matchMedia at all rather than failing to boot', () => {
    delete (globalThis as { matchMedia?: unknown }).matchMedia;
    expect(defaultSettings().effectsIntensity).toBe(0.6);
  });

  it('takes difficulty and comfort from the packages that own them', () => {
    stubMatchMedia(false);
    const settings = defaultSettings();
    expect(settings.difficulty).toBe(DEFAULT_DIFFICULTY);
    expect(settings.comfort).toEqual(DEFAULT_COMFORT);
  });
});
