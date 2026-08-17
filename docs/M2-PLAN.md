# M2 — `@vimorror/game` build plan

`MergedPlan.md` and `docs/CHECKLIST.md` both leave M2 as an undecomposed bullet
list and say every milestone after M0 "needs its own plan before it starts."
This doc is that decomposition, the same way `docs/M1-PLAN.md` was for M1.

M2 delivers `packages/game/` — a framework-free rules layer that turns a
`@vimorror/core` `VimEngine` into a playable stage: a Zod-validated stage
schema, key gating rendered in character, turn-based entities, difficulty as
pure modifier config, hints, scoring, and Gentle Mode. Nothing here renders
(that's M1's package, already done), builds app chrome or the editor (M3/M4),
or authors content (M5/M6).

## Four facts verified against source, not trusted from the plan docs

Each of these changes what M2 has to build, and three of them are not visible
anywhere in the existing bullets.

### 1. `EngineSnapshot` is missing 8 of the 11 things replay depends on

**This is the big one, because "director determinism" is M2's own done-line.**
`MergedPlan.md` states it as: *a replay containing injected edits must
reproduce byte-identically from its snapshot. If horror breaks replay, the
director API is wrong.*

Measured directly — build history, snapshot, restore, then run the key that
consumes that history, and diff live vs. restored:

| capability | before save | after restore | result |
|---|---|---|---|
| undo tree | `dw` | `u` | **DIVERGES** |
| redo | `dwu` | `<C-r>` | **DIVERGES** |
| dot record | `dw` | `.` | **DIVERGES** |
| marks | `majj` | `` d`a `` | **DIVERGES** |
| macros | `qaxq` | `@a` | **DIVERGES** |
| jumplist | `G` | `<C-o>` | **DIVERGES** |
| `lastFind` | `fa` | `;` | **DIVERGES** |
| key policy | `setKeyPolicy` | denied key | **DIVERGES** |
| search state | `/line<CR>` | `n` | ok |
| registers | `yw` | `"0p` | ok |
| injected undo entry | `injectUndoEntry` | `u` | ok |

**The director API is not the problem — `EngineSnapshot` is.** Injected edits
replay perfectly (measured separately: `injectEdit` mid-script reproduces
byte-identically, because every director mutation really is a pure state
transition, exactly as designed). What breaks replay is that `snapshot()`
serializes only lines/cursor/desiredCol/mode/registers/search/options.
`docs/HANDOFF.md` and three separate `CHECKLIST.md` entries already flag this
as deliberately deferred, each pointing at "revisit before the demo done-line."
That revisit is now: M2 cannot state its own done-line without it.

The `key policy` row deserves its own note, because it is not a horror concern
at all — it is a **gameplay correctness bug reachable by any player who
reloads**. `setKeyPolicy` is stage configuration, `snapshot()` doesn't carry
it, so a restored mid-stage save silently runs keys the stage locked. Key
gating is the pedagogy; it must not evaporate on reload.

**So M2 owns one `vim-core` change**, exactly as M1 owned the root
`tsconfig.json` `lib` addition: extend `EngineSnapshot` to carry undo tree,
dot record, marks, jumplist, `lastFind`, macros and `keyPolicy`, and make
`restore()` rebuild them. This is additive to a package with 1244 green tests
behind it — the existing corpus is the regression net, and every field added
is a field `restore()` currently drops on the floor, so nothing that passes
today can start failing.

### 2. `onCommandResolved` never fires for a single-keystroke command

Measured, feeding each sequence to a fresh engine with a listener attached:

| keys | events | keys | events |
|---|---|---|---|
| `x` | **0** | `dw` | 1 — `dw`, 2 keystrokes |
| `j` | **0** | `d2w` | 1 — `d{count}w`, 3 |
| `u` | **0** | `3x` | 1 — `{count}x`, 2 |
| `.` | **0** | `ci(` | 1 — `ci(`, 3 |
| `iab<Esc>` | **0** | `:d<CR>` | 1 |

`engine.ts:89` fires only when the pending buffer *empties having held
something* — and a one-key command's buffer was never non-empty. The comment
there states this as intentional ("that is the unit keystroke scoring
counts"), but it breaks both features M2 builds on top of it:

- **Scoring.** "You did that in 7 keys, par is 3" would silently undercount
  every `x`, `j`, `u`, `.`, and every insert session. A stage solved with
  `xxx` scores **zero** keystrokes.
- **Turn-based entities.** "Threats tick only when the player acts" is Act I's
  entire mechanic ("something moves only when you do") — and Act I's stages
  are pure `hjkl` navigation, which fires no events at all. Threats would
  stand still for the whole act.

M2 owns the decision. The recommendation is to fix it in `vim-core` alongside
the snapshot work rather than counting keystrokes independently in the game
layer: `shape` is the documented scoring unit, and a second keystroke counter
in `game` would be a parallel implementation of something core already almost
does — the exact "drift between two implementations" trap `dot.ts` was
designed to avoid. Wave A pins the intended table as tests **first**, since
this is a behavior change to a package whose whole value is that its behavior
is pinned.

### 3. Zero scaffolding exists — `packages/game/`, `apps/`, `content/` are all absent

`pnpm-workspace.yaml` already globs `packages/*` **and `apps/*`**, so the
workspace needs no edit. `vitest.config.ts`'s `packages/**/*.test.ts` glob
already covers game's tests, and `environment: 'node'` stays correct — every
module in `game` is DOM-free by construction, same as `vim-core`.

### 4. Zod is not installed, and that is fine

`game` is where the repo's dependency policy first has to be stated precisely,
because the invariant is narrower than it looks: **"zero runtime dependencies"
binds `vim-core` only** (`CHECKLIST.md`'s invariant reads "zero runtime
dependencies, zero DOM in `vim-core`"). `MergedPlan.md` picks Zod for stages
deliberately — "stages are data; untrusted content must validate" — and stage
JSON authored in M3's editor and loaded at runtime is genuinely untrusted
input. Zod is `@vimorror/game`'s one runtime dependency. `vim-core` stays at
zero, and this plan does not add a dependency to it.

## Package scaffolding

- **`packages/game/package.json`** — mirrors `render`'s shape (`private`,
  `type: module`, `exports: {".": "./src/index.ts"}`, a `typecheck` script),
  `"@vimorror/core": "workspace:*"`, plus `"zod": "^3.24.0"`. No dependency on
  `@vimorror/render` — the rules layer must not know how anything is drawn,
  which is what lets M3's editor and M4's app compose them independently.
- **`packages/game/tsconfig.json`** — extends `tsconfig.base.json`, no `lib`
  override (game is DOM-free; it does not need M1's `DOM` addition), includes
  `src/**/*.ts`, excludes `src/**/*.test.ts`.
- **Root `package.json`** — add `zod` to the workspace via `packages/game`
  only. One new script: `"validate:stages": "node tools/validate-stages.ts"`,
  which `MergedPlan.md`'s verification table already names — the *validator
  binary* is M3's, but the schema it validates against is M2's, so the script
  lands here pointing at a tool that starts as a thin schema-check and gains
  solution replay at M3.
- **`content/stages/`** — created with a handful of fixture stages authored by
  hand as JSON (not the editor, which is M3). These are test fixtures that
  double as the first real content, and they are what proves the schema is
  authorable by a human before an editor exists to hide its ergonomics.

## File breakdown — `packages/game/src/`

Everything here is pure and unit-testable — no DOM, no canvas, no clocks. That
is not an aspiration; it is forced by the determinism invariant, since the
whole layer sits between a deterministic engine and a replay test.

- **`schema.ts`** — the Zod stage schema and its inferred TypeScript types.
  Buffer text, entity overlay, `allowedKeys`, `teachesKeys`, `par`, win/lose
  conditions, triggers, story beats, per-stage difficulty overrides. Exports
  `parseStage(unknown): Stage` (throws with a readable path) and
  `safeParseStage`. **This file is the contract M3's editor writes against and
  M5/M6 author against** — it is the highest-consequence file in the
  milestone, and the reason `content/stages/` gets hand-authored fixtures in
  the same wave.
- **`entities.ts`** — the entity overlay: what sits above the text layer
  (spawn, goal, walls, threats, pickups, triggers, beats), and how an entity
  occupies buffer positions. Pure position math over `Pos`, reusing core's own
  type rather than inventing a parallel one.
- **`tick.ts`** — the turn-based clock. **Threats tick only when the player
  acts**, which per finding 2 cannot be `onCommandResolved` alone. Owns the
  definition of "an act": which keystrokes advance the world, whether a
  rejected key does (it must not — otherwise a locked key still kills you,
  which is a punishment for exploring), and whether an insert session is one
  tick or one per character.
- **`rules.ts`** — win/lose evaluation against a stage's conditions, run after
  each tick. Pure `(stage, engineState, entities) => Outcome`.
- **`gating.ts`** — turns a stage's `allowedKeys`/`teachesKeys` into the
  `KeyPolicy` core already accepts, and maps a `KeyRejected` event's
  `InvalidReason` to an in-character line. Core's `InvalidReason` union is
  already 16 members wide and documented as load-bearing for exactly this;
  `gating.ts` is where it earns that, with a total map so a 17th reason added
  later is a type error rather than a silent generic message.
- **`difficulty.ts`** — `verymagic`/`magic`/`nomagic` as pure modifier config.
  **The invariant to not break: difficulty never forks the engine.** This file
  may clamp a motion *before* dispatch or suppress a failure *after*, and may
  never branch inside core. One code path, one test surface — this is what
  keeps "muscle memory transfers to real Vim" true at every level.
- **`hints.ts`** — diffs live state against the golden-solution prefix. Depends
  on a stage carrying a recorded solution, which M3's recorder produces; at M2
  the fixtures carry hand-written ones.
- **`scoring.ts`** — keystrokes vs. par, plus the "clean run" flag (no undo, no
  hints). Consumes the `ResolvedCommand` stream that finding 2 fixes.
- **`gentle.ts`** — Gentle Mode and the separate jump-scare toggle. All
  mechanics and story intact; startle beats and look-away tricks disabled.
  Framed like Celeste's Assist Mode — no penalty, no judgmental copy, which is
  a constraint on the *data* (a beat declares itself startling) rather than a
  switch buried in a renderer.
- **`session.ts`** — the façade, `game`'s `pipeline.ts`-equivalent: owns a
  `VimEngine` plus a stage, feeds keys through gating, ticks entities,
  evaluates rules, tracks score, and emits a typed event stream for M4 to
  render. This is the only stateful file in the package.
- **`index.ts`** — flat re-export, mirroring `vim-core`'s and `render`'s. Per
  M1 Wave E's lesson, `session.ts`'s own tests consume the barrel so it cannot
  go stale unnoticed.

## Build order

1. **Wave A — the `vim-core` debt M2 rests on.** Findings 1 and 2, in
   `vim-core`, before any `packages/game/` file exists: extend
   `EngineSnapshot` (undo tree, dot record, marks, jumplist, `lastFind`,
   macros, `keyPolicy`) and settle `CommandResolved` for single-key commands.
   Test-first, since both are behavior changes to a pinned package. Done when
   the divergence table above reads OK on every row and the existing 1244
   tests are still green.
2. **Wave B — the schema.** `schema.ts` + `entities.ts` + hand-authored
   `content/stages/` fixtures + `validate:stages`. Done when a human can
   author a stage as JSON and get a precise error for every way of getting it
   wrong.
3. **Wave C — the loop.** `tick.ts`, `rules.ts`, `gating.ts`, `session.ts`.
   Done when a fixture stage is winnable and losable head-lessly through
   `session.feedKeys(...)`, with a locked key rejected in character.
4. **Wave D — the dials.** `difficulty.ts`, `hints.ts`, `scoring.ts`,
   `gentle.ts`. Done when the identical solution scores differently across the
   three difficulties and the clean-run flag survives a hint request breaking
   it.
5. **Wave E — wrap-up.** `index.ts`, the director-determinism test, repo-wide
   green.

## Testing

Real vitest suites, co-located `src/*.test.ts`, matching both existing
packages' convention. No new test infrastructure — every module is pure.

**The director determinism test is the milestone's keystone**, and per finding
1 it is currently unwritable. Its shape: a scripted session mixing player keys
with `director.*` injections, snapshotted mid-run, restored, replayed, and
diffed byte-for-byte — including the undo tree, marks and macros the restore
now carries. The divergence table above becomes its parameter list.

Property tests (fast-check is already wired) for the invariants a fixture
corpus cannot enumerate: a stage winnable with `allowedKeys` stays winnable at
every difficulty; Gentle Mode never changes the buffer, only which beats fire;
a rejected key never advances the tick.

## "M2 done when"

1. `pnpm typecheck`/`pnpm test` green repo-wide, including the new suites.
2. The **director determinism test passes** — a replay containing injected
   edits reproduces byte-identically from its snapshot, with undo tree, marks,
   macros and key policy surviving the round trip.
3. A hand-authored fixture stage in `content/stages/` validates, plays,
   wins, loses, gates keys in character, and scores against par — head-lessly,
   with no renderer and no app.
4. Difficulty is provably modifier-only: the same stage runs on all three
   presets with **zero branches inside `vim-core`**.
5. Gentle Mode and the jump-scare toggle disable startle beats with all
   mechanics and story intact.
6. Nothing changed outside `packages/game/` and `content/` except the Wave A
   `vim-core` debt (findings 1 and 2), which this plan states as owned.

**Explicitly NOT in M2:** the stage editor and solution recorder (M3); the
title screen, comfort-settings UI, save system, audio, Playwright E2E (M4);
story or curriculum content beyond test fixtures (M5/M6); React; Zustand; any
rendering.

## Open judgment calls

- **What counts as one "act" for the tick** (finding 2) — per keystroke, per
  resolved command, or per buffer change. Wave C decides it against a real
  fixture stage rather than in the abstract; it is the one choice here that
  changes how the game *feels*, and it is cheap to change in one pure file.
- Whether hints live in the stage data or are derived entirely from the
  recorded solution. Deferred to Wave D, when M3's recorder shape is closer.

## Critical files

- `packages/game/package.json`, `packages/game/tsconfig.json`
- `packages/game/src/schema.ts`, `entities.ts`, `tick.ts`, `rules.ts`,
  `gating.ts`, `difficulty.ts`, `hints.ts`, `scoring.ts`, `gentle.ts`,
  `session.ts`, `index.ts`
- `packages/vim-core/src/engine.ts` (Wave A — `EngineSnapshot`,
  `CommandResolved`), and the state modules it must now serialize
- `content/stages/*.json`, `tools/validate-stages.ts`
- Root `package.json` (`validate:stages` script)
