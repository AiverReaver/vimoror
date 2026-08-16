# HANDOFF — after Wave 4f (2026-08-16)

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
  - 4e `:s` substitution (flags `g`/`c`, capture groups, empty-pattern reuse) — done
  - 4f `:g`/`:v` — done
  - 4g wrap-up (fuzz harness) — **not started**
- **Oracle:** real Vim 9.1 at `/usr/bin/vim`. Goldens are generated locally and
  committed, so CI never needs Vim.
- **Verified green**, all four commands clean:

```bash
pnpm goldens:generate && pnpm test && pnpm typecheck && pnpm goldens:verify
```

  **1150 goldens, 1218 tests, isolation verified** (every case re-run in its own
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
- `subst.ts`: `:s`'s own module, deliberately NOT folded into `excmd.ts` —
  the file header there already scopes it out ("commands that don't need
  substitution logic"). Pure, like `motions.ts`/`search.ts`: a delimiter-based
  argument grammar (any punctuation but letters/digits/`\ " |` as delimiter;
  an escaped delimiter survives as a literal character in both pattern and
  replacement), matching built directly on 4b's `vimregex.ts` — which already
  turns `\(`/`\)` into real JS capture groups, so this module only adds the
  REPLACEMENT-side escapes (`&`/`\0` → whole match, `\1`–`\9` → capture group,
  `\\x` → `x` literally). `findNextMatch` is the one function `state.ts`'s
  confirm loop calls repeatedly; the eager (`g`-only) path never touches it,
  going straight through `substituteRange`'s single pass instead.
- `state.ts`'s `:s` orchestration — measured with a scratch probe before
  writing any code, several results refuting a first guess:
  - the pattern (resolved — empty reuses `state.searchPattern`) writes
    `searchPattern` AND `searchDirection: 'forward'` AND the `"/` register
    unconditionally, even on total failure, mirroring `/`'s own early-write.
    Dropping the `searchDirection` write is the easy mistake: a bare `n`
    right after a FAILED `:s` still needs to repeat the pattern it just
    recorded, and `n`/`N` refuse to move at all when `searchDirection` is
    `undefined` — caught by a golden, not anticipated.
  - unlike `:d`, `:s` writes NO other register — confirmed via probe that
    the replaced text never touches `"`/`"1`.
  - undo mints a node only once a substitution actually lands (E486 mints
    nothing) — `:s`'s `u_save` is deferred past the search, unlike `p`'s,
    which runs before the register lookup that can fail. Cursor on success is
    the first non-blank of the LAST line that actually changed, not
    `range.last`; `changeStart` (`u`'s landing spot) is the range's FIRST
    line, matching `doExDelete`/`doExMove`.
  - the `c`-flag confirm loop is `pending.awaiting: 'confirm-subst'`, the same
    shape `command-line`/`search` already use, carrying a `SubstJob` (fixed
    params + running tally + the ONE match currently up for a decision).
    `y`/`l` splice via `mutate()` (no undo block yet, exactly insert mode's
    session pattern) and search onward; `a` loops the same splice-and-search
    internally without re-entering the pending machinery, so it can resolve
    an entire multi-line range from ONE key. **The oracle can only drive ONE
    confirm response correctly per `:s` invocation** — a genuine `-es`/
    `feedkeys` limitation, confirmed against a real pty (see harness notes
    below) — so the sequential `y`/`n`/`a` behavior across several matches is
    pinned in `semantics.test.ts` instead of a golden.
- `state.ts`'s `:g`/`:v` orchestration (`doExGlobal`) — measured against real
  Vim 9.1 with several scratch probes, three results contradicting the
  original design sketch's own default assumptions:
  - **undo is coalesced into ONE node for the whole command**, not one per
    processed line — measured with `undotree().seq_cur`: a single `u` fully
    restores every line `:g/a/d` deleted at once, and a second `u` press is a
    true no-op with nothing left below it. This is the one point where `:g`
    diverges from every other multi-step feature in this file, which mints a
    node per edit. The fix is NOT routing every sub-command through `mutate()`
    (the design sketch's fallback plan) — each body invocation is left to
    self-`commit()` into a scratch copy of the state exactly as it would
    standalone, registers-and-all, and only that scratch copy's OWN N-node
    undo chain is discarded at the end in favor of one `pushUndo` bridging the
    ORIGINAL undo tree straight to the final buffer. Marks/jumps/pcmark are
    NOT rebuilt from a single before/after diff the way undo is — a
    scattered, non-adjacent edit set (`:g/[ace]/d` on `a b c d e`) proves a
    single `lineShift(before, after)` computes the WRONG final position for a
    mark that survived (verified by hand: it would land two lines short) — so
    those three fields are carried forward from the scratch copy's own
    already-correct incremental shifting instead, and only undo/pending get
    overwritten.
  - **a per-line body failure never aborts the loop** — confirmed for both an
    ordinary `:s` pattern-not-found (E486) and a nested `:g`/`:v` (E147):
    every originally-matched line is visited regardless, and in real Vim the
    nested-global exception only ever escapes AFTER the whole loop finishes,
    never mid-loop. This engine goes one step further and never surfaces an
    aggregate failure for the outer call at all — deliberately simpler than
    replicating Vim's actual split, where a nested global whose OWN cmdline
    carries an explicit range throws E147 but a rangeless one is a true
    silent no-op (verified: zero exception, zero buffer change, either way).
    Both collapse to the same immediate `invalid-global` rejection here,
    thrown on every attempt regardless of whether it carries a range.
  - **a confirm-flagged `:s` body is rejected up front, before touching
    anything** — no cursor move, no match scan, nothing. This is the one
    spot the design sketch flagged as "pending" that a probe fully resolved:
    real Vim genuinely DOES drive its confirm loop from inside `:g` (the
    cursor walks to the last matched line even when nothing ends up
    confirmed, because the harness's `-es` stdin runs dry mid-prompt with no
    response queued) — but since this project's oracle already cannot drive
    one plain `:s ... c` session past its first response (4e's own finding),
    asking it to drive one from inside `:g` on top of that is unmeasurable.
    Failing loudly and completely, rather than silently reproducing whatever
    partial state the harness happened to leave behind, is the deliberate
    choice — and it makes this one case impossible to pin as a golden (real
    Vim's cursor move vs. this engine's total no-op is a genuine, permanent
    divergence), so it is pinned directly in `semantics.test.ts` instead.
  - the matched-line set is a `K.Marks`-shaped record keyed by ascending
    numeric strings, built once before the body ever runs — `Object.entries`
    hands back the earliest remaining entry for free, `K.adjustMarks` drops
    an entry whose own line a prior iteration's edit already swept away
    (Vim's own mark-based skip), and a body that inserts new lines never
    grows the set, so newly-created lines are never visited. All three fall
    out of reusing `marks.ts`'s existing machinery — **except one shape it
    cannot represent**, caught only by hand-testing against the exact
    scenario the design brief flagged as a priority (a `:m`/`:t` body):
    `K.lineShift`'s "first differing line + net delta" model reads a
    net-ZERO-delta edit as "nothing moved," which is wrong for a body that
    REORDERS lines without changing their count — `:g/x/m$` on a
    scattered-match buffer silently mispositioned every match after the
    first. `remapMatchedByContent` (next to `doExGlobal`) is the fallback:
    a real line-content LCS between before/after, used only when
    `K.lineShift` returns `null` for a genuinely-changed buffer, so a
    reordered match is followed to its new index instead of ignored.
    Approximate only for genuinely duplicate-content lines, where content
    alone can't disambiguate identity — real Vim's line-pointer tracking has
    no such gap.
  - the pattern (resolved — empty reuses `state.searchPattern`) writes
    `searchPattern`/`searchDirection: 'forward'`/the `"/` register
    unconditionally, mirroring `:s`'s own early-write, and BEFORE checking
    whether anything actually matched — zero matches is then a silent no-op
    in real Vim (confirmed: no exception, no message, unlike `:s`'s E486),
    which this engine represents as the existing `pattern-not-found`
    rejection reusing `state`'s already-pattern-written copy, so the
    resulting buffer/cursor state matches even though internally it is
    modelled as a failure.
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
- **`feedkeys(..., 'xt')` cannot drive more than one `:s ... c` confirm
  response per invocation.** Found in 4e with a scratch probe: five `y`
  keystrokes against five matches on one line produced only ONE replacement,
  with `mode()` still reporting `c` afterward — later responses aren't
  misapplied, just silently dropped. Confirmed as an `-es`/`feedkeys` artifact
  rather than real Vim by driving actual interactive Vim through a Python
  `pty`: the identical five keystrokes there produced all five replacements
  and Vim's own "5 substitutions on 1 line" message. This is the pty-oracle
  candidate Wave 3e's decision flagged as unresolved — it turned out to be
  `:s`'s confirm flag, not macros — and the decision held: goldens stay
  restricted to single-response-resolving confirm cases, and the sequential
  behavior is pinned in `semantics.test.ts` off the pty transcript instead of
  building a pty oracle. `docs/CHECKLIST.md`'s harness-limitations section has
  the full writeup.

## Known open edges

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

**4g — wrap-up**, the last M0 wave. Sanitize the fuzz alphabet (no
`:q :w ZZ ZQ :!`, no shell escapes — the same hazard harness detail 13
covers, now for randomly-generated sequences instead of hand-authored ones;
`:g`/`:v` bodies are exactly the shape most likely to embed one of these by
accident, per that detail's own warning, so the sanitizer must reject them
inside a `:g` body too, not just at the top level) and write the
`pnpm test:fuzz` script, both blocked until now on ex-commands existing to
sanitize against. `pnpm goldens:verify` clean across all `wave4-*` families
(already true as of 4f; keep it true). No open design questions carry over
from 4f — the one item 4e's handoff flagged as unresolved (whether `:g`
containing `:s ... c` is worth supporting) is now answered: rejected
outright, by design, see the `:g`/`:v` orchestration notes above.

Also still open at M0: the CI workflow, the scripted demo, and
`docs/curriculum.md` / `story-bible.md` / `stage-schema.md`.
