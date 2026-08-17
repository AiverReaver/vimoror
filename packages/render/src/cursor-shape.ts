/**
 * Mode -> cursor shape lookup. Keyed off vim-core's actual 8-variant `Mode`
 * union via `Record<Mode, CursorShape>` (not `Partial`) so TypeScript
 * enforces exhaustiveness if a 9th mode is ever added. Low-stakes, trivially
 * adjustable later.
 */

import type { Mode } from '@vimorror/core';

import type { CursorShape } from './types.ts';

export const CURSOR_SHAPES: Record<Mode, CursorShape> = {
  normal: 'block',
  'operator-pending': 'block',
  insert: 'bar',
  'command-line': 'bar',
  replace: 'underline',
  visual: 'hollow-block',
  'visual-line': 'hollow-block',
  'visual-block': 'hollow-block',
};

export function cursorShapeForMode(mode: Mode): CursorShape {
  return CURSOR_SHAPES[mode];
}
