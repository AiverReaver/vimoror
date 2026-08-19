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

import { getFontAtlas } from './font.ts';

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
