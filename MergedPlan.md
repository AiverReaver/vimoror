# VIMORROR — Merged Build Plan

*Merged from `PlanA.md` and `PlanB.md`. Both source documents are left untouched, so the provenance of every decision below stays checkable.*

## Context

Two plans were written for the same product — a browser game that teaches real Vim through play, in the spirit of vim-adventures.com, wrapped in an original psychological-horror story about escaping your own doubts. They were written to different scopes and disagreed in two places. This document merges them and records why each choice was taken.

**The shared bet, stated once:** the game world *is* a text buffer and the player *is* the cursor. Walls, threats and story are characters in that buffer. This is why one engine serves both maze-style navigation and editor-style puzzles, and why the horror is mechanical rather than decorative — when the buffer edits itself behind your back, that is simultaneously a scare and a Vim lesson.

---

## Scope

This document is a build plan, not a spec. It is deliberately uneven in depth: **M0 is execution-ready and everything after it is sequenced but not decomposed.** That asymmetry is the point — M0 is the only milestone anyone can start from today, and detailing M4 before the interpreter exists would be guessing.

| Section | Depth | Buildable? |
|---|---|---|
| Conflict resolutions between the source plans | Decided, with rationale | n/a |
| Difficulty (`:set magic`) + comfort settings | Fully specified | Consumed at M2/M4 |
| Technology choices and rejections | Decided, with rationale | n/a |
| Repository layout | Fully specified | Yes |
| **M0 — interpreter + golden harness** | **File-by-file breakdown, engine API, four build waves, harness recipe with its five known failure modes, explicit done-line** | **Yes — start here** |
| M1–M6 — render, game layer, editor, content | Deliverable + the key decision each milestone owns; not decomposed into tasks | Not yet — each needs its own plan |
| Curriculum (13 stages / 6 acts) | Fully specified as a table | Authored at M5–M6 |
| Story beats, horror escalation, guardrails | Design constraints on the engine and on content | Authored at M5–M6 |
| Licensing constraints | Decided | Binds content authoring from day one |
| Verification commands | Per milestone | M0's are runnable first |

**Out of scope for this document:** ranking the two source plans, task-level decomposition of M1–M6, and any backend concern (leaderboards, accounts, sync) — v1 is entirely client-side.

---

## What the merge resolves

| Conflict | Plan A | Plan B | Resolution |
|---|---|---|---|
| First deliverable | Engine **+ stage editor** | Engine **only**, rendering/story/UI explicitly excluded | **B's boundary, A's argument.** M0 ships the interpreter and nothing else, with B's "explicitly NOT in this milestone" list intact. The editor lands at M3 — before any content is hand-authored, preserving A's factory-before-product logic. |
| Horror tone | Restrained dread, "no content warnings needed" | Bold fourth-wall breaks + content note + Gentle Mode | **Escalating.** Acts I–III restrained and mechanical; Acts IV–VI earn the bold breaks. B's safety kit ships regardless — CRT glitch and scanlines are a photosensitivity concern independent of narrative tone. |
| Vim oracle | Neovim, headless | Vim 9.1 at `/usr/bin/vim`, prototype proven | **Vim 9.1.** Verified present on the dev machine; `nvim` is **not installed**, so A's oracle would not run today. Neovim stays an optional second oracle. |
| Engine shape | Pure reducer `step(state, key)` | Stateful `VimEngine` class with a director API | **Both.** Pure reducer is ground truth (replay, ghosts, determinism); the class is a thin stateful facade over it. Director mutations are pure functions too, so horror never breaks replay. |

Two defects in the source plans, found while merging and fixed below:

- **Plan B's story beats are numbered off its own curriculum.** Only beat 1 aligns — beat 4 is search but stage 4 is `x`/`u`; beat 7 is the undo boss but stage 7 is registers; beat 10 is `:s` but stage 10 is visual mode. Beats are re-keyed to acts and skills here, and `docs/curriculum.md` owns the single reconciled table.
- **Plan A's core has no hook for its own horror.** A pure reducer with no injection path cannot make the buffer edit itself, so A would have had to retrofit B's director API. It is designed in from M0 instead.

---

## Difficulty and comfort are two separate axes

Neither source plan says this, and conflating them is the standard mistake. **Difficulty** is how much challenge you want. **Comfort** is what your body and history can tolerate. A player may want `:set nomagic` *and* Gentle Mode. They are independent settings and never gate each other.

### Challenge — `:set magic`

Named after Vim's real regex-magic levels: authentic terminology, and "magic" carries the right charge for a haunted buffer. Set diegetically from the game's own command line.

| Level | Command | Behavior |
|---|---|---|
| Easy | `:set verymagic` | Motions clamp instead of failing (`l` at EOL, `w` past last word). Hints always visible. Unlimited undo. No keystroke budgets or timers. Threats at half speed. |
| Normal | `:set magic` | Exact Vim semantics. Hints on request (costs score). Undo limited per stage. Keystroke budget scored, not enforced. |
| Hard | `:set nomagic` | Exact semantics, nothing bends. No hints. Keystroke budget is a hard fail. Some stages run `'undolevels'=-1`. Threats at full speed. |

**Architectural invariant, non-negotiable:** difficulty never forks the engine. `vim-core` is always strict — one code path, one test surface. Difficulty is modifier config consumed only by the game layer, which may clamp a motion *before* dispatch or suppress a failure *after*, but core's semantics are invariant. This is what keeps "muscle memory transfers to real Vim" true at every level.

### Comfort — accessibility and safety

- **Effects Intensity** slider, surfaced before first play — never labelled "epilepsy safe mode," which implies a guarantee nobody can make.
- **Gentle Mode** — all mechanics and story intact; startle beats and look-away tricks disabled. Framed like Celeste's Assist Mode: no penalty, no judgmental copy.
- Separate jump-scare toggle, for players who want dread without startle.
- Never color alone — every color-coded element carries a redundant glyph or label.
- Skippable content note at first launch listing themes, plus a persistent resources link.

---

## Technology

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript strict, `noUncheckedIndexedAccess: true` | This codebase is nothing but array indexing; Vim's grammar is a typed state machine |
| Build | Vite 6 + pnpm workspaces (`tsup` for `vim-core`) | Fast HMR; monorepo so editor and game share one renderer |
| UI chrome | React 19 | Menus, dialogue, editor panels only — **never** the game grid |
| Game grid | Hand-rolled Canvas 2D glyph renderer | ~4,000 monospace cells needing per-cell color and glitch control. A ~400-line dirty-cell renderer with an offscreen font atlas is smaller and faster than any engine's tilemap, and doesn't fight us |
| Post-FX | WebGL2 single-pass shader, canvas fallback | CRT curvature, chromatic aberration, phosphor persistence, glitch |
| State | Zustand | Small, works outside React for the game loop |
| Schema | Zod | Stages are data; untrusted content must validate |
| Audio | Raw WebAudio | Procedural drones need precise scheduling; no dependency earns its weight |
| Save | `localStorage` with in-payload `schemaVersion` | No backend in v1 |
| Tests | Vitest + fast-check + Playwright | Unit, property, keystroke-replay E2E |
| Font | JetBrains Mono, subset, baked to atlas | Permissively licensed, strong box-drawing coverage |

**No game engine** (Phaser / PixiJS / Excalibur / rot.js). They sell sprites, physics and tilemaps; we need none of them and would inherit a display abstraction we'd fight. A correction carried forward from research: PixiJS and CodeMirror 6 cannot both be the render surface — Pixi is canvas, CM6 is DOM. Since the interpreter and the world are ours, the renderer is ours, and the only open question is canvas vs. DOM — decided at M1 against real per-cell animation requirements.

**We write our own Vim interpreter** rather than embedding `@replit/codemirror-vim` (MIT, ~14KB gz). That library is excellent and wrong-shaped here, for four permanent reasons:

1. **Key gating is the pedagogy.** Locked keys must be rejected *in fiction*, with a specific horror beat — never a silent no-op.
2. **Keystroke scoring is a core loop.** "You did that in 7 keys, par is 3" needs the full command shape (`d{count}w`), not just "a command finished."
3. **The horror requires lying about the buffer.** Phantom cursors, undo history containing edits the player never made, text that reverts when you look away. You cannot do this inside someone else's editor without forking it.
4. **Scope is bounded** — ~63 commands, not all of Vim.

The risk this creates — subtly wrong semantics — is exactly what the golden-test harness eliminates.

---

## Repository layout

Monorepo from day one (it is nearly free), with only `vim-core` and `tools/goldens` populated at M0.

```
vimorror/
├─ packages/
│  ├─ vim-core/   @vimorror/core    Vim interpreter. Zero deps, zero DOM.
│  ├─ render/     @vimorror/render  Canvas glyph grid + CRT post-FX        [M1]
│  └─ game/       @vimorror/game    Stage schema, rules, difficulty, hints [M2]
├─ apps/
│  ├─ web/        The game                                                 [M4]
│  └─ editor/     The stage editor                                         [M3]
├─ content/
│  ├─ stages/     *.json (Zod-validated)
│  └─ story/      *.md
├─ tools/
│  ├─ goldens/    gen.vim, generate.ts, cases/*.yaml, goldens/*.json
│  └─ validate-stages.ts
└─ docs/          curriculum.md, story-bible.md, stage-schema.md
```

---

# M0 — The interpreter + golden-test harness

## The golden-test harness (already de-risked)

Real Vim 9.1 is at `/usr/bin/vim` — **verified**. A prototype harness produced these results from real Vim:

| Case | Start buffer | Keys | Real Vim result |
|---|---|---|---|
| `d2w` | `alpha beta gamma delta` | `d2w` | `gamma delta`, unnamed=`alpha beta ` |
| `ci(` | `fn(a, b, c) end` @1,7 | `ci(X<Esc>` | `fn(X) end`, unnamed=`a, b, c` |
| dw EOL wart | `foo bar` @1,5 | `dw` | `foo `, **newline not eaten** |
| named reg | `keep me`/`kill me` | `"ayyjdd` | `"a`=`keep me\n`, unnamed=`kill me\n` |
| `:s///g` | `x a x a x` | `:s/x/Q/g<CR>` | `Q a Q a Q` |
| dot-repeat | `one two three four` | `dw..` | `four` |
| `f,;x` | `a,b,c,d` | `f,;x` | `a,bc,d` |

The `dw`-at-end-of-line case is the whole argument for goldens over hand-written expectations: nobody writes Vim's famous special-case wart correctly from memory.

**Mechanism:** a spec JSON (`buffer`, `cursor`, `keys`) is piped into a small `gen.vim` that sets up the buffer, runs the keys, and writes back buffer + cursor + registers as JSON.

```bash
vim -u NONE -i NONE -N -es -S gen.vim
```

**Five details earned during prototyping — do not drop any of them.** The prototype code is not on disk; only this recipe survives, so re-creating the harness is the first task of M0.

- `-i NONE` — without it Vim reads viminfo and registers leak between cases. This silently corrupted the first prototype run.
- `-u NONE -N` — no user config, but nocompatible.
- Pass control characters as **real bytes** in the JSON, not `\<Esc>` notation. The `eval()`-based unescaping approach produces literal `<Esc>` text in the buffer.
- **Known gap, fix before authoring macro goldens:** macro recording (`qa…q` then `2@a`) does not replay correctly under `:normal` — the recording lands but playback doesn't. Cases involving `q`, `@`, or `:g` must route through `feedkeys(keys, 'x')` instead of `execute 'normal '`. Fixing this after the goldens exist bakes in wrong expectations.
- Vim reports 1-based **byte** columns; the engine uses 0-based **character** indices internally and converts only in the comparator. `mode()` is meaningless under `-es` — capture mode from our engine only, or drive an interactive Vim in a pty if mode goldens prove necessary.

Goldens are **generated locally and committed**, so CI never needs Vim installed.

## `@vimorror/core` — file breakdown

Pure reducer at the bottom: `step(state, key) → { state, events }`. No DOM, no clocks, no randomness, no I/O — which is what makes `replay(initial, keys[])` exact, and golden tests, regression tests and ghost replays all the same mechanism.

- `buffer.ts` — lines, cursor, `desiredCol` (for `j`/`k` through short lines), immutable primitive edits, position math
- `keys.ts` — `KeyEvent` → canonical token (`d`, `<Esc>`, `<C-r>`)
- `parser.ts` — the grammar state machine: `[count] ["reg] [count] operator [count] motion|textobject`. Emits `Pending | Command | Invalid(reason)`. **The `reason` field is load-bearing** — it drives both hints and in-character rejection.
- `motions/` — each returns `{ target, kind: 'charwise'|'linewise', inclusive } | null`
  - char `h l 0 ^ $ f F t T ; ,` · word `w W b B e E ge` · line `j k gg G {n}G H M L + - _` · block `{ } ( ) [[ ]] %` · search `/ ? n N * #`
- `textobjects/` — `iw aw iW aW i" a" i' a' i( a( i[ a[ i{ a{ i< a< it at ip ap`
- `operators/` — `d c y p P > < gu gU g~ =` with correct linewise/charwise and inclusive/exclusive handling
- `registers.ts` — unnamed `"`, yank `"0`, numbered `"1`–`"9` **with correct shift-on-delete**, named `"a`–`"z` / `"A`–`"Z` append, blackhole `"_`
- `undo.ts` — snapshot undo **tree**: `u`, `C-r`, `g-`, `g+`, with redo-branch invalidation (the tree is a story mechanic in Act III)
- `modes.ts` — Normal, Insert, Visual char/line/block, Replace, Operator-pending, Command-line
- `excmd.ts` — ranges, `:s` (flags + capture groups), `:g`/`:v`, `:d :m :t :norm :w :q :set`
- `macros.ts` — `q` record, `@` replay, `@@`, halt-on-error
- `marks.ts` — `m`, `` ` ``, `'`, `C-o`/`C-i`
- `engine.ts` — the `VimEngine` facade
- `events.ts` — typed event union

**The three places engines get Vim wrong, so they get tests first:**

1. Inclusive/exclusive motion boundaries — `dw` vs `de` vs `d$`, and the `dw`-at-EOL wart.
2. Numbered-register shifting on multi-line deletes.
3. Dot-repeat, the subtlest thing in the engine — it repeats the last *change*, so `f,x` repeats only the `x` while `df,` repeats the whole delete. Build it as an explicit recorded-change record, **never** by replaying raw keystrokes.

## Engine API — designed for the game that comes later

Five capabilities must exist at M0 because retrofitting any of them means rewriting the core. This is the entire reason we are not using an off-the-shelf emulator.

```ts
class VimEngine {
  feed(key: KeyToken): EngineEvent[]

  // Live mid-command state — drives the "you typed: d2w" ghost HUD.
  // Operator-pending must be a *visible* game state; its invisibility
  // is real Vim's single biggest UX problem.
  readonly pending: {
    mode: Mode
    count?: number
    register?: string
    operator?: string
    keyBuffer: KeyToken[]
  }

  // 1. Key gating — the pedagogy. Rejected keys emit KeyRejected with a
  //    reason, never a silent no-op. The game layer renders it in character.
  setKeyPolicy(policy: KeyPolicy): void

  // 2. Instrumentation — VimGolf scoring.
  //    { keys: "d2w", keystrokes: 3, shape: "d{count}w" }
  onCommandResolved(cb: (c: ResolvedCommand) => void): void

  // 3. Director API — the horror. Synthetic mutations and synthetic undo
  //    entries indistinguishable from the player's own. Namespaced so it
  //    can never be reached by accident. Each call is a pure state
  //    transition, so injected horror stays replayable and testable.
  readonly director: {
    injectEdit(edit: Edit): void
    injectUndoEntry(entry: UndoEntry): void
    rewriteRegister(name: string, value: string): void
  }

  // 4. Snapshot/restore — saves, replays, ghost runs and test fixtures
  //    all share one path.
  snapshot(): EngineSnapshot
  static restore(s: EngineSnapshot): VimEngine
}
```

Events: `ModeChanged`, `BufferChanged`, `CommandResolved`, `RegisterChanged`, `KeyRejected`, `InvalidCommand`.

The fifth requirement is **determinism**: no clocks, no randomness, no I/O inside `vim-core`. Everything spooky arrives through `director`.

## Build order — four waves

Each wave ends with green goldens for its skill family.

1. **Substrate + motions.** Buffer, key tokenizer, mode machine, cursor clamping. `hjkl`, `0 ^ $`, `gg G {n}G`, `w b e W B E ge`, `f F t T ; ,`, `%`. Counts. `x X r`, `u C-r`.
2. **The grammar** — the spine. Operator-pending as a real state; `d c y` composing with *every* Wave 1 motion; doubled operators (`dd yy cc`); `D C Y`; `gU gu g~`; `> <`; insert variants `i a I A o O R s S`. Once this is right, every later motion works with every operator for free.
3. **Memory.** Registers (with `"1`–`"9` shifting), `p P`, text objects, `.` dot-repeat, visual `v V C-v`, marks + `C-o`/`C-i`.
4. **Automation.** Macros `q @ @@` with halt-on-error, search `/ ? n N * #`, command-line mode, ranges, `:s` with `g`/`c` flags and capture groups, `:g`/`:v`.

## M0 testing

- **Goldens (primary)** — every case in `tools/goldens/cases/` replayed through our engine, diffed on buffer + cursor + registers. Target **≥400 cases**, weighted toward edges: empty lines, single-char buffers, cursor at EOL/EOF, counts that overshoot, operators on the last line, nested brackets, unmatched quotes.
- **Property tests (fast-check)** for invariants goldens cannot enumerate: `w` then `b` never lands past the start; `dd` reduces line count by exactly 1 except on a 1-line buffer; `u` after any single change restores the exact prior snapshot; any operator followed by `<Esc>` is a no-op.
- **Fuzz vs. real Vim** — random key sequences from the implemented alphabet, run through both, diffed. This is what finds the warts nobody thought to write a case for.

**M0 is done when** all four waves' goldens pass and a scripted demo drives the engine through `d2w` / `ci(` / `qa…q@a` / `:%s//g` from a JSON snapshot and back.

*Revised 2026-08-16:* the original third criterion — "the fuzz run is clean over 10k sequences" — is dropped as a one-time gate. The fuzz harness (`pnpm test:fuzz`) already found and fixed four real engine bugs in its first runs; fuzzing an unbounded input space against a live oracle is inherently open-ended, not a checkbox that stays green. It remains a permanent tool run continuously against the engine — triaging its candidate mismatches is ongoing maintenance, not an M0 blocker. Current status tracked in `docs/CHECKLIST.md`.

**Explicitly NOT in M0:** no rendering, canvas, CRT shader, audio, levels, story text, save system, or UI.

---

# M1–M6 — from interpreter to game

Sequenced, with the decision each milestone owns. Each needs its own plan before it starts.

| # | Deliverable |
|---|---|
| **M1** | `@vimorror/render`: glyph grid, camera, cursor shapes, CRT post-FX, Effects Intensity slider wired from day one. Canvas-vs-DOM decided here against real per-cell animation needs. |
| **M2** | `@vimorror/game`: Zod stage schema, rules, key gating, turn-based entities, difficulty presets, hints, scoring, Gentle Mode. |
| **M3** | **Stage editor** with solution recorder + CI validator. |
| **M4** | `apps/web` shell: title, `:set magic` selection, comfort settings, save, audio, stage runner. |
| **M5** | Act I authored end-to-end **in the editor** (Stages 1–3) — proves the whole pipeline without touching code. |
| **M6** | Acts II–VI authored; placement skill-check; free-play rooms. |

**Turn-based by default:** threats tick only when the player acts. This keeps everything deterministic and replayable — and a thing that moves only when you do is scarier than one on a timer. A handful of late stages opt into real-time.

## `apps/editor` — the stage editor (M3)

Shares `@vimorror/render` with the game, so what you author is exactly what ships.

- **Dual-pane authoring** — raw buffer text left, visual grid right, live-synced. The world is text, so text is the primary edit surface.
- **Overlay painting** — palette for spawn, goal, walls, threats, key-pickups, triggers, story beats, painted above the text layer.
- **Metadata panel** — id, act, `allowedKeys`, `teachesKeys`, par, difficulty overrides, story beat text.
- **Solution recorder — the highest-leverage feature in the whole plan.** Play the stage inside the editor; your keystrokes are captured as the stage's golden solution. One action produces the par score, the hint data, *and* a regression test.
- **Validator** — replays every golden solution headlessly through core and asserts a win using only `allowedKeys`. Runs in CI over all of `content/stages/`.
- **Playtest in place**; JSON import/export via the File System Access API.

---

# Curriculum — 13 stages in 6 acts

A researched 12-stage progression (~63 atomic skills), grouped into thematic acts. **Stage 12 is split**, because the source curriculum and its story beats disagreed about it: the search/replace mechanics stay at 12, and `:w` acceptance becomes Stage 13.

| Act | Stages | Skills | Meaning |
|---|---|---|---|
| **I — The Cold Buffer** | 1 Two Worlds · 2 Four Directions · 3 Word Power | modes, `Esc`, `i o O` · `hjkl 0 ^ $ gg G` + counts · `w b e W B E f F t T ; ,` | Learning to move at all. Something moves only when you do. |
| **II — The Deletions** | 4 First Blood · 5 The Grammar Awakens · 6 Change & Build · 7 Inventory · 8 Precision Objects | `x X r u C-r` · `d` + composition, `dd D` · `c C s S a I A R` · `y p P`, registers · text objects, `%` | What you delete leaves a hole that remembers. Registers are memories you carry — some you shouldn't paste. |
| **III — The Recursion** | 9 The Echo · 11 Automation | `.` dot-repeat · `q @ @@`, marks, `C-o C-i` | Compulsion. You record a loop; the boss plays your own loop back at you. The undo tree becomes paths not taken. |
| **IV — The Search** | 12a | `/ ? n N * #` | Rumination. A corridor where `n` goes forever. Marks are places you swore you'd return to. |
| **V — The Rewrite** | 10 Paint Mode · 12b | `v V C-v` · `:s`, ranges, `:g` `:v` | Seeing the pattern across your whole life at once — and substituting it. |
| **VI — Write and Quit** | 13 The File, Saved | buffers, `:w`, `ZZ` / `ZQ` | The ending is a real Vim choice: save and leave, or quit without saving. |

**The spine is operator + motion = action.** Shortcuts are revealed as *sugar after* the grammar lands — `x` is secretly `dl`, `D` is `d$`, `s` is `cl` — turning "that's the same rule again" into a payoff instead of more rote memorization.

**Where this beats vim-adventures:** its command list omits `c` as a formal operator, all of visual mode, `.` dot-repeat, `:s`, and `:g`. Those are our Stages 6, 10, 9 and 12 — the back half of the game is territory the competitor never enters.

**Fixing its known complaints:** subscription rental → one-time or free; puzzles that teach puzzle-solving rather than muscle memory → interleaved free-play rooms with real prose and code; forced re-unlocking that returning players called painful → a placement skill-check to skip ahead; old skills never revisited → every later stage silently requires earlier motions, since spaced repetition and interleaving beat blocked drilling for retention.

---

# Story — mechanics *are* the meaning

You wake as a cursor in a cold, corrupted buffer. The text is someone's unfinished work. The antagonist is not a monster but **the Doubt** — the unsaved self, which rewrites you as you try to rewrite it.

The creative core, which both source plans found independently: **Vim's real mechanics are already precise metaphors for the psychology of self-doubt.** `u` is regret; `C-r` is acceptance — and Vim really does destroy the redo branch the moment you edit after undoing, so dwelling forecloses return; `.` is compulsion; registers are curated memory; macros are habits; `:s/old/new/c` is rewriting your self-narrative one instance at a time rather than by blunt global replace.

Selected beats, keyed to **acts and skills, not stage numbers** — `docs/curriculum.md` owns the single reconciled table:

- **"hello, world"** (Act I, `i`) — procrastination. An empty file in darkness; idle too long and the placeholder retypes itself into something anxious. Pressing `i` reveals the level was always there, just unlit. Insert mode as the light switch.
- **"the word that isn't wrong"** (Act II, `c`) — perfectionism. The exit is only reachable by leaving several "wrong" words untouched. The level is *unsolvable* if you try to perfect everything.
- **"the undo boss"** (Act III, `u`/`C-r`) — rumination. Every `u` shows a glimpse of the version where the bad thing didn't happen, then snaps back. You win not by out-undoing it but by pressing `C-r` deliberately — choosing to accept. The boss shrinks into a companion.
- **"the macro that isn't yours"** (Act III, `q`/`@`) — habits. A macro you recorded earlier without realizing runs loose, "helpfully" repeating a harmful edit everywhere. You fix it by opening the register, reading the keystrokes, and re-recording over it. Habits are edited, not fought.
- **"someone else's handwriting"** (Act IV, `/`) — impostor syndrome. You hunt for evidence of your inadequacy in others' pristine buffers, and the closer you look the more you find they share your flaws. The exit unlocks when you search your *own* buffer and find something worth keeping.
- **"rewriting the sentence"** (Act V, `:s`) — the core self-narrative. Substitutions on the wall's sentence revert the instant you look away — until you realize *you* are the one reverting them. Resolved with the `/c` confirm flag, instance by instance. The game explicitly rejects blunt `:%s/` global positivity as false.
- **"the file, saved"** (Act VI, `:w`) — acceptance. A final boss is telegraphed and never comes; the only tension is your own hesitation to let the file be what it is. The file stays editable after the credits.

**Guardrail across every stage:** no doubt is ever killed for XP. Each resolves through integration or conscious choice — Celeste's Badeline as *part of* the self, Hellblade's agency-preserving framing, Night in the Woods' refusal to name diagnoses. No self-harm imagery; loss is represented only through abstraction — deletion, silence, a blank buffer.

**Horror technique, escalating.** Acts I–III stay restrained and mechanical: the buffer edits itself behind you and you only notice on scrollback; the status line echoes your keystrokes a beat late; glyphs decay on repeated cursor visits; one stage where `Esc` does not work and you are trapped in Insert mode — unable to *act*, only to *write* — while something approaches. Insert mode's real constraint is the scare.

Acts IV–VI earn the bold, sandbox-internal fourth-wall breaks: undo history containing edits you didn't make; a phantom second cursor compulsively editing off-screen; the Undo menu option itself flickering away at the rumination beat; flat clinical log-speak (`WARNING: 14,000 unsaved edits detected. Recommend discard.`); references to your own play stats, never real PII; the late reveal that every "different" buffer was the same file at different points in undo history.

Every one of these routes through `director.*`. Nothing in the horror layer is allowed to reach into core by another path.

`docs/story-bible.md` and `docs/curriculum.md` are written at M0 alongside the engine, so authoring has a spine before M5.

---

# Licensing

This constrains content authoring from day one:

- **Learn-Vim** (iggredible) is **CC BY-NC-SA 4.0** — copying its prose or examples would force this game to be NonCommercial *and* ShareAlike.
- **Vim's own documentation** is under the **Open Publication License** — also not free to paste.

Both are usable as **references only**. Curriculum *ordering* is an uncopyrightable idea; wording is not. So: use both to decide what to teach in what order, and write 100% of in-game text original. This costs nothing — the story is original anyway — and leaves every licensing option open. Our own license (MIT or AGPL) is chosen at M0.

Dependencies stay permissive: JetBrains Mono is OFL 1.1 / Apache-2.0 depending on distribution — confirm the exact grant at M1 before baking the atlas.

---

# Verification

Ordered by the milestone that makes each runnable.

```bash
pnpm install
```
```bash
pnpm goldens:generate    # M0 — needs local vim 9.1; regenerates committed fixtures
```
```bash
pnpm test                # M0 — goldens + property tests, must be green
```
```bash
pnpm test:fuzz           # M0 — 10k random sequences diffed against real vim
```
```bash
pnpm validate:stages     # M3 — every golden solution wins using only allowedKeys
```
```bash
pnpm dev:editor          # M3 — stage editor at localhost:5174
```
```bash
pnpm dev                 # M4 — game at localhost:5173
```

- **Golden + fuzz harness (M0)** is the single most valuable test in the project; it is what substantiates the strict-fidelity claim. Goldens are committed, so CI never needs Vim.
- **Playwright E2E (M4)**: load a stage, send a real key sequence, assert the win screen — and separately assert that on `:set nomagic` an over-budget run fails while the identical run passes on `:set verymagic`.
- **Director determinism test (M2)**: a replay containing injected edits must reproduce byte-identically from its snapshot. If horror breaks replay, the director API is wrong.
- **Manual round-trip (M3, the definition of done)**: author a brand-new stage in the editor, record its solution, export it, and confirm it loads and is completable in the game without touching code.

---

# Where to start

Re-create the golden harness from the recipe above — `gen.vim` plus `generate.ts`, with all five prototyping details honored — and get the seven proven cases green against a stub engine before writing Wave 1. Everything else in M0 depends on that harness being trustworthy first.
