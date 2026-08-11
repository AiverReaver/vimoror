# HANDOFF — after Wave 2 (2026-08-11)

Read this first when continuing work. The plan of record is `MergedPlan.md`;
the tracking doc is `docs/CHECKLIST.md`; the harness gospel is
`tools/goldens/README.md`. This file only carries what those three do not: the
current verified state, and the engine-internals notes a newcomer would
otherwise have to rediscover by reading `state.ts` end to end.

---

## Where the project stands

- **Milestone:** M0. Waves 1 and 2 (substrate + motions, then the operator
  grammar) are implemented, committed and green. Waves 3
  (registers/text objects/dot-repeat/visual/marks) and 4 (macros/search/
  ex-commands) are NOT started.
- **Oracle:** real Vim 9.1 at `/usr/bin/vim`. Goldens are generated locally and
  committed, so CI never needs Vim.
- **Verified green at commit time**, all four commands clean:

```bash
pnpm goldens:generate && pnpm test && pnpm typecheck && pnpm goldens:verify
```

  612 goldens, 642 tests, isolation verified. Nothing is mid-flight.

## The one thing not to re-break

The previous session concluded that a no-op operator should NOT mint an undo
node, "fixed" the engine accordingly, and authored three pinning cases. Real
Vim refuted all three on first generation. The measured rule, via
`undotree().seq_cur`:

> A command that RUNS mints an undo node even when the buffer ends up
> byte-identical — `u_save()` happens before the work, not after. Only a
> command that FAILS mints nothing.

So `>>` on an empty line, `<<` with no indent, `gUU` on already-uppercase text,
`~` on a digit and `r` typing the same character all leave a node for `u` to
burn on; `~` on an *empty* line beeps and mints none. `commit()` must never go
back to comparing content to decide this. Two corollaries, both pinned:

- `op_delete` opens with `if (oap->empty) return u_save_cursor()`, so a
  DEGENERATE region (exclusive motion that could not move: `dl` on an empty
  line, `dh`/`d0` at column one) mints a node while deleting nothing — whereas a
  real region holding zero characters (`D`/`d$` on an empty line, `$` being
  inclusive) mints nothing at all.
- `h` at column one does not fail with an operator pending (`nv_left` beeps only
  when `op_type == OP_NOP`); it leaves an empty region, so `>h` really does
  indent the line and `yh` really does clear the unnamed register.

The full list of what Wave 2 had to port from Vim's C — and which of it is
pinned by goldens versus by `semantics.test.ts` — is in `docs/CHECKLIST.md`
under Wave 2. None of it is safe to "simplify".

## Engine architecture notes

- `packages/vim-core/src/state.ts` is the reducer core: `step(state, key)`.
  - `applyLinewise()` — doubled ops (`dd`, `3>>`, `gUU`) synthesize Vim's
    `nv_lineop`: `cursor_down(count-1)` (fails ONLY from the last line, clamps
    elsewhere) + first-non-blank landing (except yank, which keeps the column).
    `opStart = min(cursor, target)` feeds both the cursor rules and the undo
    `changeStart`.
  - `runOperator()` — per-op cursor/register/undo rules, and the
    degenerate-vs-real-empty-region split described above.
  - `insertKey()` — one code path for live insert keys AND counted-repeat
    replay, because a counted insert repeats RAW keystrokes.
    `InsertSession.replaced` is the replace-mode restore stack: original char |
    `null` (line grew) | `'\n'` (inserted break → `<BS>` rejoins).
  - `finishInsert()` skips `pushUndo` for a session that changed nothing —
    unless `session.fromChange`, since `op_change` already earned the node.
- `motions.ts`: `fwdWordWalk` (Vim `fwd_word`, with the `eol` flag and the
  NUL-position `incPos`) and `moveWordEndBackward` (Vim `bckend_word`, with
  `decPos`). The virtual end-of-line position (`col === length`) is load-bearing
  in both directions.
- `operators.ts`: `operatorRange()` holds the two exclusive-motion adjustments
  (`:h exclusive-linewise`); `applyDelete()` holds the `op_delete` linewise
  promotion; `applyChange()` honors `autoindent`; `shiftwidth` 0 → `tabstop`.
- `undo.ts`: every node stores `changeStart` (Vim's `uh_cursor`) — both `u` and
  `<C-r>` land there.
- `registers.ts`: uppercase append promotes to linewise if either side is
  linewise; `forcesNumbered` (the `%`-motion rule) shifts `"1` even for a small
  delete; unnamed mirrors the full merged value after an append.
- `MotionResult.forcesNumbered` is set by `%` today. **Wave 4 must also set it
  on `/ ? n N { } ( )`.**

## Known open edges

- `o`/`O` with `autoindent` don't copy the indent (the baseline is
  `noautoindent`, and only `cc`/`S` honor it per the goldens). Revisit if a
  golden demands it.
- Blockwise register append is unhandled — Wave 3.
- `curswant` is captured in every golden but not compared; undo tree / insert
  session / `lastFind` are not serialized in `EngineSnapshot`. Both deferred
  deliberately, both tracked in `docs/CHECKLIST.md`.

## What comes next

Wave 3 (memory: registers end-to-end, `p P`, text objects, dot-repeat, visual
modes, marks), then Wave 4 (automation). Before authoring dot-repeat goldens,
re-read harness details 7 and 9 in `tools/goldens/README.md` — the undo-group
and abort-on-error rules are what make a plausible-looking golden wrong. Also
still open at M0: the fuzz harness (`pnpm test:fuzz` does not exist yet), the CI
workflow, the scripted demo, and `docs/curriculum.md` / `story-bible.md` /
`stage-schema.md`.
