import { describe, expect, it } from 'vitest';

import { createCellBuffer, diffCells, linesToCells } from './cell-buffer.ts';

describe('diffCells', () => {
  it('returns nothing for two identical buffers', () => {
    const a = linesToCells(['abc', 'de'], '#fff', '#000');
    const b = linesToCells(['abc', 'de'], '#fff', '#000');
    expect(diffCells(a, b)).toEqual([]);
  });

  it('reports exactly one entry for a single changed cell', () => {
    const prev = linesToCells(['abc', 'def'], '#fff', '#000');
    const next = linesToCells(['abc', 'dXf'], '#fff', '#000');
    const diffs = diffCells(prev, next);
    expect(diffs).toEqual([{ row: 1, col: 1, cell: { char: 'X', fg: '#fff', bg: '#000' } }]);
  });

  it('reports every cell when the whole buffer changes', () => {
    const prev = createCellBuffer(2, 2);
    const next = linesToCells(['XX', 'XX'], '#fff', '#000');
    const diffs = diffCells(prev, next);
    expect(diffs).toHaveLength(4);
    const positions = diffs.map((d) => `${d.row},${d.col}`).sort();
    expect(positions).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });
});
