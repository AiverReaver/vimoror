/**
 * Wave C/D demo: a live, keyboard-driven glyph grid over a real `VimEngine`,
 * drawn through the full `createRenderer` pipeline.
 *
 * Two renderers over the same frame, side by side — the primary one on WebGL2
 * (or the fallback, if this machine has no WebGL2) and a second forced onto
 * the fallback path, so the CRT layer's effect at any intensity is a direct
 * visual comparison rather than a before/after screenshot pair.
 *
 * Demo-only glue: the `KeyboardEvent` → `KeyToken` translator here is not real
 * input handling (that's M4's job), just enough to drive the engine from a
 * browser for visual verification.
 */

import { VimEngine, type KeyToken } from '@vimorror/core';

import { linesToCells } from '../src/cell-buffer.ts';
import { followCursor } from '../src/camera.ts';
import { bakeFontAtlas } from '../src/font-atlas.ts';
import { createRenderer } from '../src/pipeline.ts';
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
const fallbackCanvas = document.querySelector<HTMLCanvasElement>('#grid-fallback')!;
for (const c of [canvas, fallbackCanvas]) {
  c.width = COLS * CELL_W;
  c.height = ROWS * CELL_H;
}

const modeEl = document.querySelector<HTMLElement>('#mode')!;
const pendingEl = document.querySelector<HTMLElement>('#pending')!;
const pathEl = document.querySelector<HTMLElement>('#path')!;
const intensityEl = document.querySelector<HTMLInputElement>('#intensity')!;
const intensityReadoutEl = document.querySelector<HTMLElement>('#intensity-readout')!;
const forceFallbackEl = document.querySelector<HTMLInputElement>('#force-fallback')!;
const fallbackPaneEl = document.querySelector<HTMLElement>('#fallback-pane')!;

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
  const renderer = createRenderer(canvas, { atlas });
  const fallbackRenderer = createRenderer(fallbackCanvas, { atlas, forceFallback: true });
  pathEl.textContent = renderer.kind;

  /** Driven by rAF, not by keystrokes: phosphor persistence and the glitch
   * bands are both time-varying, so the post-FX pass has to keep running even
   * when the buffer is idle. The glyph grid's own dirty-cell diff still means
   * an idle frame redraws nothing but the cursor cell. */
  function frame(): void {
    camera = followCursor(camera, engine.cursor.line);
    const cells = linesToCells(viewportLines(), FG, BG);
    const effectsIntensity = Number(intensityEl.value) / 100;
    const args = {
      cells,
      camera,
      cursor: { pos: engine.cursor, mode: engine.mode },
      effectsIntensity,
    };

    renderer.draw(args);
    if (!fallbackPaneEl.hidden) fallbackRenderer.draw(args);

    intensityReadoutEl.textContent = effectsIntensity.toFixed(2);
    modeEl.textContent = engine.mode;
    pendingEl.textContent = engine.pending.keyBuffer.join('') || '(none)';
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', (e) => {
    const token = translateKey(e);
    if (token === null) return;
    e.preventDefault();
    engine.feed(token);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('#buttons button')) {
    button.addEventListener('click', () => engine.feedKeys(button.dataset['keys']!));
  }

  forceFallbackEl.addEventListener('change', () => {
    fallbackPaneEl.hidden = !forceFallbackEl.checked;
  });

  requestAnimationFrame(frame);
}

main();
