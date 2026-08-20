/**
 * The pure half — the frequency law and the stinger shapes — plus the one
 * property the sounding half has to have in a test environment: **it does
 * nothing, silently.**
 *
 * There is no `AudioContext` under vitest's `node` environment, and that is not
 * an inconvenience to work around, it is the case worth pinning. The same guard
 * is what protects a browser that has locked WebAudio down, and if it were
 * missing the failure would not be no sound — it would be a `ReferenceError`
 * thrown out of the shell's first keydown listener, which is the one that
 * unlocks audio and therefore runs before anything else.
 *
 * The sounding half proper is verified in the browser, where `audioStatus()`
 * exists so the suspended-context trap can be read rather than assumed.
 */

import { describe, expect, it } from 'vitest';

import { audioStatus, baseHzFor, ensureAudio, playStinger, setAudioSettings, setDroneAct, stingerFor } from './audio.ts';

describe('baseHzFor', () => {
  it('starts act 1 at A1', () => {
    expect(baseHzFor(1)).toBe(55);
  });

  it('drops a semitone per act', () => {
    // A semitone is the twelfth root of two, and six acts is a tritone down.
    expect(baseHzFor(2) / baseHzFor(1)).toBeCloseTo(2 ** (-1 / 12), 10);
    expect(baseHzFor(6) / baseHzFor(1)).toBeCloseTo(2 ** (-5 / 12), 10);
  });

  it('never goes up', () => {
    const all = [1, 2, 3, 4, 5, 6].map(baseHzFor);
    expect(all).toEqual([...all].sort((a, b) => b - a));
  });

  it('clamps an act outside the curriculum to the nearest real one', () => {
    // Act 0 unclamped would be an octave's worth of the formula in the WRONG
    // direction — higher, not lower — which is the opposite of what a stage
    // authored ahead of its act should sound like.
    expect(baseHzFor(0)).toBe(baseHzFor(1));
    expect(baseHzFor(-3)).toBe(baseHzFor(1));
    expect(baseHzFor(99)).toBe(baseHzFor(6));
  });
});

describe('stingerFor', () => {
  it('rises for a win and falls for a loss', () => {
    expect(stingerFor('win').toHz).toBeGreaterThan(stingerFor('win').fromHz);
    expect(stingerFor('lose').toHz).toBeLessThan(stingerFor('lose').fromHz);
  });

  it('keeps both short, and every frequency above zero', () => {
    for (const kind of ['win', 'lose'] as const) {
      const s = stingerFor(kind);
      expect(s.seconds).toBeGreaterThan(0);
      expect(s.seconds).toBeLessThan(2);
      // `exponentialRampToValueAtTime` throws on a zero or negative target, so
      // this is a real constraint on the table rather than a taste one.
      expect(s.fromHz).toBeGreaterThan(0);
      expect(s.toHz).toBeGreaterThan(0);
    }
  });
});

describe('with no AudioContext', () => {
  it('does nothing rather than throwing, on every entry point', () => {
    expect(typeof AudioContext).toBe('undefined');
    expect(() => {
      ensureAudio();
      setAudioSettings({ muted: false, volume: 0.5 });
      setDroneAct(2);
      setDroneAct(undefined);
      playStinger('win');
      playStinger('lose');
    }).not.toThrow();
  });

  it('reports that there is no graph', () => {
    ensureAudio();
    expect(audioStatus().state).toBe('none');
  });
});
