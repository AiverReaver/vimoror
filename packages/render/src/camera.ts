/**
 * Camera math: keeping a cursor line visible inside a scrolled viewport, and
 * mapping buffer positions to screen coordinates. Pure, no DOM — caller
 * decides *when* to scroll; this only computes *where* `topline` lands.
 */

import type { Pos } from '@vimorror/core';

import type { Camera } from './types.ts';

/**
 * Scrolls `topline` the minimum amount to bring `cursorLine` back inside the
 * `camera.height`-row window. Scrolling past EOF is allowed (topline is
 * never clamped against the buffer's length, mirroring Vim's tilde rows past
 * the buffer) — only the low end is clamped, at 0.
 */
export function followCursor(camera: Camera, cursorLine: number): Camera {
  let topline = camera.topline;
  if (cursorLine < topline) {
    topline = cursorLine;
  } else if (cursorLine >= topline + camera.height) {
    topline = cursorLine - camera.height + 1;
  }
  topline = Math.max(0, topline);
  return topline === camera.topline ? camera : { ...camera, topline };
}

/**
 * Buffer position to screen-relative row/col, or `null` if `pos` is
 * currently scrolled out of `camera`'s visible window (above `topline`, at
 * or past `topline + height`, or past `width` columns).
 */
export function bufferPosToScreen(camera: Camera, pos: Pos): { row: number; col: number } | null {
  const row = pos.line - camera.topline;
  if (row < 0 || row >= camera.height) return null;
  if (pos.col < 0 || pos.col >= camera.width) return null;
  return { row, col: pos.col };
}
