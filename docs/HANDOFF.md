# HANDOFF — after Wave 4d (2026-08-16)

Read this first when continuing work. The plan of record is `MergedPlan.md`;
the tracking doc is `docs/CHECKLIST.md`; the harness gospel is
`tools/goldens/README.md`. This file only carries what those three do not: the
current verified state, and the engine-internals notes a newcomer would
otherwise have to rediscover by reading `state.ts` end to end.

`docs/WAVE3-REPORT.md` is the standalone handoff for Wave 3 — the two bugs it
fixed in existing code, and the two open items below written out in full for a
reader with no context.

---

## Where the project stands

- **Milestone:** M0. Waves 1, 2 and **3 are complete**; **Wave 4 is in
  progress**:
  - 3a–3f (registers, text objects, visual modes, marks/jumplist, dot-repeat,
    the open visual edges) — done, see the Wave 3 notes below
  - 4a `g-`/`g+` undo-tree navigation — done
  - 4b search motions `/ ? n N * #` — done
  - 4c macros `q @ @@` with halt-on-error — done
  - 4d command-line mode, ranges, `:d :m :t :normal :set` — done
  - 4e `:s` substitution, 4f `:g`/`:v`, 4g wrap-up (fuzz harness) — **not started**
- **Oracle:** real Vim 9.1 at `/usr/bin/vim`. Goldens are generated locally and
  committed, so CI never needs Vim.
- **Verified green**, all four commands clean:

```bash
pnpm goldens:generate && pnpm test && pnpm typecheck && pnpm goldens:verify
```

  **1118 goldens, 1168 tests, isolation verified** (every case re-run in its own
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
- `search.ts` / `vimregex.ts`: `/ ? n N * #` are ordinary `MOTION_KEYS` entries
  (`n`/`N`, pure, read `state.searchPattern`) plus a `/`/`?` accumulator shaped
  exactly like `f`/`t`'s single-char wait, just running to `<CR>` instead of
  one key — so both got dot-repeat and operator-pending composition for free.
  `*`/`#` must search from the identified word's OWN start column, not the raw
  cursor column, or a backward search mid-word re-finds the word it is
  standing on instead of skipping past it.
- `macros.ts`: recording is raw keystrokes, mirroring `dot.ts`'s insert-session
  half — replaying `macroText()`'s rendered string back through `tokenize()`
  would be lossy. `macroReplaying` (distinct from `.`'s `replaying`) suppresses
  re-capture into an ACTIVE outer `q` recording without also suppressing `.`'s
  own dot-record — `excmd.ts`'s `:normal` reuses this exact flag for the same
  reason, see below.
- `excmd.ts`: pure like `motions.ts`/`operators.ts` — a range parser, command-
  name resolution, and pure line-splice helpers for `:m`/`:t`. `state.ts` owns
  every side effect. `:` is `pending.awaiting: 'command-line'`, the same shape
  `/`/`?` already use — not a new top-level mode, even though `Mode` has
  carried an unused `'command-line'` variant since M0 (like
  `'operator-pending'`). Two things worth knowing before touching `:normal`:
  - it does **not** shift-adjust its ranged targets the way marks do — measured
    against real Vim, `:1,2normal dd` runs at FIXED line numbers 1 and 2,
    picking up whatever now sits at line 2 after line 1's removal, not the
    original line 2. `clamp()` alone handles a target running off a shrunk
    buffer's end.
  - its inner keys reuse `macroReplaying` (see `macros.ts` above), and MUST
    start from a fresh `pending` — the outer `:...<CR>` left `pending.awaiting`
    at `'command-line'`, and without resetting it the first replayed key
    re-enters that branch and gets appended to the command text instead of
    running.
  - `recordChange` excludes `before.pending.awaiting === 'command-line'`
    outright: an ex command must never become the `.` record itself.

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
  it the moment 4e lands; it is easy to assume it is already covered.
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

**4e — `:s` substitution.** Flags `g`/`c`, capture groups (`\1`–`\9` and `&`),
reusing `vimregex.ts`'s pattern translator from 4b and empty-pattern reuse of
`lastSearch`. This unblocks `proven/subst-g` — add `proven` to `FAMILIES` the
moment it lands.

**4f — `:g`/`:v`.** Depends on 4e (a global's typical body command is `:s`
itself) and on 4d's `:` dispatch/range parsing, both now in place. Re-read
harness detail 13 in `tools/goldens/README.md` before authoring a single
case: `:q`/`ZZ`/`ZQ` must never appear in a `:g` body, even by accident, or
the golden generator can take the whole batch down with it.

**4g — wrap-up.** Sanitize the fuzz alphabet (no `:q :w ZZ ZQ :!`, no shell
escapes — the same hazard detail 13 covers, now for randomly-generated
sequences instead of hand-authored ones) and write the `pnpm test:fuzz`
script, both blocked until now on ex-commands existing to sanitize against.
`pnpm goldens:verify` clean across all `wave4-*` families.

Also still open at M0: the CI workflow, the scripted demo, and
`docs/curriculum.md` / `story-bible.md` / `stage-schema.md`.
