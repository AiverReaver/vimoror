/**
 * Wave C demo: a live, keyboard-driven glyph grid over a real `VimEngine`.
 * Demo-only glue — the `KeyboardEvent` → `KeyToken` translator here is not
 * real input handling (that's M4's job), just enough to drive the engine
 * from a browser for visual verification.
 */

import { VimEngine, type KeyToken } from '@vimorror/core';

import { linesToCells } from '../src/cell-buffer.ts';
import { bufferPosToScreen, followCursor } from '../src/camera.ts';
import { cursorShapeForMode } from '../src/cursor-shape.ts';
import { bakeFontAtlas } from '../src/font-atlas.ts';
import { GlyphGrid } from '../src/glyph-grid.ts';
import type { Camera } from '../src/types.ts';

const CELL_W = 10;
const CELL_H = 20;
const FONT_SIZE_PX = 16;
const COLS = 80;
const ROWS = 24;
const FG = '#e0e0e0';
const BG = '#000000';

const FONT_URL = new URL('../assets/fonts/JetBrainsMono-Regular.woff2', import.meta.url).href;

const INITIAL_LINES = [
  'The quick brown fox jumps over the lazy dog.',
  '',
  'vimorror renders vim-core through a hand-rolled Canvas2D glyph grid.',
  'Try: dw  ci(  v$d  gg  G  u  <C-r>  /fox<CR>  :s/fox/cat/',
  '',
  '(word) [bracket] {brace} "quoted string"',
];

const canvas = document.querySelector<HTMLCanvasElement>('#grid')!;
canvas.width = COLS * CELL_W;
canvas.height = ROWS * CELL_H;

const modeEl = document.querySelector<HTMLElement>('#mode')!;
const pendingEl = document.querySelector<HTMLElement>('#pending')!;

const engine = new VimEngine(INITIAL_LINES);
let camera: Camera = { topline: 0, height: ROWS, width: COLS };

/** Pads/truncates every visible line to a fixed `COLS`, so `linesToCells`'s
 * own longest-line width calc always lands on exactly the canvas's size. */
function viewportLines(): string[] {
  const out: string[] = [];
  for (let i = 0; i < camera.height; i += 1) {
    const line = engine.lines[camera.topline + i] ?? '';
    out.push(line.slice(0, camera.width).padEnd(camera.width, ' '));
  }
  return out;
}

/** Not real input handling — enough browser-key -> vim-core notation to
 * drive the demo. Ignores anything with no vim-core meaning (arrows, F-keys,
 * bare modifiers) so the browser's own default behavior still applies. */
function translateKey(e: KeyboardEvent): KeyToken | null {
  if (e.ctrlKey && e.key.length === 1 && /[a-z]/i.test(e.key)) {
    return `<C-${e.key.toLowerCase()}>`;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return null;

  switch (e.key) {
    case 'Escape':
      return '<Esc>';
    case 'Enter':
      return '<CR>';
    case 'Tab':
      return '<Tab>';
    case 'Backspace':
      return '<BS>';
    case 'Delete':
      return '<Del>';
  }

  return e.key.length === 1 ? e.key : null;
}

async function main() {
  const atlas = await bakeFontAtlas(FONT_URL, CELL_W, CELL_H, FONT_SIZE_PX);
  const grid = new GlyphGrid(canvas, CELL_W, CELL_H);

  function draw(): void {
    camera = followCursor(camera, engine.cursor.line);
    const cells = linesToCells(viewportLines(), FG, BG);
    const pos = bufferPosToScreen(camera, engine.cursor);
    grid.render(cells, atlas, { pos, shape: cursorShapeForMode(engine.mode) });
    modeEl.textContent = engine.mode;
    pendingEl.textContent = engine.pending.keyBuffer.join('') || '(none)';
  }

  window.addEventListener('keydown', (e) => {
    const token = translateKey(e);
    if (token === null) return;
    e.preventDefault();
    engine.feed(token);
    draw();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('#buttons button')) {
    button.addEventListener('click', () => {
      engine.feedKeys(button.dataset['keys']!);
      draw();
    });
  }

  draw();
}

main();
