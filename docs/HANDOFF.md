# HANDOFF — M0 + M1 complete, **M2 complete** (2026-08-18)

Read this first when continuing work. The plan of record is `MergedPlan.md`;
the tracking doc is `docs/CHECKLIST.md`; the harness gospel is
`tools/goldens/README.md`. This file only carries what those three do not: the
current verified state, and the engine-internals notes a newcomer would
otherwise have to rediscover by reading `state.ts` end to end.

**M1 (`@vimorror/render`) is done as of 2026-08-17** — all five waves A–E,
against `docs/M1-PLAN.md`. Everything below the header is still about
`vim-core`/M0 and remains accurate; render's own hard-won details live in
`docs/CHECKLIST.md`'s M1 section (the phosphor-accumulator copy, the
`{alpha: false}` trap, `GlyphGrid.invalidate()`, the two-canvas context split)
rather than being duplicated here.

`docs/WAVE3-REPORT.md` is the standalone handoff for Wave 3 — the two bugs it
fixed in existing code, and the two open items below written out in full for a
reader with no context.

---

## Where the project stands

- **Milestone:** **M0 is done** — all four waves complete, plus the scripted
  demo (`tools/demo.ts`) and CI workflow (`.github/workflows/ci.yml`) that
  close it out. See `docs/CHECKLIST.md`'s "M0 done when" for the formal
  criteria, including the 2026-08-16 revision that dropped "fuzz clean over
  10k sequences" as a one-time gate (it's now a continuously-run tool
  instead — see below). Waves 1, 2, 3 and 4:
  - 3a–3f (registers, text objects, visual modes, marks/jumplist, dot-repeat,
    the open visual edges) — done, see the Wave 3 notes below
  - 4a `g-`/`g+` undo-tree navigation — done
  - 4b search motions `/ ? n N * #` — done
  - 4c macros `q @ @@` with halt-on-error — done
  - 4d command-line mode, ranges, `:d :m :t :normal :set` — done
  - 4e `:s` substitution (flags `g`/`c`, capture groups, empty-pattern reuse) — done
  - 4f `:g`/`:v` — done
  - 4g wrap-up — **done**: `tools/goldens/fuzz.ts` (sanitized random
    key-sequence differential testing vs. real Vim, `pnpm test:fuzz`), which
    found and fixed four real engine bugs on its very first runs. See "Wave
    4g — the fuzz harness" below
- **Oracle:** real Vim 9.1 at `/usr/bin/vim`. Goldens are generated locally and
  committed, so CI never needs Vim.
- **Verified green**, all four commands clean:

```bash
pnpm goldens:generate && pnpm test && pnpm typecheck && pnpm goldens:verify
```

  **1153 goldens, isolation verified** (every case re-run in its own Vim process
  and diffed). Nothing is mid-flight. The golden count is unchanged since M0 —
  M1 and M2 added no goldens, and each of their waves re-ran `goldens:verify`
  and confirmed **zero golden bytes changed**. The repo-wide TEST count has
  grown with them, from M0's 1221 to **1467** at M2 Wave E; the per-wave
  arithmetic is in `docs/CHECKLIST.md`.

  `pnpm test:fuzz` is separate from the above and NOT yet clean over a full
  10k-sequence run — it's a live differential tool, not a committed-golden
  check, and still surfaces further candidate mismatches in complex
  multi-atom compositions beyond the four already fixed. This no longer
  blocks M0 (see the revision note above); it stays a permanent, continuously-
  run tool rather than a checkbox. See below.

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
on an empty line yielding `"\n"`. The column is legal only WHILE visual mode is
active: every non-operator exit (`<Esc>`, the `v`/`V` toggle, `:`) clamps the
cursor back onto the last character (measured: real Vim's `v$<Esc>x` deletes
it), while `lastVisual` keeps the raw column so `gv` still reselects out to the
line break — added at M2 Wave C, when an adversarial review caught the engine
no-op'ing where Vim deletes.

## Wave 4g — the fuzz harness

`tools/goldens/fuzz.ts`: random key-sequence differential testing against real
Vim, reusing `generate.ts`'s `runVim` oracle and `compare.ts`'s `runGolden`
comparator unchanged — a fuzzed case is just an uncommitted golden, diffed on
buffer + cursor + registers and thrown away. Batched like `generate.ts` (250
cases per Vim process); 10k sequences run in about a minute. `pnpm test:fuzz
[count]`, `VIMORROR_FUZZ_SEED=n` for a reproducible run. Full design rationale
and the sanitizer writeup are in `docs/CHECKLIST.md`'s 4g entry — this section
only carries the four real bugs it found and fixed, since those are exactly
the kind of engine-internals rule a newcomer would otherwise have to
rediscover by reading the diff.

1. **`gen.vim`'s own setup was leaking a phantom jumplist entry into every
   case.** `:edit!` (used to load each case's buffer) pushes the file's
   opening position onto the jumplist — confirmed with a scratch probe:
   `getjumplist()` right after `:edit!` already holds one entry at line 1,
   before `cursor()` ever runs. A case's very first `<C-o>` therefore popped
   that phantom entry instead of correctly finding an empty jumplist, even
   with nothing the case's own keys did ever having jumped. Fixed with
   `silent! clearjumps` in `s:Setup()`, next to `delmarks!` — a full
   regenerate changed zero bytes of every committed golden, confirming this
   was a pure gap, not a tradeoff.
2. **A counted `iw`/`aw` that overshoots the buffer CLAMPED instead of
   aborting.** `"_9diw` on a short two-line buffer used to delete the entire
   rest of the buffer; real Vim leaves it completely untouched once the count
   can't be satisfied — same "not found aborts the operator" rule as `di(`
   with no bracket, just not one anyone had reason to write a case for. Real
   Vim's cursor still lands wherever the failed internal word-walk got to
   rather than staying put, so `textobjects.ts`'s `ObjectResult` type grew an
   optional `abortCursor`, threaded through `invalid()`'s new optional cursor
   param in `state.ts`.
3. **`+`/`-` beeped on every count overshoot, not just from the boundary
   line.** `j`/`k` (`moveDown`/`moveUp`) already had the right rule — fails
   ONLY when the cursor starts on the last/first line, clamps otherwise,
   mirroring the doubled-operator `cursor_down()` precedent (`2dd` on the
   last line beeps, `9dd` mid-buffer clamps to the end) — but
   `moveLineDownFirstNonBlank`/`moveLineUpFirstNonBlank` had no boundary
   check at all and failed unconditionally past the end. Now mirrors
   `moveUp`/`moveDown` exactly.

### The 2026-08-18 triage pass

`tools/goldens/triage.ts` (`pnpm fuzz:triage`) is the tool 4g's instructions
described but did not build: it sorts mismatches by ATOM COUNT and then
**minimizes** each one, greedily dropping atoms and then buffer lines for as long
as the case still diverges, one batched Vim process per round. A random fuzz
mismatch is a 60-key sequence over a five-line buffer and nearly all of it is
noise; the first run of this reduced one to **`yaW` on `['   ']`**. `IDS=1` prints
just the failing ids, for set-diffing a fix (a net count cannot tell "fixed 5,
broke 2" from "fixed 3").

**One real engine bug fixed from it.** An UNCOUNTED `aw`/`aW` whose forward walk
runs off the end of the buffer aborts — and real Vim still moves the cursor to
wherever the walk got to, exactly as the COUNTED overshoot 4g fixed does.
`textobjects.ts` set `abortCursor` only on the counted path, so `yaW` on a
whitespace-only line left the cursor at column zero where Vim leaves it on the
line's last character. The landing is computable rather than guessed:
`beforeNextWord` never fails and `endWord` fails only when `incPos` reports `-1`,
which happens only at the buffer's last position — so a failed walk always
stopped there. Measured over `['   ']`, `['     ']`, `['ab  ']` and
`['   ', '   ']`: 0:2, 0:4, 0:3, 1:2. Six goldens pin it, and all six fail
without the fix. Set-diffed over a 1500-case sample: **3 fixed, 0 broken.**

**The tell that separates abort from success here is the REGISTER, not the
cursor**, and it is worth knowing before touching this code: `yaW` on `['   ']`
aborts and leaves the register untouched, while `yaW` on `['   ', '']` SUCCEEDS
and writes a charwise register — because **an empty line counts as a word**, so
the forward walk finds one. Both leave the cursor at 0:0 in a successful-looking
way, so a probe that reads only the cursor cannot tell them apart. Two cases in
the hand probe looked like regressions from the fix for exactly this reason:
they were already failing on the register, and the fix only made the existing
error visible in a second field.

**Two bugs isolated but NOT fixed**, both minimized and ready to pick up:

- **`aw`/`aW` aborts where Vim succeeds when the walk crosses onto an empty
  line.** Measured: `['   ', '']` `yaW` yanks charwise in Vim and aborts here;
  `['   ', '']` `daW` deletes both lines linewise in Vim. The cause is
  `endWord`'s `skip(CHAR_BLANK)` treating an empty line's NUL as one more blank
  and walking off the buffer, where Vim's `end_word` takes an `empty` flag that
  makes an empty line terminate the walk successfully. Needs care at Vim-source
  level rather than a guess.
- **A counted `ip` that overshoots CLAMPS instead of aborting** — the same shape
  as 4g's `iw`/`aw` finding, in the paragraph object. `"09dip` on `['   ']`
  leaves Vim's buffer untouched and empties ours, writing three registers Vim
  never writes.

Fuzzing at only a few hundred sequences per run already surfaces further
candidate mismatches beyond these, mostly in complex multi-atom
compositions (visual blockwise register type/width, `iw`/`aw` across several
consecutive blank lines with a count) — not yet individually triaged. `pnpm
test:fuzz` currently exits non-zero over a full 10k run for exactly this
reason; treat that as expected, live state, not a regression, until each one
is either confirmed as a bug and fixed or confirmed as a fuzzer-alphabet
artifact and excluded.

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
- `keys.ts`: **one key is one token, and the plain character wins.** `<lt>`,
  `<Space>`, `<Bar>`, `<Bslash>` and `<gt>` are notation ALIASES that resolve to
  `<`, `' '`, `|`, `\` and `>` — not named tokens of their own — because a
  keyboard delivers the character and a second token for the same key diverges
  from real Vim on whichever side is not the one the engine checks. Adding a
  named alias for a key that already has a printable spelling re-introduces
  that bug; `tools/goldens/keynotation.ts` resolves all five the same way, and
  the two parsers must agree on behaviour even though they share no code.
  `render` is the exact INVERSE of `tokenize` (M3's recorder depends on it) and
  escapes a literal `<` as `<lt>` — but **only when the rendered suffix holds a
  `>` for it to reach**, so `<<` still displays as `<<` in a hint. Fixed at M3
  Wave A; `docs/CHECKLIST.md`'s M3 section has the measurements.
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
- **`:edit!` also pushes a phantom jumplist entry** — the same class of
  per-case setup leak `tools/goldens/README.md`'s detail 8 already documents
  for undo history, just for the jumplist instead: `getjumplist()` right
  after `:edit!` holds one entry at the file's opening line, before
  `cursor()` ever runs. `s:Setup()` now runs `silent! clearjumps` right
  after `delmarks!` — found by fuzzing 4g, when a case's very first `<C-o>`
  (with nothing of its own ever having jumped) popped that entry instead of
  correctly finding an empty jumplist. A full regenerate changed zero bytes
  of every committed golden.

## Known open edges

- `[[ ]]` section motions are not implemented. `H M L` are **decided**: core
  stays viewport-free and they arrive at M1 fed a window height + topline.
- `o`/`O` with `autoindent` don't copy the indent (baseline is `noautoindent`).
- `curswant` is captured in every golden but not compared. Deferred
  deliberately, tracked in the checklist.
- `EngineSnapshot`'s missing history is **closed as of M2 Wave A** — the undo
  tree, `.` record, marks, jumplist, `pcmark`, `lastFind`, macros, `keyPolicy`,
  `visualStart` and `lastVisual` all round-trip now. Still excluded on purpose:
  the **insert session** and an in-progress **`q` recording**, both being
  half-finished commands that a reload does not resume. Three traps if you touch
  this, all of which fail SILENTLY rather than loudly:
  - `UndoState.nodes` is a `Map` and `KeyPolicy`'s sets are `Set`s, and
    `JSON.stringify` renders both as `{}`. The only thing that catches it is
    re-snapshotting a restored engine and diffing the JSON, which
    `engine.test.ts` does.
  - `restore()` rebuilds through the ordinary constructor, so the saved cursor
    gets `clamp(..., allowEndOfLine: false)`. That is wrong for visual mode,
    where `$` legitimately sits on the end-of-line NUL (fact 4 above) — a
    restored `v$` was one character short, and `v$d` stopped joining the next
    line up. Re-clamped with `true` for visual now, mirroring `gv`. A test whose
    selection stops short of the line end cannot see this.
  - a restored `undoState.current` naming a node the save does not contain makes
    every `u` a silent no-op; `rebuildUndo` falls back to the fresh root.
  - **the fourth, added at M2 Wave E: a mid-visual restore lands MID-COMMAND, so
    the keys already spent on the selection have to come back too.**
    `#pendingKeys` was dropped outright on the premise that "a restore lands at
    rest" — which the visual-mode preservation two bullets up had already
    falsified. A restored `v$` then `d` resolved a ONE-keystroke `d` where the
    live engine resolved a three-keystroke `v$d`: buffer, cursor, mode and
    registers all identical, and the SCORE silently cheaper, so a stage saved
    mid-selection came back refunded. `pendingKeys` is now in `EngineSnapshot`
    and is recorded **only in visual mode** — recording it in any other
    half-typed state (insert, replace, an `awaiting` accumulator, a bare count or
    operator) carries a value `restore()` then discards, which breaks round-trip
    idempotence; `session.test.ts`'s locked-key property catches that within one
    run, its counterexample being a bare `2` followed by a locked key. Every
    other in-flight command forfeits its keys with the half-command itself, the
    same rule `feed()` applies to a command aborted by a rejected key — and that
    rule is REUSED for the one overlap rather than restated: `restore()` rebuilds
    `pending` empty even in visual mode, so a selection holding a half-typed
    motion or count (`vf`, `vj2`) loses that half as well, and exactly
    `pending.keyBuffer` is sliced off what gets recorded. `vf` records `v`.
- The blockwise register's WIDTH is not modelled — the comparator maps any
  `\x16…` type to `blockwise` and ignores the width, so a width-only divergence
  would not be caught today.

## What comes next

**All seven Wave 4 sub-waves are done — Wave 4 as a whole is complete, and so
are Waves 1–4.** The engine itself has no more waves queued.

The scripted demo and the CI workflow are both **done**:

- `tools/demo.ts` (`pnpm demo`) — four self-asserting scenes, each restoring
  an engine from a JSON snapshot, running `d2w` / `ci(` / `qa…q@a` /
  `:%s//g`, then serializing the result and restoring a second engine from
  THAT JSON to prove the round trip is lossless. Expected outcomes are taken
  from already Vim-verified goldens, not hand-guessed. Exits non-zero on any
  mismatch.
- `.github/workflows/ci.yml` — `pnpm typecheck` then `pnpm test`. Goldens are
  pre-generated and committed, so this needs no Vim; `goldens:generate`/
  `:verify` and `test:fuzz` all spawn a real Vim process and deliberately
  stay local-only.

**M0 is formally done** — see `docs/CHECKLIST.md`'s "M0 done when" and the
2026-08-16 revision note there and in `MergedPlan.md`, which dropped "fuzz
clean over 10k sequences" as a one-time gate in favor of treating the fuzz
harness as a permanent, continuously-run tool.

That revision doesn't make the remaining fuzz mismatches unimportant — just
non-blocking. Worth doing early in whatever comes after M0:

- **Triage the remaining fuzz candidates.** `pnpm test:fuzz` still exits
  non-zero over a full 10k run — **1828 mismatches of 10000 at seed 1**,
  measured 2026-08-18, so this is a campaign rather than a handful. Use
  `pnpm fuzz:triage`, which minimizes; two already-isolated bugs and the
  measured method are under "The 2026-08-18 triage pass" above. Run it, pick a handful of the shortest
  remaining mismatches (short atom count = least confounded), and for each
  one determine with a scratch probe against real Vim whether it's a genuine
  engine bug (fix it, add a golden, same as this wave's four) or a
  fuzzer-alphabet artifact (exclude the offending combination from
  `fuzz.ts`, document why, same as this wave's `COUNT+'0'` exclusion). Note
  that the `<`/`>` exclusion this list used to name alongside it is **gone as of
  M3 Wave A** — `tokenize` now resolves `<lt>` to `'<'`, which is a self-closing
  spelling with no bare bracket to mis-pair, so the shift operators are fuzzed
  again and immediately added real finds (count-on-shift multiplying the indent,
  `<` over a tab-indented line) to this same backlog. Two patterns worth checking first, since they showed up
  repeatedly: visual blockwise register TYPE (not just the
  already-documented width) coming back linewise/charwise where real Vim
  keeps it blockwise, and `iw`/`aw` with a count spanning several consecutive
  blank/whitespace-only lines.
- `docs/curriculum.md` / `story-bible.md` / `stage-schema.md` — tracked
  separately in `docs/CHECKLIST.md`'s "Docs written at M0" section, never
  part of the formal "M0 done when" gate, but still undone.
- `H`/`M`/`L` — unblocked since M1 Wave A locked `Camera`'s `{topline,
  height}` shape, and deliberately kept OUT of M1 (`M1-PLAN.md` explains
  why: it is pure `vim-core` grammar work touching zero render files).
  **Two things measured on 2026-08-18 that change how it has to be picked up**,
  because this entry used to end "author a golden family" and that is not
  possible:
  - **`H`/`M`/`L` are UNGOLDENABLE with the current harness** — the same class
    as the mode goldens, and for the same reason. Under `-es` there is a
    nominal window (`winheight(0)` reports 23) but it is **never scrolled**:
    after `20G` then `zz` on a 40-line buffer, `line('w0')` stays at 20 and
    `line('w$')` reports 40. Driving real interactive Vim through a Python
    `pty` at the identical 24-row size gives topline 9, botline 31 — and
    **every value differs**: `H` is 9 interactively against 19 under `-es`,
    `M` is 20 against 30, `L` is 31 against 40. So the oracle cannot see this
    feature at all, and the route is 4e's precedent: pin the semantics in a
    hand-written test off a pty transcript, exactly as the sequential
    `:s ... c` confirm behaviour is pinned in `semantics.test.ts`.
  - **The semantics themselves are now measured**, so that probing is done.
    At topline 9 / botline 31 / `scrolloff=0`: `H` → 9, `M` → 20 (the midpoint
    of the visible range), `L` → 31, `3H` → 11 (`topline + count - 1`), `3L`
    → 29 (`botline - count + 1`). Still to probe before writing code:
    `scrolloff`, first-non-blank landing, clamping at the buffer's own ends,
    linewise operator composition, and the jumplist/pcmark push these three
    make as jump motions.

  Worth stating plainly: **nothing consumes `H`/`M`/`L` until M4** puts a real
  camera in front of the engine, so building the viewport plumbing now is
  speculative. The measurements above are the part worth having early, and they
  are recorded so the next attempt does not start by rediscovering that the
  harness cannot help.
- M2 (`@vimorror/game`) has its plan: **`docs/M2-PLAN.md`**, waves A–E.
  **All five waves are done — M2 is complete, and all six of its "M2 done when"
  criteria were swept explicitly at Wave E.** A was the `vim-core` debt M2 rests on
  (`EngineSnapshot`'s missing history and `CommandResolved` never firing for a
  one-key command); B is the stage schema — `packages/game/src/{schema,
  entities,index}.ts`, three hand-authored `content/stages/` fixtures, and
  `pnpm validate:stages`; C is the loop — `tick.ts`, `rules.ts`, `gating.ts`,
  `session.ts`, every fixture now WINNING through `session.feedKeys(stage.
  solution)` head-lessly; D is the dials — `difficulty.ts`, `hints.ts`,
  `scoring.ts`, `gentle.ts`; E is the wrap-up — `GameSession.snapshot()`/
  `restore()`, the director-determinism test one layer up, and the two open
  decisions. `docs/CHECKLIST.md`'s M2 section carries what building each taught. Wave C settled its three inherited decisions — one
  resolved command is one tick (insert session included), entity coordinates
  stay static under buffer edits, and standing in a threat is safe because
  `reached` requires the threat to have MOVED onto the cursor (zero chase gap
  → no move → no reach) — plus one of its own: lose is evaluated before win
  on the same tick. `docs/M2-PLAN.md`'s Wave E entry and `docs/CHECKLIST.md`'s
  "Wave E — wrap-up, and the open-item ledger" hold **every** open item Waves
  A–D found, deferred or left behind, split into what Wave E closed and what is
  deliberately carried past M2. **The second list is where to start on whatever
  comes next**; nothing in it belongs to M2.
- **The three Wave E facts a newcomer would otherwise rediscover the hard way:**
  - **`GameSession.snapshot()`/`restore()` splits state into AUTHORED and
    EVOLVED, and that split is the whole design.** Evolved state is carried: the
    engine, the LIVE entity positions, the four tallies, the outcome, the fired
    beats, and the difficulty and comfort settings — nine things a reload used
    to drop in silence, three of them added by Wave D. Authored state is NOT:
    `win`/`lose`/`beats`/`par`/`solution`/`allowedKeys` are re-read from the
    `Stage` the host passes to `restore()`, so a stage corrected in M3's editor
    re-gates an old save instead of a stale policy living on inside it. `#lose`
    is re-derived by the ordinary constructor rather than becoming a tenth
    carried field. `stageId` guards the seam and **throws** — the one loud
    failure on a surface where everything else fails quietly, because a play
    restored onto the wrong stage runs perfectly and evaluates the wrong
    conditions. `#firedBeats` is a `Set` and JSONs to `{}`, so it travels as an
    array; only a re-snapshot-and-diff test sees that class of failure, which is
    why the keystone has one.
  - **The keystone test earned its cost on its first run**, finding the
    mid-visual keystroke refund written up under "Known open edges" above. The
    shape of it matters more than the fix: every test that already existed
    compared buffer, cursor, mode and registers, and all four matched. What
    diverged was the resolved command's COUNT — which is why the session-level
    test compares **event streams** rather than end state alone (ticks, threat
    moves and beats all travel in the stream, so one equality pins the tick
    count, the live entity positions and the fired-beat set at once). And
    because all 23 new tests passed immediately, they were **mutation-tested**
    rather than trusted: 17 mutants, 16 dead on the first sweep, and the lone
    survivor — the key-policy re-derive, indistinguishable from copying — got
    the one test that separates them. The sweep ended at 19 mutants, zero holes.
  - **Both Wave E decisions came out "don't build it", and the measurements are
    the argument.** No per-stage difficulty override: difficulty is the PLAYER's
    choice, no dial would consume a stage-level one, and "this stage is harder"
    is already authorable in `par`, a `keystrokes-over` budget, threat placement
    and `allowedKeys`. And a replay can still hide an undo from the clean-run
    flag — but the surface is `@`/`:normal` and **not** `.` (measured: `xxu`
    then `.` repeats the `x`, since an undo is not a change and never enters the
    dot record), recording counts its own `u` normally (`qauq` is three resolved
    commands, so only the REPLAY is opaque), and the tempting
    `undoState.current` watch was measured and rejected: it catches a macro body
    of a bare `u` and misses `xu` outright, because the pointer returns to the
    very node it started from while the buffer really was edited and really
    undone. The real fix is core surfacing a replay's inner resolved commands.
- **The four Wave D facts a newcomer would otherwise rediscover the hard way**,
  all measured rather than assumed:
  - **A keystroke budget is a hard fail on `nomagic` ALONE.** `MergedPlan.md`'s
    difficulty table says Normal scores it "not enforced", so the DEFAULT
    session no longer loses to `keystrokes-over` — a behaviour change to Wave
    C, whose two budget tests now name the preset. It reaches `rules.ts` as a
    FILTERED lose list, never a branch: that is what "difficulty is pure
    modifier config" means in practice.
  - **Core already clamps the positions "motions clamp instead of failing"
    names.** `w` past the last word lands on the last character and reports no
    failure at all; `3w` overshooting does the same; `l` at EOL and `h` at
    column 0 have nowhere else to go. So `verymagic`'s motion dial only
    swallows the in-character LINE — the command still resolves, still costs,
    still ticks — and it silences an aborted operator (`dfz`) with it.
  - **Undo detection reads the command SHAPE, and a register prefix reaches
    undo.** `"au` really undoes (the register is ignored, as in real Vim) and
    resolves as `"au`, so `isUndoCommand` strips counts AND register prefixes
    in any order. `U` is an unknown key here and `:undo` an unknown command, so
    the complete list is `u`, `<C-r>`, `g-`, `g+`.
  - **A suppressed beat is marked FIRED.** Gentle Mode and the jump-scare
    toggle filter at the emission point only, so buffer, ticks, entities, score
    and outcome are identical either way — which is what lets one player's
    replay reproduce under another's comfort settings.
- **M3 (`apps/editor`) has its plan: `docs/M3-PLAN.md`**, waves A–E, same shape
  as M1's and M2's. **Wave A is done as of 2026-08-18** — the two debts M3 rests
  on, both in packages rather than `apps/`: `keys.ts`'s `render`/`tokenize`
  round trip (see the `keys.ts` bullet under "Engine architecture notes" above)
  and `schema.ts`'s `StageInput` export, the AUTHORED shape an editor must edit
  instead of the parsed `Stage`. Zero golden bytes changed and the fuzz
  mismatch count is unmoved at a fixed seed. Waves B–E are the editor app
  itself, and the plan's five verified-against-source facts are the part worth
  reading before picking it up — two of them REMOVE work the older plan docs
  still list (the stage validator already shipped; no Zustand).
- **The adversarial review Wave A left unfinished is now done** — re-run at
  Wave C with its four missing lenses plus fresh ones on the loop code: 16
  confirmed findings (every one adversarially verified, plus 2 re-verified by
  hand), all fixed in the same change. The full list is in
  `docs/CHECKLIST.md`'s Wave C section; the headline ones were `<Esc>` being
  lockable (the shipped act2 fixture soft-locked the player in insert mode on
  a key it teaches), a macro halted by a locked inner key mutating the buffer
  while resolving nothing, a mid-insert snapshot whose undo tree lost the
  saved text, and `qa@aq` + `@a` crashing the engine with a stack overflow.

No open design questions carry over from 4f — the one item 4e's handoff
flagged as unresolved (whether `:g` containing `:s ... c` is worth
supporting) is now answered: rejected outright, by design, see the `:g`/`:v`
orchestration notes above.
