# HANDOFF — after Wave 3 complete (2026-08-11)

Read this first when continuing work. The plan of record is `MergedPlan.md`;
the tracking doc is `docs/CHECKLIST.md`; the harness gospel is
`tools/goldens/README.md`. This file only carries what those three do not: the
current verified state, and the engine-internals notes a newcomer would
otherwise have to rediscover by reading `state.ts` end to end.

---

## Where the project stands

- **Milestone:** M0. Waves 1, 2 and **3 are complete**:
  - 3a registers end-to-end + `p`/`P` — done
  - 3b text objects — done
  - 3c visual modes `v V <C-v>` + blockwise — done
  - 3d `{ } ( )` motions, marks and the jumplist — done
  - 3e `.` dot-repeat — done
  - 3f the open visual edges (`<C-v>I`/`A`, visual `p`/`r`, `gv`, `$` blocks) — done
  - Wave 4 (macros / search / ex-commands) — **NOT started**
- **Oracle:** real Vim 9.1 at `/usr/bin/vim`. Goldens are generated locally and
  committed, so CI never needs Vim.
- **Verified green**, all four commands clean:

```bash
pnpm goldens:generate && pnpm test && pnpm typecheck && pnpm goldens:verify
```

  **1038 goldens, 1080 tests, isolation verified** (every case re-run in its own
  Vim process and diffed). Nothing is mid-flight.

## The four things not to re-break

### 1. Undo minting is about `u_save`, not about success

> What decides whether a node is minted is whether the command reached its
> `u_save` before bailing out — **not** whether it succeeded.

Measured with `undotree().seq_cur`. `p` from an **unset** register raises E353,
changes nothing, and *still* mints a node, because `u_save` runs before `do_put`
looks the register up. `~` on an empty line beeps inside `nv_tilde` *before* any
save and mints nothing. `commit()` must never go back to comparing content.

Wave 3 added two more of the same shape: a bare `}` at the end of the buffer
(and `{` at the start) **succeeds without moving**, so `d}` there runs a
degenerate region and mints a node — while `d2}` fails outright and mints none.

### 2. There are THREE states of a register, not two

| state | `p` behaviour |
|---|---|
| UNSET (never written) | E353, puts nothing, **still mints an undo node** |
| WRITTEN BUT EMPTY | successful zero-character put, reports nothing |
| holding text | the ordinary case |

`"_` reads back as **written-but-empty**, so `"_p` is a silent no-op and not an
error. A register holding one empty LINE is in the third group.

### 3. A mark is destroyed by deleting its line, not relocated

Marks shift down when lines are inserted above and up when they are deleted
above — but a mark whose **own** line is deleted is *gone*, and jumping to it
raises E20 exactly as an unset mark does. An implementation that only shifts
passes every other case in `wave3-marks.yaml` and fails exactly one.

The jumplist takes the same shift with the **opposite** deletion rule: an entry
inside a deleted range clamps to the start of the deletion rather than being
dropped, so the list never develops holes.

### 4. Visual mode's cursor may sit ON the end-of-line NUL

`$` is the only motion that puts it there (`l` refuses without 'virtualedit').
An inclusive selection whose end lands past the line then takes the **line
break**, which is why `v$d` joins the next line up while `vlld` over the same
three characters leaves an empty line behind. The same rule explains a selection
on an empty line yielding `"\n"`.

## Engine architecture notes

- `packages/vim-core/src/state.ts` is the reducer core: `step(state, key)`.
  - `step()` now wraps `dispatch()` with `recordChange()`, the `.` recorder. It
    watches what a key *did* rather than asking each command to declare itself,
    so a command added later cannot silently forget to be repeatable.
  - `applyLinewise()` — doubled ops synthesize Vim's `nv_lineop`:
    `cursor_down(count-1)` (fails ONLY from the last line) + first-non-blank
    landing (except yank, which keeps the column).
  - `runOperator()` — per-op cursor/register/undo rules. Its optional flags are
    now a named object (`RunOperator`) rather than a tail of booleans:
    - `fromObject` — a linewise **object** pulls the yank cursor to column zero
      (`yip`), a linewise **motion** leaves the column alone (`yy`, `y_`).
    - `fromVisual` — Vim's `oap->is_VIsual`. It implies `fromObject`, and it
      **suppresses `op_delete`'s linewise promotion**. Buffer and cursor come
      out identical either way; only the register's TYPE differs, so this is
      invisible until something puts the register back.
    - `shiftCount` — a count in **visual** mode multiplies a shift.
  - `stepVisual()` — the anchor (`visualStart`) is fixed and the cursor moves,
    so every motion extends a selection for free. It leaves visual mode
    *before* running the operator and must carry `pending.register` across.
  - `insertKey()` — one code path for live insert keys AND counted-repeat
    replay, because a counted insert repeats RAW keystrokes.
  - `finishInsert()` performs **blockwise replication**. `session.blockRows`
    now carries `pad` (`A` pads a short row, `I` and `c` skip it),
    `toEndOfLine` (`<C-v>$A`) and `landCol` (where the cursor ends up).
- `motions.ts`: `fwdWordWalk` (`fwd_word`), `moveWordEndBackward`
  (`bckend_word`), `moveParagraph` (`findpar`) and `moveSentence` (`findsent`).
  The virtual end-of-line position is load-bearing throughout. `MotionContext`
  has `oneMore` (Vim's `one_more`), set only from visual mode.
  `incPos`/`decPos`/`fwdWordWalk` are exported **because `textobjects.ts`
  reuses them** — do not re-implement them there.
- `marks.ts`: marks, the jumplist, and the adjustment both need. The adjustment
  is modelled as *(first differing line, net line-count delta)* — exact for the
  pure insertions and deletions that matter, a deliberate approximation for an
  edit that deletes and inserts at once. It is applied in **`mutate()` as well
  as `commit()`**: `o`/`O` open their line long before `<Esc>`, so a shift
  deferred to `finishInsert` would compare two buffers that both already
  contain the new line.
- `dot.ts`: the `.` record — resolved-command tokens **plus** raw insert
  keystrokes. Count digits are stripped from the tokens and stored separately
  (`Pending.dotKeys` is maintained alongside `keyBuffer` for exactly this),
  because a count on the `.` *replaces* the whole effective count rather than
  multiplying it.
- `textobjects.ts`: objects return an `OperatorRange` directly. The traps, all
  measured: `end_word`'s `stop` flag; quotes are **chained** not paired
  disjointly; `i{` is genuinely linewise when the braces sit on their own lines;
  `di(` searches AHEAD across lines despite `:h ib`.
- `operators.ts`: `OperatorRange` has three kinds — charwise (`end` EXCLUSIVE),
  linewise, and blockwise (`endCol` INCLUSIVE, plus `toEndOfLine` for `$`
  blocks; use `blockRowEnd()` rather than reading `endCol` directly).
- `put.ts`: the register's TYPE decides the shape of a put, not the key.
- `undo.ts`: every node stores `changeStart` (Vim's `uh_cursor`).
- `registers.ts`: uppercase append promotes to linewise if either side is
  linewise, and two blocks stack **ragged**. `forcesNumbered` now covers
  `% { } ( )` and `` ` `` — all of which write **both** `"1` and `"-` on a
  small single-line delete.
- **`MotionResult.forcesNumbered` and `isJump` must both be set on
  `/ ? n N * #` in Wave 4.** The flags exist; only the wiring is missing.

## Harness notes

- `gen.vim` wraps **each group in its own `try`** — E353 raises a catchable
  exception out of `feedkeys`, and one `try` around the whole loop abandoned
  every remaining group.
- Cases that mean to fail declare `expectError: true`. Note that a *beep* is not
  an exception: `u` with nothing to undo reports no error, so declaring one
  there is itself flagged as a problem.
- Reading Vim's `'[` and `']` marks is the fastest way to learn what region an
  operator actually used. A scratch probe harness that reuses `gen.vim` with an
  extra `eval()` hook — for `undotree().seq_cur`, `getpos()`, `getjumplist()` —
  is worth rebuilding on day one of Wave 4; nearly every semantic decision in
  Wave 3 came out of one. **Have it run keys through `keynotation.ts`**, or
  `<Esc>` gets typed into the buffer as literal text.

## Known open edges

- **`proven` is generated but never diffed against the engine** — it is missing
  from `FAMILIES` in `engine.test.ts` because `proven/subst-g` needs `:s`. Add
  it the moment Wave 4 lands; it is easy to assume it is already covered.
- `[[ ]]` section motions are not implemented. `H M L` are **decided**: core
  stays viewport-free and they arrive at M1 fed a window height + topline.
- `o`/`O` with `autoindent` don't copy the indent (baseline is `noautoindent`).
- `curswant` is captured in every golden but not compared. Undo tree, insert
  session, `lastFind`, marks, jumplist and the `.` record are not serialized in
  `EngineSnapshot`. Both deferred deliberately, both tracked in the checklist.
- The blockwise register's WIDTH is not modelled — the comparator maps any
  `\x16…` type to `blockwise` and ignores the width, so a width-only divergence
  would not be caught today.

## What comes next

**Wave 4 — automation.** Macros `q @ @@` with halt-on-error, search
`/ ? n N * #`, command-line mode, ranges, `:s` with `g`/`c` flags and capture
groups, `:g`/`:v`, and `g-`/`g+` undo-tree navigation.

Two things to do before authoring any Wave 4 goldens:

1. **Re-read harness details 4, 6, 7, 9 and 10 in `tools/goldens/README.md`.**
   Detail 4 (macros need `feedkeys`, never `:normal`) and detail 6 (act and
   observe in the same function frame, or every `/ ? n N * #` golden silently
   records an empty search register) are both specifically about Wave 4.
2. Re-enable the `/` register in `compare.ts` — it is skipped today with a
   comment pointing at Wave 4.

Also still open at M0: the fuzz harness (`pnpm test:fuzz` does not exist yet),
the CI workflow, the scripted demo, and `docs/curriculum.md` /
`story-bible.md` / `stage-schema.md`.
