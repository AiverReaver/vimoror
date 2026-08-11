# VIMORROR — build checklist

Derived from `MergedPlan.md`, with detail pulled from `PlanA.md` and `PlanB.md`
where the merge compressed it. This is the *tracking* document; `MergedPlan.md`
stays the authority on **why** each decision was taken and is not edited here.

Status legend: `[x]` done and verified · `[~]` in progress · `[ ]` not started

Depth is deliberately uneven, exactly as the plan is: M0 is decomposed to task
level, M1–M6 list deliverables and the decision each milestone owns. Each of
M1–M6 needs its own plan before it starts — do not treat these bullets as a
substitute for one.

---

## Invariants — true at every milestone

These are the constraints that make the rest work. Breaking one is a redesign,
not a bug fix.

- [x] **`vim-core` is always strict.** Difficulty never forks the engine — one
      code path, one test surface. Difficulty is modifier config consumed only
      by the game layer, which may clamp a motion *before* dispatch or suppress
      a failure *after*. This is what keeps "muscle memory transfers to real
      Vim" true at every level.
- [x] **Determinism.** No clocks, no randomness, no I/O inside `vim-core`.
- [x] **All horror routes through `director.*`.** Nothing in the horror layer
      may reach into core by another path, or replay breaks.
- [x] **Zero runtime dependencies, zero DOM in `vim-core`.**
- [ ] **100% original in-game text.** Learn-Vim is CC BY-NC-SA 4.0 and Vim's
      docs are Open Publication License — both are reference-only. Curriculum
      *ordering* is an uncopyrightable idea; wording is not.
- [ ] **Never colour alone** — every colour-coded element carries a redundant
      glyph or label.
- [ ] **No doubt is ever killed for XP.** Every one resolves through
      integration or conscious choice. No self-harm imagery; loss is shown only
      through abstraction — deletion, silence, a blank buffer.

---

## M0 — interpreter + golden harness

### Scaffold

- [x] pnpm workspace monorepo, Vite-ready
- [x] TypeScript strict, `noUncheckedIndexedAccess: true`
- [x] Vitest + fast-check wired
- [x] License chosen and applied — **MIT**
- [ ] CI workflow (runs `test` + `typecheck`; must NOT need Vim installed)

### Golden-test harness

- [x] `gen.vim` rebuilt from the recipe, all five prototype details honored
- [x] `generate.ts` — YAML cases → real Vim → committed `goldens/*.json`
- [x] All seven prototype-proven cases reproduce exactly, incl. the `dw` EOL wart
- [x] `proven.test.ts` pins them to values hand-transcribed from the plan, so
      the check is not circular
- [x] `pnpm goldens:verify` proves batching leaks no state between cases
- [x] Byte-column ↔ character-index conversion lives ONLY in the comparator
- [x] Per-case `:set` overrides plumbed through to the engine
- [x] Registers compared BOTH ways. Vim omits empty registers, so "absent from
      the golden" asserts empty-or-unset, and an engine register holding text
      Vim left empty is a diff. This is what catches an engine that clamps
      where Vim fails: buffer and cursor agree either way and only the stray
      register betrays it (`yank/yh-at-col1-clears-unnamed`).
- [x] **≥400 cases** — 612 committed (proven 7, wave1 113, wave2 492 across
      8 families: caseops 62, change 55, delete 79, doubled 55, indent 59,
      insert 69, shortcuts 55, yank 58)
- [ ] `expect.curswant` is captured in every golden but **not compared yet** —
      it needs virtual-column conversion plus MAXCOL handling against the
      engine's `desiredCol`. Deliberate; documented in `compare.ts`.

### Harness limitations found while building — do not lose these

- [ ] **Mode goldens are unreachable with this oracle.** `mode()` reports `n`
      even inside insert mode under `feedkeys`, not merely under `-es`. Needs a
      genuinely interactive Vim driven through a pty that *types* keys.
- [ ] **Undo-block goldens depend on author-declared boundaries.** `feedkeys`
      collapses its whole input into one undo block; feeding key-by-key fixes
      undo but silently no-ops `d2w`, `ci(`, macros and dot-repeat. Cases that
      make more than one change must use the `keys:` list form. A pty oracle
      would remove this burden — worth revisiting before Wave 3's dot-repeat.
- [ ] Decide whether a pty oracle is worth building, or whether the group form
      plus engine-side mode assertions is sufficient through M0.
- [x] **`:edit!` keeps the previous buffer's undo history.** Reloading the same
      temp file let an over-eager `u` restore the PREVIOUS case's text, which
      silently corrupted every "u with nothing to undo" golden. Fixed: `gen.vim`
      now `bwipeout!`s the buffer before each case, so undo history is
      genuinely empty.
- [x] **A failed command aborts the rest of a feedkeys batch** (macro
      semantics), where interactive Vim just carries on with the next key.
      Cases that deliberately fail a command and then press more keys must put
      the follow-up keys in a separate group — see
      `shortcuts/S-count-overshoot-last-line`.

### Engine — four waves

**Wave 1 — substrate + motions** `[x]`

- [x] Buffer, position math, `desiredCol` through short lines
- [x] Key tokenizer (independent of the harness's own notation parser, on
      purpose — one shared parser could mis-decode both sides identically)
- [x] Mode machine, cursor clamping (normal vs insert differ by one column)
- [x] `hjkl 0 ^ $`, `gg G {n}G`, `w b e W B E ge gE`, `f F t T ; ,`, `%`, `+ - _`
- [x] Counts, `x X r`, `u <C-r>`
- [x] Snapshot undo tree with redo-branch invalidation
- [x] Engine API: `pending`, `setKeyPolicy`, `onCommandResolved`, `director.*`,
      `snapshot`/`restore`

**Wave 2 — the grammar (the spine)** `[x]`

- [x] Operator-pending as a real mode, not a flag
- [x] `d c y` composing with every Wave 1 motion
- [x] Doubled operators `dd cc yy`, `guu gUU g~~`, `>> <<`, with counts
- [x] `D C Y` (`Y` is `yy`, not `y$`), `s` (= `cl`), `S` (= `cc`)
- [x] `gu gU g~`, `~`
- [x] `> <` honouring `shiftwidth`/`expandtab`/`tabstop`
- [x] Insert variants `i a I A o O R s S`, counts (`3ix<Esc>`), one undo block
      per insert session
- [x] `cw`/`cW` special case — behaves like `ce`/`cE` on a word, and changes
      exactly one character at a word end
- [x] Golden corpus authored and green — 492 cases across 8 families (delete,
      change, yank, doubled, shortcuts, caseops, indent, insert)
- [x] `pnpm goldens:verify` clean on every family (isolation proven, not assumed)
- [x] Semantics that had to be ported from Vim's C to get there — the goldens
      pin all of these, so they are safe to refactor but not to "simplify":
      - `fwd_word`'s operator mode (`eol` flag + the NUL-position walk) is the
        real mechanism behind every `dw`-near-line-end wart
      - the two exclusive-motion adjustments (`:h exclusive-linewise`) — `dw`
        on an empty line deletes the LINE; `db` from column 1 keeps the newline
      - `op_delete`'s promotion: multi-line charwise delete ending in blanks
        and starting in indent becomes linewise (`d9w` overshoot)
      - count overshoot is `cursor_down()`: fails ONLY from the last line,
        clamps everywhere else (`2dd` on last line beeps; `9dd` mid-buffer
        deletes to the end)
      - undo/redo cursor = where the change BEGAN (`uh_cursor`), which for
        doubled ops is post-`beginline` — `ddu` lands on column 1
      - `%` deletes always shift into `"1` even within one line
      - uppercase-register appends promote to linewise when either side is
      - replace-mode `<BS>` restores the overwritten characters
      - `cl`/`s` on an empty line: the motion fails but the change still
        enters insert (empty region), and no register is touched

**Wave 2 — semantics found by adversarial review, invisible to the goldens
that existed at the time** `[x]`

An adversarial review pass (three lenses, every finding refuted-or-confirmed
against real Vim 9.1) turned up 14 defects the corpus could not see. All are
fixed, and each now has a golden case or a unit test.

- [x] Replace-mode `<BS>` across an inserted `<CR>` corrupted the buffer — the
      `replaced` stack needed a `'\n'` marker meaning "rejoin", not "restore"
- [x] `ge`/`gE` took the word class at the wrong position and merged words
      across line boundaries — now a faithful `bckend_word` port whose backward
      walk passes through the virtual end-of-line position
- [x] Counted insert replayed "net typed text"; Vim replays RAW keystrokes, so
      a `<BS>` that ate pre-session text repeats too (`InsertSession.keys`).
      This also fixed counted `R` containing a `<CR>`
- [x] Replace-mode `<Tab>` consumed 8 characters; Vim consumes exactly one per
      keystroke and inserts the rest
- [x] `restore()` of a mid-insert snapshot produced a permanent zombie that
      rejected every key including `<Esc>`; it now forces normal mode, and
      `EngineSnapshot` carries `options`
- [x] Empty-region register rules: an empty-region yank still WRITES (clearing
      its registers), `C` on an empty line writes an empty `"-`+unnamed while
      keeping `"0`, and `dl`/`cl`/`s`/`D` there touch none. Goldens structurally
      cannot see this (Vim omits empty registers), so it is pinned by
      `semantics.test.ts` — plus, one way, by the symmetric comparator
- [x] `BufferChanged` events were missing for `c`/`o`/`O` and wrong for
      multi-line ops — `changedSpan()` now reports the honest dirty range.
      Not test-pinned: no event tests exist yet (M1 is the first consumer)
- [x] **Undo minting — the previous session got this one BACKWARDS and its
      three pinning cases failed on first generation.** The rule, measured with
      `undotree().seq_cur`: a command that RUNS mints an undo node even when the
      buffer ends up byte-identical, because Vim's `u_save()` happens before the
      work. Only a command that FAILS mints nothing. So `>>` on an empty line,
      `<<` with no indent, `gUU` on already-uppercase text, `~` on a digit and
      `r` typing the same character all leave a node for `u` to burn on — while
      `~` on an EMPTY line beeps and mints none. Content-comparison is NOT the
      test and must not be reintroduced into `commit()`
- [x] The empty-region corollary, which splits two cases the buffer cannot
      distinguish: `op_delete` opens with
      `if (oap->empty) return u_save_cursor()`, so a DEGENERATE region (an
      exclusive motion that could not move — `dl` on an empty line, `dh`/`d0` at
      column one) mints a node while deleting nothing, whereas a real region
      holding zero characters (`D`/`d$` on an empty line, `$` being inclusive)
      runs the full delete path and mints nothing
- [x] `h` at column one does **not** fail with an operator pending — `nv_left`
      beeps only when `op_type == OP_NOP`. It leaves an empty region, so `dh`
      and `guh` mint a node, `yh` clears the unnamed register, and `>h` really
      does indent the line. Plain `h` there still beeps
- [x] An insert session opened by a CHANGE operator always mints a node, even
      when it deletes nothing and types nothing (`cl<Esc>`/`s<Esc>`/`C<Esc>` on
      an empty line), because `op_change` prepared the entry first. A bare
      `i<Esc>`/`R<Esc>` still mints none
- [ ] Undo tree, insert session and `lastFind` are **not serialized** in
      `EngineSnapshot` — a restored engine starts with the snapshot as its undo
      root. Deferred and documented in `engine.ts`; revisit before the M0
      scripted-demo done-line, which round-trips through a JSON snapshot

**Wave 3 — memory** `[ ]`

- [ ] Registers end to end: `"0`, `"1`–`"9` **with correct shift-on-delete**,
      `"a`–`"z`, `"A`–`"Z` append, `"_` blackhole, `"-` small delete
- [ ] `p P` with charwise/linewise/blockwise semantics
- [ ] Text objects: `iw aw iW aW i" a" i' a' i( a( i[ a[ i{ a{ i< a< it at ip ap`
- [ ] **`.` dot-repeat** — build as an explicit recorded-change record, *never*
      by replaying raw keystrokes. `f,x` repeats only the `x`; `df,` repeats the
      whole delete. The subtlest thing in the engine.
      One refinement earned in Wave 2: the *insert* half genuinely IS raw-key
      replay (that is how a counted insert works, and how Vim's redo buffer
      works), so the unit `.` repeats is the resolved command PLUS its raw
      insert keystrokes — not one or the other.
- [ ] Blockwise register append (`"A` onto a blockwise value) is unhandled —
      the append path currently promotes to linewise when either side is
      linewise, and blockwise has no case yet
- [ ] Visual modes `v V <C-v>`
- [ ] Marks `m` `` ` `` `'`, plus `<C-o>`/`<C-i>`

**Wave 4 — automation** `[ ]`

- [ ] Macros `q @ @@` with halt-on-error
- [ ] Search `/ ? n N * #`, and the `/` register (the comparator currently skips
      it — re-enable when this lands)
- [ ] Command-line mode, ranges
- [ ] `:s` with `g`/`c` flags and capture groups
- [ ] `:g` / `:v`
- [ ] `:d :m :t :norm :w :q :set`
- [ ] `g-` / `g+` undo-tree navigation (the tree is an Act III story mechanic)

### Testing

- [x] Goldens are the primary test, diffed on buffer + cursor + registers
- [x] Property tests for invariants goldens cannot enumerate
- [x] `semantics.test.ts` for semantics the oracle structurally CANNOT express —
      empty-register writes (Vim omits empty registers from its output, so a
      golden cannot tell "untouched" from "overwritten with nothing") and
      snapshot/restore round-trips. Every expectation in it was hand-verified
      against real Vim; anything that a golden *can* express belongs in a golden
      instead, where Vim stays the authority
- [x] Extend properties: `w`→`b` never past start, `dd` reduces line count by
      exactly 1 except on a 1-line buffer, `u` after any single change (incl.
      operators and inserts) restores the exact prior snapshot, any operator
      + `<Esc>` is a no-op
- [ ] **Fuzz vs. real Vim** — 10k random sequences from the implemented
      alphabet, diffed. This is what finds the warts nobody wrote a case for.
      Must sanitise the alphabet: no `:q`, `:w`, `ZZ`, `ZQ`, `:!`, no shell
      escapes.
- [ ] `pnpm test:fuzz` script

### Docs written at M0, alongside the engine

- [ ] `docs/curriculum.md` — **owns the single reconciled table** of acts,
      stages and skills. PlanB's story beats were numbered off its own
      curriculum (only beat 1 aligned), so beats are keyed to acts and skills
      here, never to stage numbers.
- [ ] `docs/story-bible.md`
- [ ] `docs/stage-schema.md`

### M0 done when

- [ ] All four waves' goldens pass
- [ ] Fuzz run clean over 10k sequences
- [ ] A scripted demo drives the engine through `d2w` / `ci(` / `qa…q@a` /
      `:%s//g` from a JSON snapshot and back

**Explicitly NOT in M0:** no rendering, canvas, CRT shader, audio, levels, story
text, save system, or UI.

---

## M1 — `@vimorror/render`

**Owns the decision:** canvas vs DOM, decided against real per-cell animation
requirements. (PixiJS and CodeMirror 6 cannot both be the surface — Pixi is
canvas, CM6 is DOM. Since the interpreter and world are ours, the renderer is
ours.)

- [ ] Hand-rolled Canvas 2D glyph grid, offscreen font atlas, dirty-cell redraw
- [ ] Camera, cursor shapes per mode
- [ ] WebGL2 single-pass CRT post-FX (curvature, chromatic aberration, phosphor
      persistence, glitch), canvas fallback
- [ ] **Effects Intensity slider wired from day one** — never labelled "epilepsy
      safe mode", which implies a guarantee nobody can make
- [ ] JetBrains Mono subset baked to atlas — **confirm the exact licence grant
      (OFL 1.1 vs Apache-2.0 depends on distribution) before baking**

---

## M2 — `@vimorror/game`

- [ ] Zod stage schema (buffer text, entity overlay, `allowedKeys`,
      `teachesKeys`, `par`, win/lose conditions, triggers, story beats,
      per-stage difficulty overrides)
- [ ] Key gating — rejected *in character*, never a silent no-op
- [ ] Turn-based entities: **threats tick only when the player acts.** Keeps
      everything deterministic and replayable, and a thing that moves only when
      you do is scarier than one on a timer. A handful of late stages opt into
      real-time.
- [ ] Difficulty presets as pure modifier config — `:set verymagic` / `magic` /
      `nomagic`
- [ ] Hints — diff live state against the golden-solution prefix
- [ ] Scoring: keystrokes vs par, plus a "clean run" flag (no undo, no hints)
- [ ] Gentle Mode — all mechanics and story intact, startle beats and look-away
      tricks disabled. Framed like Celeste's Assist Mode: no penalty, no
      judgmental copy.
- [ ] Separate jump-scare toggle, for dread without startle
- [ ] **Director determinism test:** a replay containing injected edits must
      reproduce byte-identically from its snapshot. If horror breaks replay, the
      director API is wrong.

---

## M3 — `apps/editor` (the stage editor)

Shares `@vimorror/render` with the game, so what you author is exactly what
ships. Lands *before* any content is hand-authored — factory before product.

- [ ] Dual-pane authoring: raw buffer text left, visual grid right, live-synced
- [ ] Overlay painting: spawn, goal, walls, threats, key-pickups, triggers,
      story beats
- [ ] Metadata panel: id, act, `allowedKeys`, `teachesKeys`, par, difficulty
      overrides, story beat text
- [ ] **Solution recorder** — the highest-leverage feature in the plan. Play the
      stage in the editor; your keystrokes become the golden solution. One
      action yields the par score, the hint data *and* a regression test.
- [ ] Validator — replays every golden solution headlessly through core and
      asserts a win using only `allowedKeys`; runs in CI over `content/stages/`
- [ ] Playtest in place; JSON import/export via File System Access API
- [ ] **Definition of done:** author a brand-new stage in the editor, record its
      solution, export it, and confirm it loads and is completable in the game
      without touching code

---

## M4 — `apps/web`

- [ ] Title screen, `:set magic` difficulty selection (diegetic, from the game's
      own command line)
- [ ] Comfort settings surfaced **before first play**
- [ ] Skippable content note at first launch listing themes, plus a persistent
      resources link
- [ ] Save via `localStorage` with in-payload `schemaVersion`
- [ ] Audio: raw WebAudio, procedural drones
- [ ] Stage runner
- [ ] Playwright E2E: load a stage, send a real key sequence, assert the win
      screen — and separately assert that on `:set nomagic` an over-budget run
      fails while the identical run passes on `:set verymagic`

---

## M5 — Act I authored end to end

- [ ] Stages 1–3 authored **in the editor**, proving the whole pipeline without
      touching code

---

## M6 — Acts II–VI

- [ ] Remaining stages authored
- [ ] Placement skill-check to skip ahead (fixes the "painful re-unlocking"
      complaint returning vim-adventures players had)
- [ ] Interleaved free-play rooms with real prose and code (fixes "puzzles that
      teach puzzle-solving rather than muscle memory")
- [ ] Every later stage silently requires earlier motions — spaced repetition
      and interleaving beat blocked drilling for retention

---

## Curriculum — 13 stages in 6 acts

`docs/curriculum.md` owns the reconciled table. Stage 12 is **split**: the
search/replace mechanics stay at 12, and `:w` acceptance becomes Stage 13.

| Act | Stages | Skills |
|---|---|---|
| I — The Cold Buffer | 1 Two Worlds · 2 Four Directions · 3 Word Power | modes, `Esc`, `i o O` · `hjkl 0 ^ $ gg G` + counts · `w b e W B E f F t T ; ,` |
| II — The Deletions | 4 First Blood · 5 The Grammar Awakens · 6 Change & Build · 7 Inventory · 8 Precision Objects | `x X r u C-r` · `d` + composition, `dd D` · `c C s S a I A R` · `y p P`, registers · text objects, `%` |
| III — The Recursion | 9 The Echo · 11 Automation | `.` · `q @ @@`, marks, `C-o C-i` |
| IV — The Search | 12a | `/ ? n N * #` |
| V — The Rewrite | 10 Paint Mode · 12b | `v V C-v` · `:s`, ranges, `:g` `:v` |
| VI — Write and Quit | 13 The File, Saved | buffers, `:w`, `ZZ` / `ZQ` |

- [ ] The spine is **operator + motion = action**. Shortcuts are revealed as
      *sugar after* the grammar lands — `x` is secretly `dl`, `D` is `d$`, `s`
      is `cl` — turning "that's the same rule again" into a payoff rather than
      more rote memorisation.

---

## Story beats — keyed to acts and skills, never stage numbers

- [ ] **"hello, world"** (Act I, `i`) — procrastination
- [ ] **"the word that isn't wrong"** (Act II, `c`) — perfectionism; the level is
      *unsolvable* if you try to perfect everything
- [ ] **"the undo boss"** (Act III, `u`/`<C-r>`) — rumination; you win by
      pressing `<C-r>` deliberately, choosing acceptance
- [ ] **"the macro that isn't yours"** (Act III, `q`/`@`) — habits are edited,
      not fought
- [ ] **"someone else's handwriting"** (Act IV, `/`) — impostor syndrome
- [ ] **"rewriting the sentence"** (Act V, `:s`) — resolved with the `/c` confirm
      flag, instance by instance; the game explicitly rejects blunt `:%s/`
      global positivity as false
- [ ] **"the file, saved"** (Act VI, `:w`) — a final boss is telegraphed and
      never comes; the file stays editable after the credits

### Horror escalation

- [ ] **Acts I–III restrained and mechanical:** the buffer edits itself behind
      you and you only notice on scrollback; the status line echoes your
      keystrokes a beat late; glyphs decay on repeated cursor visits; one stage
      where `Esc` does not work and you are trapped in Insert mode — able to
      *write* but not to *act* — while something approaches
- [ ] **Acts IV–VI earn the bold, sandbox-internal fourth-wall breaks:** undo
      history containing edits you didn't make; a phantom second cursor; the
      Undo menu option itself flickering away at the rumination beat; flat
      clinical log-speak; references to your own play stats, never real PII; the
      late reveal that every "different" buffer was the same file at different
      points in undo history

---

## Verification commands

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
