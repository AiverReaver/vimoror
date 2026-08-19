/**
 * font.ts — the memo, and the half of it that is a bug fix rather than a cache.
 *
 * These semantics lived un-pinned inside a React file until the lift, which is
 * exactly why they are pinned now: both halves are invisible when broken. A memo
 * that never caches leaks a `FontFace` and an `OffscreenCanvas` per mount and
 * still renders correctly; a memo that caches the REJECTION renders nothing ever
 * again after one missing woff2, and a reload of the pane replays the same
 * failure forever.
 *
 * `bakeFontAtlas` is mocked because it is the DOM half — `FontFace`,
 * `document.fonts`, `OffscreenCanvas` — and none of that exists in vitest's node
 * environment. What is under test here is not the bake; it is the four lines
 * around it.
 */

import { bakeFontAtlas, type FontAtlas } from '@vimorror/render';
import { describe, expect, it, vi } from 'vitest';

import { atlasScaleFor, CELL_H, CELL_W, getFontAtlas } from './font.ts';

vi.mock('@vimorror/render', () => ({ bakeFontAtlas: vi.fn() }));

describe('the font atlas is baked once, but a failed bake is retried', () => {
  it('clears the memo on rejection and keeps it on success', async () => {
    const atlas = { cellW: 9, cellH: 18 } as FontAtlas;
    const bake = vi.mocked(bakeFontAtlas);

    bake.mockRejectedValueOnce(new Error('no woff2 here'));
    await expect(getFontAtlas()).rejects.toThrow('no woff2 here');

    // The point of the whole test: a second call re-bakes instead of handing
    // back the stored rejection.
    bake.mockResolvedValue(atlas);
    await expect(getFontAtlas()).resolves.toBe(atlas);

    // And the point of the memo: the third call bakes nothing.
    await expect(getFontAtlas()).resolves.toBe(atlas);
    expect(bake).toHaveBeenCalledTimes(2);
  });
});

/**
 * The scale is keyed, not shared. A single memo would hand a 2x caller the 1x
 * atlas it happened to find there — which renders, at half the cell size, in the
 * top-left quarter of the canvas, and is exactly the failure M4-PLAN's own DPR
 * prescription produces. Nothing throws in either case.
 */
describe('the atlas is memoised per device-pixel scale', () => {
  it('bakes once per scale, at scaled cells, and never crosses scales', async () => {
    const bake = vi.mocked(bakeFontAtlas);
    bake.mockReset();
    bake.mockImplementation((_url, cellW, cellH) => Promise.resolve({ cellW, cellH } as FontAtlas));

    // Scale 1 is already memoised by the suite above, so this asserts the
    // GEOMETRY rather than the call count.
    await expect(getFontAtlas()).resolves.toMatchObject({ cellW: CELL_W, cellH: CELL_H });

    const twice = await getFontAtlas(2);
    expect(twice).toMatchObject({ cellW: CELL_W * 2, cellH: CELL_H * 2 });
    expect(await getFontAtlas(2)).toBe(twice);
    expect(bake).toHaveBeenCalledTimes(1);

    // A fractional ratio resolves to an integer scale, so it shares 2x's atlas
    // rather than baking a third one on fractional pixel boundaries.
    expect(await getFontAtlas(2.25)).toBe(twice);
    expect(bake).toHaveBeenCalledTimes(1);
  });

  it('clamps the scale to integers in 1..3', () => {
    expect(atlasScaleFor(1)).toBe(1);
    expect(atlasScaleFor(1.5)).toBe(2);
    expect(atlasScaleFor(2)).toBe(2);
    expect(atlasScaleFor(3.4)).toBe(3);
    // A dpr of 0 (or worse) would otherwise bake a zero-sized atlas.
    expect(atlasScaleFor(0)).toBe(1);
    expect(atlasScaleFor(Number.NaN)).toBe(1);
  });
});
