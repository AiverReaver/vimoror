# M1 — `@vimorror/render` build plan

`MergedPlan.md` and `docs/CHECKLIST.md` both leave M1 as an undecomposed bullet
list and say every milestone after M0 "needs its own plan before it starts" —
unlike M0, there was no file breakdown, build order, or done-line for M1
anywhere in the repo. This doc is that decomposition, so M1 starts from a
concrete spec instead of being figured out as it goes, the same way M0 was.

M1 delivers `packages/render/` — a framework-free Canvas2D glyph-grid
renderer with a WebGL2 CRT post-FX layer — that consumes a `@vimorror/core`
`VimEngine` and draws it. Canvas-vs-DOM is already decided (canvas, per
`MergedPlan.md`); this doc only decomposes the *how*. Nothing here touches
vim-core's engine logic, and nothing here builds app chrome, game rules, or
content — those stay M2–M6.

Two facts were verified directly against source rather than trusted from the
plan docs, since both are load-bearing for what follows:

- **JetBrains Mono licensing** — `MergedPlan.md` hedges "OFL 1.1 vs Apache-2.0
  depends on distribution." Confirmed directly against
  `github.com/JetBrains/JetBrainsMono`: the **compiled font binary is
  OFL-1.1**; Apache-2.0 covers only the font's *source*/build tooling. M1
  vendors a compiled `.woff2`, so **OFL-1.1 is the only license that
  applies** — the ambiguity is closed, not open.
- **Root `tsconfig.json` needs a `lib` change** to add `DOM`/`DOM.Iterable`
  (currently `ES2022` only, inherited from `tsconfig.base.json`), because
  root `typecheck` globs all of `packages/**/*.ts` into one flat compile and
  render's canvas/WebGL/FontFace types don't exist without it. Verified
  empirically: compiling the current tree with `--lib
  ES2022,DOM,DOM.Iterable --types node` added — exit 0, zero new errors, no
  naming collisions between vim-core's own types and DOM globals.
  `tsconfig.base.json` itself stays DOM-free on purpose, preserving
  vim-core's "zero DOM" invariant at the type level for anyone who scopes a
  build to just that package.

## Package scaffolding

- **`packages/render/package.json`** — mirrors `vim-core`'s minimal shape
  (`private`, `type: module`, `exports: {".": "./src/index.ts"}`, a
  `typecheck` script), plus render's first real cross-package dependency:
  `"@vimorror/core": "workspace:*"`. Zero external runtime deps — Canvas2D
  and WebGL2 are browser-native, no library needed for either.
- **`packages/render/tsconfig.json`** — extends `tsconfig.base.json`, adds
  `lib: ["ES2022", "DOM", "DOM.Iterable"]` locally (this package's own scoped
  typecheck), includes `src/**/*.ts` and `demo/**/*.ts`.
- **Root `tsconfig.json`** — add `"DOM", "DOM.Iterable"` to
  `compilerOptions.lib` (verified safe above). This is the one place the plan
  touches shared infrastructure rather than being purely additive to
  `packages/render/`.
- **Root `package.json`** — add `vite` (`^6.0.0`) to `devDependencies` and
  one script: `"dev:render": "vite --root packages/render/demo --port
  5175"`. (`5173`/`5174` are already reserved for M4/M3 per
  `MergedPlan.md`'s verification table.) No `vite.config.ts` — CLI flags are
  enough for a dev-only demo server with no plugins.
- No changes needed to `pnpm-workspace.yaml` (`packages/*` already covers it)
  or `vitest.config.ts` (existing `packages/**/*.test.ts` glob covers
  render's tests; every unit-tested module in render is DOM-free by
  construction, so the current `environment: 'node'` stays sufficient — no
  jsdom).

## File breakdown — `packages/render/src/`

Pure/DOM-free (unit tested under plain vitest, no new test infra) —
`types.ts`, `cell-buffer.ts`, `camera.ts`, `cursor-shape.ts`, and
`font-atlas.ts`'s UV-math half. Impure (canvas/WebGL, manual/visual
verification only) — everything else.

- **`types.ts`** — `Cell = { char, fg, bg, glitch?: number }` row-major
  `CellBuffer`; `Camera = { topline, height, width }`; `CursorShape` union;
  `Rect` for atlas UV math. `Camera`'s `{topline, height}` shape is exactly
  what `docs/CHECKLIST.md` already specifies as the input Vim's `H`/`M`/`L`
  motions need — finalized here, in the very first file, before any canvas
  code exists (see "H/M/L" below).
- **`cell-buffer.ts`** — `createCellBuffer`, `linesToCells(lines, fg, bg)`
  (turns raw `VimEngine.lines` into a monochrome grid), and
  `diffCells(prev, next)` — the dirty-cell scan that makes redraw only touch
  changed cells. Deliberately mutable-friendly, not immutable like
  vim-core's style — this runs once per frame over ~4,000 cells with no
  undo/replay consumer, so structural-copy immutability would just be
  wasted allocation.
- **`camera.ts`** — `followCursor(camera, cursorLine)` (scrolls `topline` the
  minimum amount to keep the cursor visible; takes no buffer-length
  parameter, since scrolling past EOF is always allowed — like real Vim's
  tilde lines — so there is nothing to clamp against) and
  `bufferPosToScreen(camera, pos)`. Caller-driven, not auto-scrolling — the renderer never decides
  scroll policy on its own.
- **`cursor-shape.ts`** — `Record<Mode, CursorShape>` keyed off vim-core's
  actual 8-variant `Mode` union, so TypeScript enforces exhaustiveness if a
  9th mode is ever added. Proposed mapping: normal/operator-pending →
  block, insert/command-line → bar, replace → underline,
  visual/visual-line/visual-block → hollow-block. Low-stakes, trivially
  adjustable later.
- **`font-atlas.ts`** — pure half: `atlasRectFor(charCode, cellW, cellH,
  atlasCols)`, index math, unit tested. Impure half: `bakeFontAtlas()` loads
  the vendored `.woff2` via `FontFace`, renders printable ASCII (0x20–0x7E,
  95 glyphs — no accents, no box-drawing, no bold/italic until content
  needs them) into an `OffscreenCanvas`.
- **`glyph-grid.ts`** — owns a `<canvas>` + 2D context and the previous
  frame's `CellBuffer`; `render(next, atlas, cursor)` diffs and blits only
  changed cells from the atlas, then draws the cursor overlay. No concept
  of "selection" or "highlight" — that's just the caller setting
  `Cell.fg`/`bg`/`glitch` per frame.
- **`crt-shader.ts`** — one WebGL2 fragment shader (curvature, chromatic
  aberration, phosphor persistence, glitch) driven by
  `u_time`/`u_intensity`/`u_resolution` uniforms, fullscreen-triangle trick
  (no VBO boilerplate). Phosphor persistence needs a 2-texture ping-pong
  (this frame's glyph-grid output + an accumulator of the previous frame) —
  the one real wrinkle in an otherwise single-pass design.
- **`canvas-fallback.ts`** — when `getContext('webgl2')` is null, just blits
  the glyph-grid canvas straight through, no 2D approximation of the
  effects. Legitimate scope boundary: the CRT look is decorative, fully
  separate from the game's own narrative glitches (which are `Cell` content
  changes from M2's director and render identically either path).
- **`pipeline.ts`** — the public façade: `createRenderer(canvas, { atlas,
  forceFallback? })` picks WebGL2 vs. fallback; `Renderer.draw({ cells,
  camera, cursor: {pos, mode}, effectsIntensity })` clips via `camera.ts`,
  derives cursor shape, drives `glyph-grid.ts` + the chosen post-fx path;
  plus `resize()`/`dispose()`. This is render's `engine.ts`-equivalent.
- **`index.ts`** — flat re-export of the above, mirroring vim-core's
  `index.ts` pattern.

`effectsIntensity` is a plain 0–1 parameter on `draw()`, never a hidden
default — the "wired from day one" knob `MergedPlan.md` requires. M1 ships
the parameter end-to-end to the shader uniform; it does **not** decide
default values, `prefers-reduced-motion` policy, or build the actual UI
slider widget — that's M4's comfort-settings layer.

## Licensing — JetBrains Mono (verified above)

1. Vendor **one weight** (Regular only) as
   `packages/render/assets/fonts/JetBrainsMono-Regular.woff2`, pinned from a
   specific tagged GitHub release (not `master` HEAD — same reproducibility
   discipline as the committed goldens), plus `OFL.txt` copied alongside it.
2. A one-line source comment in `font-atlas.ts` citing the release tag and
   license.
3. No npm font package — a vendored static file is strictly less than what
   e.g. `@fontsource/jetbrains-mono` would pull in for a full `@font-face`
   weight family we don't need.

## Build order

1. **Wave A — pure data layer.** Package scaffolding, `types.ts`,
   `cell-buffer.ts`, `camera.ts`, `cursor-shape.ts` + their tests. Done when
   `pnpm typecheck`/`pnpm test` are green with zero canvas/DOM code in the
   tree yet. `Camera`'s shape is locked here.
2. **Wave B — font.** Vendor the font + license file; `font-atlas.ts` pure
   half + test, then `bakeFontAtlas`. Done when the UV-math test passes and
   a one-off visual dump shows a correctly laid-out glyph sheet.
3. **Wave C — the glyph grid.** `glyph-grid.ts` + `demo/{index.html,main.ts}`
   (wires a real `VimEngine`, includes a demo-only `KeyboardEvent →
   KeyToken` translator — not real input handling, which is M4's job). Done
   when `pnpm dev:render` shows a live, keyboard-driven grid with dirty-cell
   redraw and correct cursor shape across all 8 modes.
4. **Wave D — CRT post-FX + the knob.** `crt-shader.ts`,
   `canvas-fallback.ts`, `pipeline.ts`. Demo gains an intensity slider +
   forced-fallback toggle. Done when intensity=0 on WebGL2 visually ≈ the
   fallback, intensity=1 shows visible curvature/aberration/phosphor/glitch,
   and the fallback path never throws.
5. **Wave E — wrap-up.** `index.ts` finalized; confirm root `pnpm
   typecheck`/`pnpm test` still green repo-wide (proves the root `lib`
   change didn't regress vim-core).

## Verification

`packages/render/demo/` (inside the package, not a new top-level app —
`apps/` stays reserved for M3/M4). `pnpm dev:render` → `localhost:5175`. The
demo: bakes the atlas once, drives a real `VimEngine`, redraws each
keystroke, and exposes plain-HTML controls — an intensity slider, a
forced-fallback toggle (both renderers side by side), a readout of
`engine.mode`/`engine.pending`, and canned buttons that `feedKeys()`
scripted sequences (`d2w`, `ci(`) for repeatable spot-checks.

Actual check: run `pnpm dev:render`, open it via the browser tool, screenshot
each of the 8 cursor shapes and intensity at 0/50/100/fallback-forced, zoom
into a few cells to confirm no atlas bleed — following this repo's own root
convention of using the feature in a browser before calling frontend work
done.

## Testing

- **Real vitest unit tests** (co-located `src/*.test.ts`, matching
  vim-core's convention): `cell-buffer.test.ts` (diff on
  identical/single-cell/full-buffer changes), `camera.test.ts`
  (scroll-minimum, short-buffer, topline floor/ceiling),
  `cursor-shape.test.ts` (pins the 8-mode table), `font-atlas.test.ts` (UV
  math + column-wrap boundary).
- **Manual/visual only, honestly not stubbed:** `glyph-grid.ts`,
  `crt-shader.ts`, `bakeFontAtlas`, `canvas-fallback.ts`, `pipeline.ts`. No
  jsdom, no canvas-mock package, no headless-gl — that's new, heavy infra
  this milestone doesn't warrant; the demo + browser screenshot check is the
  proportionate verification.

## `H`/`M`/`L` — recommendation: not part of M1

`docs/CHECKLIST.md` already fully specifies what these motions need: a
`{topline, height}` parameter, viewport-free by design in vim-core. That
shape is finalized in Wave A, day one, before any canvas/WebGL exists — so
the real dependency ("one type shape exists") clears almost immediately, and
implementing the motions themselves is pure `vim-core` grammar work (a
scratch-probe against real Vim for the boundary semantics, a `motions.ts`
addition, a new golden family) that touches zero files under
`packages/render/` and exercises none of M1's actual new capabilities.
Bundling it into M1 would dilute the plan for no real gain. Tracked as a
small, independent, ungated `vim-core` task — pick it up any time after Wave
A locks the shape, whenever `vim-core` is next touched.

## "M1 done when"

1. `pnpm typecheck`/`pnpm test` green repo-wide, including the four new
   vitest suites, zero new test infrastructure.
2. JetBrains Mono OFL-1.1 licensing vendored correctly (font + `OFL.txt`,
   version-pinned, cited).
3. `pnpm dev:render` serves a live demo rendering a real `VimEngine` through
   the Canvas2D glyph grid with dirty-cell redraw, correct cursor shapes
   across all 8 modes, and a working WebGL2 CRT pipeline (+ canvas fallback)
   driven by the Effects Intensity control — confirmed via browser
   screenshots.
4. `@vimorror/render`'s public API is stable, `Camera`'s `{topline, height}`
   shape needs no further changes for `H`/`M`/`L` to consume later (tracked
   separately, not gating this milestone).
5. Nothing changed outside `packages/render/` except the two root fixes
   required to unblock it (`tsconfig.json` `lib`, `package.json`
   devDependency + script).

**Explicitly NOT in M1:** Zod stage schema/entities/difficulty/hints/scoring
/Gentle Mode (M2); the stage editor (M3); the real title screen, actual
slider UI widget, save system, audio, Playwright E2E (M4); story/curriculum
content (M5/M6); React; Zustand; horizontal-scroll camera tracking; a
reduced-motion/comfort default policy; `H`/`M`/`L` itself (tracked
separately, above).

## Open judgment calls, low-stakes

- Cursor-shape-per-mode mapping and the CRT intensity-scaling curve are
  concrete-but-low-stakes choices made to keep the plan executable — both
  trivially adjustable later, neither architecturally load-bearing.

## Critical files

- `packages/render/package.json`, `packages/render/tsconfig.json`
- `packages/render/src/types.ts`, `camera.ts`, `cursor-shape.ts`,
  `cell-buffer.ts`, `font-atlas.ts`, `glyph-grid.ts`, `crt-shader.ts`,
  `canvas-fallback.ts`, `pipeline.ts`, `index.ts`
- `packages/render/demo/index.html`, `demo/main.ts`
- `packages/render/assets/fonts/JetBrainsMono-Regular.woff2`, `OFL.txt`
- `tsconfig.json` (root — `lib` addition), `package.json` (root — `vite`
  devDependency + `dev:render` script)
