import { describe, expect, it } from 'vitest';

import { CURSOR_SHAPES, cursorShapeForMode } from './cursor-shape.ts';

describe('CURSOR_SHAPES', () => {
  it('pins the 8-mode table', () => {
    expect(CURSOR_SHAPES).toEqual({
      normal: 'block',
      'operator-pending': 'block',
      insert: 'bar',
      'command-line': 'bar',
      replace: 'underline',
      visual: 'hollow-block',
      'visual-line': 'hollow-block',
      'visual-block': 'hollow-block',
    });
  });

  it('cursorShapeForMode agrees with the table for every mode', () => {
    for (const [mode, shape] of Object.entries(CURSOR_SHAPES)) {
      expect(cursorShapeForMode(mode as keyof typeof CURSOR_SHAPES)).toBe(shape);
    }
  });
});
