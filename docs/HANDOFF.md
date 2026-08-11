# HANDOFF — after Wave 3c (2026-08-11)

Read this first when continuing work. The plan of record is `MergedPlan.md`;
the tracking doc is `docs/CHECKLIST.md`; the harness gospel is
`tools/goldens/README.md`. This file only carries what those three do not: the
current verified state, and the engine-internals notes a newcomer would
otherwise have to rediscover by reading `state.ts` end to end.

---

## Where the project stands

- **Milestone:** M0. Waves 1 and 2 are complete. Wave 3 is **partly done**:
  - 3a registers end-to-end + `p`/`P` — **done**
  - 3b text objects — **done**
  - 3c visual modes `v V <C-v>` + blockwise — **done**
  - 3d marks and the jumplist — **NOT started**
  - 3e `.` dot-repeat — **NOT started**
  - Wave 4 (macros/search/ex-commands) — NOT started
- **Oracle:** real Vim 9.1 at `/usr/bin/vim`. Goldens are generated locally and
  committed, so CI never needs Vim.
- **Verified green at commit time**, all four commands clean:

```bash
pnpm goldens:generate && pnpm test && pnpm typecheck && pnpm goldens:verify
```

  846 goldens, 884 tests, isolation verified. Nothing is mid-flight.

## The two things not to re-break

### 1. Undo minting is about `u_save`, not about success

The Wave 2 note said "only a command that FAILS mints nothing". Wave 3 refined
that, and the refinement matters:

> What decides whether a node is minted is whether the command reached its
> `u_save` before bailing out — **not** whether it succeeded.

Measured with `undotree().seq_cur`. So `p` from an **unset** register raises E353,
changes nothing, and *still* mints a node for `u` to burn on, because `u_save`
runs before `do_put` looks the register up. Whereas `~` on an empty line beeps
inside `nv_tilde` *before* any save, and mints nothing. `commit()` must never go
back to comparing content to decide this.

The corollaries from Wave 2 all still hold — degenerate vs real-empty regions,
`h` at column one with an operator pending — and `docs/CHECKLIST.md` lists them.

### 2. There are THREE states of a register, not two

Vim distinguishes all three, and collapsing any two of them is a silent bug:

| state | `p` behaviour |
|---|---|
| UNSET (never written) | E353, puts nothing, **still mints an undo node** |
| WRITTEN BUT EMPTY | successful zero-character put, reports nothing |
| holding text | the ordinary case |

`"_` reads back as **written-but-empty**, so `"_p` is a silent no-op and not an
error. A register holding one empty LINE is in the third group — its text is a
bare `"\n"` and putting it really does open a blank line. A zero-length put
leaves the cursor exactly where it was, for both `p` and `P`.

## Engine architecture notes

- `packages/vim-core/src/state.ts` is the reducer core: `step(state, key)`.
  - `applyLinewise()` — doubled ops (`dd`, `3>>`, `gUU`) synthesize Vim's
    `nv_lineop`: `cursor_down(count-1)` (fails ONLY from the last line, clamps
    elsewhere) + first-non-blank landing (except yank, which keeps the column).
  - `runOperator()` — per-op cursor/register/undo rules, the
    degenerate-vs-real-empty-region split, and two flags worth understanding:
    - `fromObject` — a linewise **object** pulls the yank cursor to column zero
      (`yip`), a linewise **motion** leaves the column alone (`yy`, `y_`). These
      genuinely disagree; folding them together breaks `y_`.
    - `shiftCount` — a count in **visual** mode multiplies a shift (`2>` moves
      two shiftwidths). Normal mode's `2>>` counts LINES instead.
  - `stepVisual()` — the anchor (`visualStart`) is fixed and the cursor moves, so
    every Wave 1 motion extends a selection for free. It leaves visual mode
    *before* running the operator, and must carry `pending.register` across that
    transition or `v"ay` silently writes unnamed.
  - `insertKey()` — one code path for live insert keys AND counted-repeat
    replay, because a counted insert repeats RAW keystrokes.
    `InsertSession.replaced` is the replace-mode restore stack: original char |
    `null` (line grew) | `'\n'` (inserted break → `<BS>` rejoins).
  - `finishInsert()` skips `pushUndo` for a session that changed nothing —
    unless `session.fromChange`, since `op_change` already earned the node. It
    also performs **blockwise replication**: `session.blockRows` means the text
    typed on the first row is copied down the block, skipping rows too short to
    reach the column. `<C-v>I`/`A` will hook in exactly here.
- `motions.ts`: `fwdWordWalk` (Vim `fwd_word`) and `moveWordEndBackward`
  (`bckend_word`). The virtual end-of-line position (`col === length`) is
  load-bearing in both directions. `incPos`/`decPos`/`fwdWordWalk` are exported
  **because `textobjects.ts` reuses them** — do not re-implement them there.
- `textobjects.ts`: objects return an `OperatorRange` directly, not a
  `MotionResult`, because an object names its region rather than saying "go
  there". The traps, all measured: `end_word`'s `stop` flag; quotes are
  **chained** not paired disjointly; `i{` is genuinely linewise when the braces
  sit on their own lines; `di(` searches AHEAD across lines despite `:h ib`.
- `operators.ts`: `OperatorRange` has three kinds — charwise (`end` EXCLUSIVE),
  linewise, and blockwise (`endCol` INCLUSIVE). Use `rangeLines()` and
  `rangeStart()` rather than switching on the kind by hand. `operatorRange()`
  holds the two exclusive-motion adjustments; `applyDelete()` holds the
  `op_delete` linewise promotion, which several text-object results rely on.
- `put.ts`: the register's TYPE decides the shape of a put, not the key.
- `undo.ts`: every node stores `changeStart` (Vim's `uh_cursor`) — both `u` and
  `<C-r>` land there.
- `registers.ts`: uppercase append promotes to linewise if either side is
  linewise, and two blocks stack **ragged** (no padding). `forcesNumbered` (the
  `%`-motion rule) shifts `"1` even for a small delete.
- `MotionResult.forcesNumbered` is set by `%` today. **Wave 4 must also set it
  on `/ ? n N { } ( )`.**

## Harness notes added in Wave 3

- `gen.vim` now wraps **each group in its own `try`**. E353 raises a catchable
  exception out of `feedkeys` rather than beeping, and one `try` around the whole
  loop abandoned every remaining group — silently defeating README detail 9,
  whose only remedy is putting follow-up keys in a separate group.
- Cases that mean to fail declare `expectError: true`. An undeclared error is
  reported as a problem, and so is a declared one that did not happen.
- Reading Vim's `'[` and `']` marks is the fastest way to learn what region an
  operator actually used — far better than inferring it from a buffer diff. The
  scratch probes in this session did that repeatedly.

## Known open edges

- Visual mode: `<C-v>I`/`A`, `p` and `r` over a selection, `gv` reselect, and
  `$`-to-end-of-line blocks (Vim's MAXCOL curswant) are not implemented.
- `o`/`O` with `autoindent` don't copy the indent (the baseline is
  `noautoindent`, and only `cc`/`S` honor it per the goldens).
- `curswant` is captured in every golden but not compared; undo tree / insert
  session / `lastFind` / `visualStart` are not serialized in `EngineSnapshot`.
  Both deferred deliberately, both tracked in `docs/CHECKLIST.md`.

## What comes next

**Wave 3d — marks and the jumplist.** `m` `` ` `` `'` (`` ` `` is
charwise-exclusive, `'` is linewise), plus `<C-o>`/`<C-i>`. The fiddly part is
that marks must SHIFT when lines are inserted or deleted above them; author
goldens for that specifically, not just for set-and-jump.

**Wave 3e — dot-repeat.** Build it as an explicit recorded-change record, never
by replaying raw keystrokes: `f,x` repeats only the `x`, `df,` repeats the whole
delete. One refinement already earned in Wave 2 — the *insert* half genuinely IS
raw-key replay (that is how a counted insert works, and how Vim's redo buffer
works), so the unit `.` repeats is the resolved command PLUS its raw insert
keystrokes, not one or the other. **Before authoring dot-repeat goldens, re-read
harness details 7, 9 and 10 in `tools/goldens/README.md`** — the undo-group and
abort-on-error rules are what make a plausible-looking golden wrong.

Also still open at M0: the fuzz harness (`pnpm test:fuzz` does not exist yet),
the CI workflow, the scripted demo, and `docs/curriculum.md` /
`story-bible.md` / `stage-schema.md`.
