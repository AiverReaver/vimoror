/**
 * camera.ts — pure viewport math, no DOM. Covers exactly what
 * docs/M1-PLAN.md's Testing section calls for: scroll-minimum, a short
 * buffer, and topline floor/ceiling (never negative; scrolling past EOF is
 * allowed by spec — `followCursor` takes no buffer-length input at all, so
 * there's nothing to clamp against — checked here by scrolling well past any
 * plausible buffer size and confirming it still just tracks the cursor).
 */

import { describe, expect, it } from 'vitest';

import { bufferPosToScreen, followCursor } from './camera.ts';
import type { Camera } from './types.ts';

const camera = (topline: number): Camera => ({ topline, height: 10, width: 40 });

describe('followCursor', () => {
  it('leaves topline untouched when the cursor is already inside the window', () => {
    const c = followCursor(camera(5), 8);
    expect(c.topline).toBe(5);
  });

  it('scrolls up by exactly enough when the cursor is just above the window', () => {
    // Window is [5, 15). Cursor at 4 is one row above it.
    const c = followCursor(camera(5), 4);
    expect(c.topline).toBe(4);
  });

  it('scrolls down by exactly enough when the cursor is just below the window', () => {
    // Window is [5, 15). Cursor at 15 is one row below it (height 10).
    const c = followCursor(camera(5), 15);
    expect(c.topline).toBe(6);
  });

  it('scrolls down the minimum amount for a cursor far below the window, past any plausible buffer length (EOF)', () => {
    const c = followCursor(camera(0), 42);
    expect(c.topline).toBe(42 - 10 + 1);
  });

  it('scrolls up the minimum amount for a cursor far above the window', () => {
    const c = followCursor(camera(50), 3);
    expect(c.topline).toBe(3);
  });

  it('a short buffer (cursor never reaches the bottom of a tall window) keeps topline at 0', () => {
    const c0 = followCursor(camera(0), 0);
    expect(c0.topline).toBe(0);
    const c1 = followCursor(camera(0), 3);
    expect(c1.topline).toBe(0);
  });

  it('clamps topline at 0, never negative', () => {
    const c = followCursor(camera(0), 0);
    expect(c.topline).toBe(0);
    expect(c.topline).not.toBeLessThan(0);
  });
});

describe('bufferPosToScreen', () => {
  it('maps a visible position to screen-relative row/col', () => {
    const c = camera(5);
    expect(bufferPosToScreen(c, { line: 7, col: 3 })).toEqual({ row: 2, col: 3 });
  });

  it('returns null for a position scrolled above the window', () => {
    const c = camera(5);
    expect(bufferPosToScreen(c, { line: 4, col: 0 })).toBeNull();
  });

  it('returns null for a position at or past the bottom of the window', () => {
    const c = camera(5);
    expect(bufferPosToScreen(c, { line: 15, col: 0 })).toBeNull();
  });

  it('returns null for a column past camera.width', () => {
    const c = camera(5);
    expect(bufferPosToScreen(c, { line: 5, col: 40 })).toBeNull();
  });
});
