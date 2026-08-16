/**
 * demo.ts — the M0 "done when" scripted demo: drives the engine through
 * `d2w` / `ci(` / `qa…q@a` / `:%s//g` from a JSON snapshot and back.
 *
 * Each scene starts an engine, serializes its snapshot to JSON (the "from a
 * JSON snapshot" half), restores a fresh engine from that JSON, runs the
 * keys, then serializes the RESULT and restores a second engine from it (the
 * "and back" half) to prove the round trip is lossless. Expected buffers are
 * taken verbatim from already Vim-verified goldens (`proven.json`,
 * `wave4-macros.json`, `wave4-subst.json`) rather than hand-guessed — this
 * project's whole premise is that nobody should trust their memory of Vim.
 *
 * `pnpm demo`
 */

import { VimEngine, type EngineSnapshot } from '../packages/vim-core/src/index.ts';

type Scene = {
  name: string;
  lines: string[];
  cursor: { line: number; col: number };
  keys: string;
  expectLines: string[];
  expectCursor?: { line: number; col: number };
};

const scenes: Scene[] = [
  {
    name: 'd2w — operator + count + motion',
    lines: ['alpha beta gamma delta'],
    cursor: { line: 0, col: 0 },
    keys: 'd2w',
    expectLines: ['gamma delta'],
    expectCursor: { line: 0, col: 0 },
  },
  {
    name: 'ci( — text object with an inner change',
    lines: ['fn(a, b, c) end'],
    cursor: { line: 0, col: 6 },
    keys: 'ci(X<Esc>',
    expectLines: ['fn(X) end'],
    expectCursor: { line: 0, col: 3 },
  },
  {
    name: 'qa…q@a — record a macro, then replay it once',
    lines: ['one', 'two'],
    cursor: { line: 0, col: 0 },
    keys: 'qaAxyz<Esc>jq@a',
    expectLines: ['onexyz', 'twoxyz'],
    expectCursor: { line: 1, col: 5 },
  },
  {
    name: ':%s//g — whole-file substitute reusing the last search pattern',
    lines: ['x a x a x', 'b x c'],
    cursor: { line: 0, col: 0 },
    keys: '/x<CR>:%s//Q/g<CR>',
    expectLines: ['Q a Q a Q', 'b Q c'],
    expectCursor: { line: 1, col: 0 },
  },
];

let failures = 0;

for (const scene of scenes) {
  console.log(`\n--- ${scene.name} ---`);
  console.log(`keys: ${scene.keys}`);

  // "from a JSON snapshot": build the starting engine, then round-trip it
  // through JSON before ever feeding it a key.
  const seed = new VimEngine(scene.lines, scene.cursor);
  const inJson = JSON.stringify(seed.snapshot());
  const engine = VimEngine.restore(JSON.parse(inJson) as EngineSnapshot);

  engine.feedKeys(scene.keys);

  console.log(`buffer: ${JSON.stringify(engine.lines)}`);
  console.log(`cursor: ${JSON.stringify(engine.cursor)}`);

  const bufferOk = JSON.stringify(engine.lines) === JSON.stringify(scene.expectLines);
  const cursorOk = scene.expectCursor === undefined || JSON.stringify(engine.cursor) === JSON.stringify(scene.expectCursor);

  // "and back": the end state must also survive a JSON round trip unchanged.
  const outJson = JSON.stringify(engine.snapshot());
  const restored = VimEngine.restore(JSON.parse(outJson) as EngineSnapshot);
  const roundTripOk =
    JSON.stringify(restored.lines) === JSON.stringify(engine.lines) &&
    JSON.stringify(restored.cursor) === JSON.stringify(engine.cursor);

  const ok = bufferOk && cursorOk && roundTripOk;
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) {
    failures++;
    if (!bufferOk) console.log(`  expected buffer ${JSON.stringify(scene.expectLines)}`);
    if (!cursorOk) console.log(`  expected cursor ${JSON.stringify(scene.expectCursor)}`);
    if (!roundTripOk) console.log('  JSON snapshot round trip did not reproduce the engine state');
  }
}

console.log(`\n${scenes.length - failures}/${scenes.length} scenes passed`);
if (failures > 0) process.exit(1);
