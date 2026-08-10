# vimorror — Plan

## Context

`/Users/ashishvagish/Documents/vimorror` is empty. The goal is a browser game that teaches Vim by playing it — in the spirit of vim-adventures.com, but going considerably further: 12 stages, ~63 atomic Vim skills, and a psychological-horror story about escaping your own inner doubts.

The core creative insight from research: **Vim's own mechanics are already precise metaphors for the psychology of self-doubt.** `u` is regret; `Ctrl-R` is acceptance (and Vim really does destroy the redo branch the moment you edit after undoing — dwelling forecloses return); `.` is compulsion; registers are curated memory; macros are habits; `:s/old/new/c` is rewriting your self-narrative one instance at a time rather than by blunt global replace. The game world *is* a text buffer. The horror and the skill are the same object.

**Decisions made (confirmed with the user):**

| Decision | Choice |
|---|---|
| Vim engine | Build our own interpreter, validated by golden tests against real Vim |
| Visual style | Pure text world — everything is monospace glyphs on a grid |
| Horror | Bold fourth-wall breaks, but strictly inside the game sandbox |
| **This milestone** | **Engine-only prototype: interpreter + golden-test harness. No game, no story, no rendering.** |

Everything below the `---` line is design context that must not be lost, and that constrains the engine's API. The buildable scope of *this* plan is Milestone 0 only.

---

# Milestone 0 — The Vim interpreter + golden-test harness

## Why our own interpreter

`@replit/codemirror-vim` (MIT, ~14KB gz) is excellent and would be the right call for a normal editor. It is the wrong call here for four reasons, all of which are permanent, not incidental:

1. **Key gating is the pedagogy.** Every level must reject keys the player hasn't learned yet, and reject them *in fiction* with a specific horror beat — not silently no-op.
2. **Keystroke scoring is a core loop.** VimGolf-style "you did that in 7 keys, par is 3" needs the full command shape (`d{count}w`), not just "a command finished."
3. **The horror requires lying about the buffer.** A phantom second cursor, an undo history containing edits the player never made, text that reverts when you look away. You cannot do this inside someone else's editor without forking it.
4. **Scope is bounded.** We need ~63 commands, not all of Vim.

The risk this creates — subtly wrong semantics — is exactly what the golden-test harness eliminates.

## The golden-test harness (de-risked — prototype already runs)

Real Vim 9.1 is at `/usr/bin/vim` on this machine. A prototype harness is working; these results are from an actual run against real Vim:

| Case | Start buffer | Keys | Real Vim result |
|---|---|---|---|
| `d2w` | `alpha beta gamma delta` | `d2w` | `gamma delta`, unnamed=`alpha beta ` |
| `ci(` | `fn(a, b, c) end` @1,7 | `ci(X<Esc>` | `fn(X) end`, unnamed=`a, b, c` |
| dw EOL wart | `foo bar` @1,5 | `dw` | `foo `, **newline not eaten** |
| named reg | `keep me`/`kill me` | `"ayyjdd` | `"a`=`keep me\n`, unnamed=`kill me\n` |
| `:s///g` | `x a x a x` | `:s/x/Q/g<CR>` | `Q a Q a Q` |
| dot-repeat | `one two three four` | `dw..` | `four` |
| `f,;x` | `a,b,c,d` | `f,;x` | `a,bc,d` |

The `dw`-at-end-of-line case is the one that matters most: it reproduces Vim's famous special-case wart automatically. That is the entire argument for goldens over hand-written expectations — nobody writes that case correctly from memory.

**Mechanism:** a spec JSON (`buffer`, `cursor`, `keys`) is piped into a small `gen.vim` that sets up the buffer, runs the keys, and writes back buffer + cursor + registers as JSON.

```bash
vim -u NONE -i NONE -N -es -S gen.vim
```

Three flags earned the hard way during prototyping — **do not drop any of them**:
- `-i NONE` — without it Vim reads viminfo and registers leak between test cases. This silently corrupted the first prototype run.
- `-u NONE -N` — no user config, but nocompatible.
- Pass control characters as real bytes in the JSON (`` for Esc), **not** as `\<Esc>` notation. The `eval()`-based unescaping approach produces literal `<Esc>` text in the buffer.

**Known gap to solve first:** macro recording (`qa…q` then `2@a`) does not replay correctly under `:normal` — the recording lands but the playback doesn't. Cases involving `q`, `@`, or `:g` must go through `feedkeys(keys, 'x')` instead of `execute 'normal '`. Fix this in the harness before authoring the macro/global goldens, or those goldens will bake in wrong expectations.

**Two other conversion details:** Vim reports 1-based *byte* columns; the engine should use 0-based character indices internally and convert only in the comparator. And `mode()` is meaningless under `-es` — capture mode from our engine only, or drive an interactive Vim in a pty if mode goldens turn out to be needed.

Goldens are **generated locally and committed**, so CI never needs Vim installed.

## Package layout

```
vimorror/
├─ package.json                 # pnpm workspace
├─ packages/vim-core/           # zero runtime dependencies
│  └─ src/
│     ├─ buffer.ts              # lines[], immutable edits, position math
│     ├─ keys.ts                # KeyEvent → canonical token ("d", "<Esc>", "<C-r>")
│     ├─ parser.ts              # [count][reg] op [count] motion|textobject
│     ├─ motions/               # charwise, word, find, line, search, mark, bracket
│     ├─ textobjects/           # word, quote, bracket, paragraph, tag
│     ├─ operators/             # delete, change, yank, case, indent
│     ├─ registers.ts           # unnamed, "0, "1-"9 shift, "a-"z, "A-"Z, "_
│     ├─ undo.ts                # undo stack + redo-branch invalidation
│     ├─ macros.ts              # record/replay, halt-on-error
│     ├─ excmd.ts               # ranges, :s, :g, :v, :normal
│     ├─ engine.ts              # VimEngine facade
│     └─ events.ts              # typed event union
└─ tools/goldens/
   ├─ gen.vim                   # the proven driver script
   ├─ generate.ts               # spawns Vim, writes goldens/
   ├─ cases/*.yaml              # case specs, one file per skill family
   └─ goldens/*.json            # committed generated output
```

## Engine API — designed for the game that comes later

The interpreter is headless, but five capabilities must be designed in **now**, because retrofitting them means rewriting the core. This is the whole reason we're not using an off-the-shelf emulator.

```ts
class VimEngine {
  feed(key: KeyToken): EngineEvent[]

  // Live mid-command state — drives the "you typed: d2w" ghost HUD
  readonly pending: {
    mode: Mode
    count?: number
    register?: string
    operator?: string
    keyBuffer: KeyToken[]
  }

  // 1. Key gating — the pedagogy. Rejected keys emit KeyRejected, never silent no-op.
  setKeyPolicy(policy: KeyPolicy): void

  // 2. Instrumentation — VimGolf scoring
  //    { keys: "d2w", keystrokes: 3, shape: "d{count}w" }
  onCommandResolved(cb: (c: ResolvedCommand) => void): void

  // 3. Director API — the horror. Synthetic mutations and synthetic undo
  //    entries that are indistinguishable from the player's own.
  //    Namespaced `director.*` so it can never be reached by accident.
  readonly director: {
    injectEdit(edit: Edit): void
    injectUndoEntry(entry: UndoEntry): void
    rewriteRegister(name: string, value: string): void
  }

  // 4. Snapshot/restore — saves, replays, and test fixtures share one path
  snapshot(): EngineSnapshot
  static restore(s: EngineSnapshot): VimEngine
}
```

Events: `ModeChanged`, `BufferChanged`, `CommandResolved`, `RegisterChanged`, `KeyRejected`, `InvalidCommand`.

The fifth requirement is **determinism**: no clocks, no randomness, no I/O inside `vim-core`. Everything the game needs to be spooky is injected through `director`.

## Build order

Four waves, each ending with green goldens for its skill family. Skill numbering refers to the curriculum in the appendix.

1. **Wave 1 — substrate + motions.** Buffer, key tokenizer, mode machine, cursor clamping. Motions: `hjkl`, `0 ^ $`, `gg G {n}G`, `w b e W B E ge`, `f F t T ; ,`, `%`. Counts. `x X r`, `u Ctrl-R`.
2. **Wave 2 — the grammar.** This is the spine. Operator-pending mode as a real state; `d c y` composing with *every* Wave 1 motion; doubled operators (`dd yy cc`); `D C Y`; `gU gu g~`; `> <`; insert-mode variants `i a I A o O R s S`. Once this wave is right, every later motion works with every operator for free.
3. **Wave 3 — memory.** Registers (unnamed, `"0`, `"1`-`"9` shifting, `"a`-`"z`, `"A`-`"Z` append, `"_`), `p P`, text objects (`iw aw`, `i" a"`, `i( a(`, `i{ a{`, `ip ap`, `it at`), `.` dot-repeat, visual modes `v V Ctrl-V`, marks + `Ctrl-O Ctrl-I`.
4. **Wave 4 — automation.** Macros `q @ @@` with halt-on-error, search `/ ? n N * #`, command-line mode, ranges, `:s` with `g`/`c` flags and capture groups, `:g` / `:v`.

Dot-repeat (Wave 3) is the subtlest thing in the whole engine — it repeats the last *change*, so `f,x` repeats only the `x` while `df,` repeats the whole delete. Build it as an explicit recorded-change record, not by replaying raw keystrokes.

## Testing

- **Goldens** (primary) — every case in `tools/goldens/cases/` replayed through our engine, diffed on buffer + cursor + registers. Target ≥400 cases, weighted toward edge cases: empty lines, single-char buffers, cursor at EOL/EOF, counts that overshoot, operators on the last line, nested brackets, unmatched quotes.
- **Property tests** (`fast-check`) for invariants goldens can't enumerate: `w` then `b` never lands past the start; `dd` reduces line count by exactly 1 except on a 1-line buffer; `u` after any single change restores the exact prior snapshot; any operator followed by `<Esc>` is a no-op.
- **Fuzz vs. real Vim** — generate random key sequences from the implemented alphabet, run both, diff. This is what will actually find the wart cases nobody thought to write.

Stack for this milestone is deliberately tiny: TypeScript strict (`noUncheckedIndexedAccess: true` — this codebase is nothing but array indexing), Vitest, fast-check, tsup. No framework, no renderer, no bundler concerns yet.

## Verification

```bash
pnpm install
pnpm goldens:generate    # needs local vim; regenerates + commits fixtures
pnpm test                # goldens + properties, must be green
pnpm test:fuzz           # 10k random sequences diffed against real vim
```

Milestone 0 is done when: all four waves' goldens pass, the fuzz run is clean over 10k sequences, and a scripted demo can drive the engine through a `d2w` / `ci(` / `qa…q@a` / `:%s//g` sequence from a JSON snapshot and back.

## Explicitly NOT in this milestone

No rendering, no canvas, no CRT shader, no audio, no levels, no story text, no save system, no UI. Those are Milestone 1+.

---

# Appendix — design context (not built in this milestone)

Preserved so the engine's API stays honest. Full research with sources is in the session transcript.

## Curriculum: 12 stages

1. **Two Worlds** — modes, `Esc` as home, `i`, `o`/`O`
2. **Four Directions** — `hjkl`, `0 ^ $`, `gg G`, counts
3. **Word Power** — `w b e`, `W B E`, `f F t T ; ,`
4. **First Blood** — `x X`, `r`, `u`/`Ctrl-R`
5. **The Grammar Awakens** — `d`, operator+motion composition, `dd`, `D`
6. **Change & Build** — `c C s S`, `a I A`, `R`
7. **Inventory** — `y p P`, named registers, the unnamed-register clobber trap
8. **Precision Objects** — `iw aw`, quotes, brackets, `ip ap`, `%`
9. **The Echo** — `.` dot-repeat
10. **Paint Mode** — `v V Ctrl-V`
11. **Automation** — `q @ @@`, marks, `Ctrl-O`/`Ctrl-I`
12. **Find, Replace, Rule the File** — `/ ? n N * #`, `:s`, ranges, `:g` / `:v`

The spine is **operator + motion = action**. Operator-pending must be a *visible* game state (Vim's biggest UX problem is that it's invisible). Shortcuts are revealed as sugar *after* the grammar lands — `x` is secretly `dl`, `D` is `d$`, `s` is `cl` — turning "that's the same rule again" into a payoff instead of more rote memorization.

**Where this beats vim-adventures:** its command list omits `c` as a formal operator, all of visual mode, `.` dot-repeat, `:s`, and `:g`. Those become our Stages 6, 9, 10, and 12 — the back half of the game is territory the competitor never enters.

**Fixing its known complaints:** subscription rental → one-time or free; puzzles that teach puzzle-solving rather than muscle memory → interleaved free-play rooms with real prose/code; forced re-unlocking that returning users called "painful" → a placement skill-check to skip ahead; old skills never revisited → every later stage silently requires earlier motions (spaced repetition and interleaving beat blocked drilling for long-term retention).

## Story: escaping inner doubts

Each stage pairs a Vim skill with the doubt it embodies. Selected beats:

- **1 · "hello, world"** — procrastination. An empty file in darkness; idle too long and the placeholder retypes itself into something anxious. Pressing `i` reveals the level was always there, just unlit. Insert mode as the light switch.
- **2 · "the word that isn't wrong"** — perfectionism. The exit is only reachable by leaving several "wrong" words untouched. The level is *unsolvable* if you try to perfect everything.
- **4 · "someone else's handwriting"** — impostor syndrome. `/` search is the mechanic: you hunt for evidence of your inadequacy in others' pristine buffers, and the closer you look the more you find they share your flaws. The exit unlocks when you search your *own* buffer and find something worth keeping.
- **7 · "the undo boss"** — rumination. Every `u` shows a glimpse of the version where the bad thing didn't happen, then snaps back. You win not by out-undoing it but by pressing `Ctrl-R` deliberately — choosing to accept. The boss shrinks into a companion.
- **9 · "the macro that isn't yours"** — habits. A macro you recorded earlier without realizing runs loose, "helpfully" repeating a harmful edit everywhere. You fix it by opening the register, reading the keystrokes, and re-recording over it. Habits are edited, not fought.
- **10 · "rewriting the sentence"** — the core self-narrative. `:s/` attempts on the wall's sentence get reverted the instant you look away — until you realize *you* are the one reverting them. Resolved with the `/c` confirm flag, instance by instance. The game explicitly rejects blunt `:%s/` global positivity as false.
- **12 · "the file, saved"** — acceptance. `:w` is the entire mechanic. A final boss is telegraphed and never comes; the only tension is your own hesitation to let the file be what it is. The file stays editable after the credits.

**Guardrail across every stage:** no doubt is ever killed for XP. Each resolves through integration or conscious choice — Celeste's Badeline as *part of* the self, Hellblade's agency-preserving framing, Night in the Woods' refusal to name diagnoses. No self-harm imagery; loss is represented only through abstraction (deletion, silence, blank buffer).

## Horror techniques (all sandbox-internal)

Undo history containing edits you didn't make · a phantom second cursor compulsively editing off-screen · the Undo menu option itself flickering away at the rumination beat · text reverting when you look away · glyphs that decay on repeated cursor visits · flat clinical log-speak (`WARNING: 14,000 unsaved edits detected. Recommend discard.`) · references to your own play stats, never real PII · the late reveal that every "different" buffer was the same file at different points in undo history.

## Accessibility and safety

- **"Effects Intensity"** slider, surfaced before first play — never labelled "epilepsy safe mode," which implies a guarantee no one can make.
- **Gentle Mode** — all mechanics and story intact, startle beats and look-away tricks disabled. Framed like Celeste's Assist Mode: no penalty, no judgmental copy.
- Separate jump-scare toggle, for players who want dread without startle.
- Never color alone — every color-coded element gets a redundant glyph or label.
- Skippable content note at first launch listing themes, plus a persistent resources link.

## Stack for later milestones (researched, not yet committed)

Vite + Solid or Svelte for HUD chrome; custom canvas text-grid renderer with a WebGL post-process pass for CRT/scanline/glitch (`pixi-filters` ships `CRTFilter` and `GlitchFilter` if we adopt PixiJS); Howler (~10KB gz) plus a hand-written Web Audio drone module for non-looping ambient dread; Dexie for saves with an explicit in-payload `schemaVersion`; per-level `buffer.txt` + `level.json`, loaded via `import.meta.glob`, validated with Zod contract tests; `vite-plugin-pwa` for offline; JetBrains Mono (OFL 1.1), subsetted, for its box-drawing coverage.

One correction to carry forward: PixiJS and CodeMirror 6 cannot both be the render surface — Pixi is canvas, CM6 is DOM. Since we're building our own interpreter and a pure text world, the renderer is ours and the question is only canvas vs. DOM. Decide at Milestone 1 against real per-cell animation requirements.