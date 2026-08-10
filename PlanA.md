# VIMORROR — Build Plan

## Context

`/Users/ashishvagish/Documents/vimorror` is empty. We are building a browser game that teaches real Vim through play, in the spirit of [VIM Adventures](https://vim-adventures.com/), but with an original horror story about escaping your own doubts.

The central design bet: **the game world literally is a text buffer, and the player literally is the cursor.** Walls, enemies, and story are all characters in a buffer. This makes one engine serve both maze-style navigation stages and editor-style puzzle stages, and it makes the horror mechanical rather than decorative — when the buffer edits itself behind your back, that is both a scare and a Vim lesson.

Decisions taken (from user):
- **First deliverable: engine + stage editor.** Content scales after the tooling exists. VIM Adventures took years; we build the factory before the product.
- **Terminal/CRT horror aesthetic.** Monospace glyph grid, phosphor, scanlines, glitch. No sprite art pipeline.
- **Vim fidelity is a difficulty setting**, not a fixed choice — all three levels ship, with Vim-flavored names.
- **Restrained psychological dread.** Unease from mechanics, arc toward agency. No content warnings needed.

---

## Difficulty: `:set magic`

Named after Vim's real regex-magic levels — escalating strictness, authentic terminology, and "magic" carries the right horror charge for a haunted buffer. Set diegetically from the game's own command line.

| Level | Command | Behavior |
|---|---|---|
| Easy | `:set verymagic` | Motions clamp instead of failing (`l` at EOL, `w` past last word). Hints always visible. Unlimited undo. No keystroke budgets, no timers. Threats move at half speed. |
| Normal | `:set magic` | Exact Vim semantics. Hints on request (costs score). Undo limited per stage. Keystroke budget is scored, not enforced. |
| Hard | `:set nomagic` | Exact semantics, nothing bends. No hints. Keystroke budget is a hard fail. Some stages run `'undolevels'=-1`. Threats at full speed. |

**Critical architectural rule: difficulty never forks the engine.** `@vimorror/core` is always strict — one code path, one test surface. Difficulty is a modifier config consumed only by the game layer, which wraps core: it may clamp a motion *before* dispatch or suppress a failure *after*, but core's semantics are invariant. This is what keeps "muscle memory transfers to real Vim" true at every level.

---

## Technology

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) | Vim's grammar is a typed state machine; types carry real weight here |
| Build | Vite 6 + pnpm workspaces | Fast HMR; monorepo so editor and game share renderer |
| UI chrome | React 19 | Menus, dialogue, editor panels only — never the game grid |
| Game grid | **Hand-rolled Canvas 2D glyph renderer** | See below |
| Post-FX | WebGL2 single-pass shader, canvas fallback | CRT curvature, chromatic aberration, phosphor persistence, glitch |
| State | Zustand | Small, no boilerplate, works outside React for the game loop |
| Schema | Zod | Stages are data; untrusted content must validate |
| Audio | Raw WebAudio API | Horror needs precise scheduling + procedural drones; no dep needed |
| Save | `localStorage` (v1) | No backend. Leaderboards are a later, optional Cloudflare Pages + D1 addition |
| Tests | Vitest + fast-check + Playwright | Unit, property, and full keystroke-replay E2E |
| Font | JetBrains Mono (Apache-2.0), subset, baked to atlas | License-clean, excellent glyph coverage |

**No game engine (Phaser / PixiJS / Excalibur).** They sell sprites, physics, and tilemaps — we need none of it. Our world is ~4,000 monospace cells needing per-cell color and glitch control; a ~400-line dirty-cell canvas renderer with an offscreen font atlas is smaller, faster, and doesn't fight us. `rot.js` is similarly rejected: we'd use ~5% of a roguelike toolkit and inherit its display abstraction.

**We write our own Vim engine rather than embedding [`@replit/codemirror-vim`](https://github.com/replit/codemirror-vim).** That library is excellent but wrong-shaped: we need progressive key gating with diegetic rejection, *why-did-that-fail* diagnosis to drive hints, keystroke-optimality scoring in the same command language as the golden solution, and headless determinism. Owning the parser is the pedagogy — the count×operator×motion grammar is the thing being taught. We still use codemirror-vim and headless Neovim as **differential test oracles** (see Verification).

---

## Repository layout

```
vimorror/
├─ packages/
│  ├─ core/      @vimorror/core    Vim engine. Zero deps, zero DOM.
│  ├─ render/    @vimorror/render  Canvas glyph grid + CRT post-FX
│  └─ game/      @vimorror/game    Stage schema, rules, difficulty, hints
├─ apps/
│  ├─ web/       The game
│  └─ editor/    The stage editor
├─ content/
│  ├─ stages/    *.json (Zod-validated)
│  └─ story/     *.md
├─ tools/        validate-stages.ts, nvim-oracle.ts
└─ docs/         curriculum.md, story-bible.md, stage-schema.md
```

---

## `@vimorror/core` — the Vim engine

Pure reducer. `step(state, key) → { state, events }`. No DOM, no time, no randomness — so `replay(initial, keys[])` is exact, which is what makes golden solutions, regression tests, and ghost replays possible.

Key files:
- `position.ts` — `Pos {line, col}`, comparators, clamping
- `buffer.ts` — lines, cursor, `desiredCol` (for `j`/`k` through short lines), primitive edits
- `parser.ts` — the grammar state machine: `[count] ["reg] [count] operator [count] motion|textobject`. Emits `Pending | Command | Invalid(reason)`. The `reason` field drives hints and diegetic rejection.
- `motions/` — each returns `{ target, kind: 'charwise'|'linewise', inclusive } | null`
  - char: `h l 0 ^ $ f F t T ; ,` · word: `w W b B e E ge` · line: `j k gg G H M L + - _`
  - block: `{ } ( ) [[ ]] %` · search: `/ ? n N * #`
- `textobjects.ts` — `iw aw iW aW i" a" i' a' i( a( i[ a[ i{ a{ i< a< it at ip ap`
- `operators.ts` — `d c y p P > < gu gU g~ =` with correct linewise/charwise and inclusive/exclusive handling
- `registers.ts` — unnamed `"`, yank `0`, numbered `1`-`9` **with correct shift-on-delete**, named `a`-`z`/`A`-`Z` append, blackhole `_`
- `undo.ts` — snapshot undo *tree*: `u`, `C-r`, `g-`, `g+` (the tree is a story mechanic in Act III)
- `modes.ts` — Normal, Insert, Visual char/line/block, Replace, Operator-pending, Command-line
- `excmd.ts` — ranges, `:s` (with flags), `:g`/`:v`, `:d :m :t :norm :w :q :set`
- `macros.ts` — `q` record, `@` replay, `@@`
- `marks.ts` — `m`, `` ` ``, `'`
- `session.ts` — public facade

The two places engines usually get Vim wrong, called out so they get tests first: **inclusive/exclusive motion boundaries** (`dw` vs `de` vs `d$`) and **numbered-register shifting** on multi-line deletes.

---

## `@vimorror/game`

- `stage.ts` — Zod schema: buffer text, entity overlay, `allowedKeys`, `teachesKeys`, `par`, win/lose conditions, triggers, story beats, per-stage difficulty overrides
- `gating.ts` — locked keys are rejected *in character* ("that key is not yours yet"), never silently
- `entities.ts` — **turn-based: threats tick only when the player acts.** Keeps everything deterministic and replayable — and a thing that moves only when you do is scarier than one on a timer. A handful of Act IV stages opt into real-time.
- `hints.ts` — diff live state against the golden-solution prefix, surface the next best key
- `scoring.ts` — keystrokes vs par, plus a "clean run" flag (no undo, no hints)
- `difficulty.ts` — the three `:set magic` presets as pure modifier config

---

## `apps/editor` — the stage editor (headline deliverable)

Shares `@vimorror/render` with the game, so what you author is exactly what ships.

- **Dual-pane authoring**: raw buffer text on the left, visual grid on the right, live-synced. The world is text, so text is the primary edit surface.
- **Overlay painting**: palette for spawn, goal, walls, threats, key-pickups, triggers, story beats — painted onto the grid above the text layer.
- **Metadata panel**: id, act, `allowedKeys`, `teachesKeys`, par, difficulty overrides, story beat text.
- **Solution recorder** — the highest-leverage feature. Play the stage inside the editor; your keystrokes are captured and saved as the stage's golden solution. This single action produces the par score, the hint data, *and* a regression test, for free.
- **Validator**: replays every golden solution headlessly through core and asserts a win using only `allowedKeys`. Runs in CI over all of `content/stages/`.
- **Playtest in place**; JSON import/export via File System Access API.

---

## Story — mechanics *are* the meaning

You wake as a cursor in a cold, corrupted buffer. The text is someone's unfinished work. The antagonist is not a monster but **the Doubt** — the unsaved self, which rewrites you as you try to rewrite it. Every act's Vim lesson is chosen because its real semantics carry the theme.

| Act | Teaches | Meaning |
|---|---|---|
| I — The Cold Buffer | `hjkl w b e 0 ^ $ f t` | Learning to move at all. Something moves only when you do. |
| II — The Deletions | `x d c` + text objects, registers | What you delete leaves a hole that remembers. Registers are memories you carry — some you shouldn't paste. |
| III — The Recursion | `.`, counts, macros `q @` | Compulsion. You record a loop; the boss plays your own loop back at you. The undo tree becomes paths not taken. |
| IV — The Search | `/ ? n N *`, marks | Rumination. A corridor where `n` goes forever. Marks are places you swore you'd return to. |
| V — The Rewrite | `:s`, `:g`, visual block | Seeing the pattern across your whole life at once — and substituting it. |
| VI — Write and Quit | buffers, `:w`, `ZZ` / `ZQ` | The ending is a real Vim choice: save and leave, or quit without saving. |

Mechanical horror (not jump scares): the buffer edits itself behind you and you only notice on scrollback; `u` occasionally restores something that was never there; the status line echoes your keystrokes a beat late; one stage where `Esc` does not work and you are trapped in Insert mode — unable to *act*, only to *write* — while something approaches. Insert mode's real constraint is the scare.

`docs/story-bible.md` and `docs/curriculum.md` are written first, before stage content, so authoring has a spine.

---

## Milestones

| # | Deliverable |
|---|---|
| M0 | Monorepo scaffold, CI, `docs/curriculum.md` + `docs/story-bible.md` |
| M1 | Core: buffer, parser, all motions, modes. Property tests. |
| M2 | Core: operators, text objects, registers, undo tree. Neovim oracle harness green. |
| M3 | `@vimorror/render`: glyph grid, camera, cursor shapes, CRT post-FX |
| M4 | `@vimorror/game`: stage schema, rules, gating, turn-based entities, difficulty presets |
| M5 | **Stage editor** with solution recorder + CI validator |
| M6 | `apps/web` shell: title, `:set magic` selection, save, audio, stage runner |
| M7 | Act I authored end-to-end in the editor (~6 stages) — proves the whole pipeline |
| M8 | Core: search, ex commands, macros, marks (unblocks Acts III–V authoring) |

---

## Verification

```bash
pnpm test              # Vitest unit + fast-check property tests on core
```
```bash
pnpm test:oracle       # Differential test vs headless Neovim
```
```bash
pnpm validate:stages   # Every golden solution wins using only allowedKeys
```
```bash
pnpm dev               # Game at localhost:5173
```
```bash
pnpm dev:editor        # Stage editor at localhost:5174
```

- **Neovim oracle** (`tools/nvim-oracle.ts`): feed identical keystroke sequences to `nvim --headless` and to core, dump buffer + cursor + registers, assert equality. Fuzz with generated key sequences. This is what substantiates the strict-fidelity claim; it runs in CI and is the single most valuable test we have.
- **Playwright E2E**: load a stage, send a real key sequence, assert the win screen — and separately assert that on `:set nomagic` an over-budget run fails while the same run passes on `:set verymagic`.
- **Manual**: author a brand-new stage in the editor, record its solution, export it, and confirm it loads and is completable in the game without touching code. That round-trip is the definition of M5 being done.

---

## Licensing note

Both named sources are usable as **references only, not as copy sources**:

- [Learn-Vim](https://github.com/iggredible/Learn-Vim) is **CC BY-NC-SA 4.0** — copying its prose or examples would force this game to be NonCommercial *and* ShareAlike. Curriculum *ordering* is an uncopyrightable idea; its wording is not.
- Vim's own documentation is under the **Open Publication License**, again not free to paste.

So: use both to decide *what to teach in what order*, and write 100% of in-game text original. This costs nothing (the story is original anyway) and leaves all licensing options open. Our own license choice stays free — MIT or AGPL, your call at M0.