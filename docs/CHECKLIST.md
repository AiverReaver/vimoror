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
- [x] CI workflow — `.github/workflows/ci.yml` runs `pnpm typecheck` then
      `pnpm test`. Goldens are pre-generated and committed, so vitest diffs
      against the committed JSON; `goldens:generate`/`:verify` and
      `test:fuzz` all spawn a real Vim process and deliberately stay
      local-only, never invoked in CI

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
- [x] **≥400 cases** — **1153 committed.** proven 7 · wave1 115 (incl. two
      `+`/`-` count-overshoot cases found by fuzzing) · wave2 492 across 8
      families (caseops 62, change 55, delete 79, doubled 55, indent 59,
      insert 69, shortcuts 55, yank 58) · wave3 427 across 7 families (paste
      62, textobj 107 — incl. one count-overshoot case found by fuzzing,
      visual 66, motions 60, visualops 51, marks 45, dot 36) · wave4 112
      (undotree 8, search 29, macros 18, excmd 25, subst 20, global 12)
- [x] **`proven` is now diffed against the engine.** Added to `FAMILIES` in
      `engine.test.ts` the moment `:s` landed (Wave 4e) — `proven/subst-g` was
      the one case blocking this, and it passes unchanged.
- [x] `expectError: true` per case, for a case that MEANS to fail. An
      undeclared error is a reported problem, and so is a declared one that
      did not happen — a case written to pin a failure that quietly started
      succeeding is exactly as wrong as the reverse
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
      make more than one change must use the `keys:` list form.
- [x] **Decided at Wave 3e: no pty oracle.** The group form carried dot-repeat
      without trouble — all 36 `dot` goldens generated and passed first time,
      including `['dw', '3.', '.']` — because the redo state survives between
      groups (they share one `s:RunAndCapture` function frame, harness detail
      6). The group form plus engine-side mode assertions is sufficient through
      M0. Revisit only if Wave 4's macros need it, which is the one remaining
      candidate.
- [x] **The candidate that actually needed a pty turned out to be Wave 4e's
      `:s ... c`, not macros.** A scratch probe (instrumenting `undotree()`
      between individual confirm responses, same technique as the macro probe)
      found that `feedkeys(keys, 'xt')` drives only the FIRST `y`/`n`/`a`/`q`/`l`
      response of a `:s` confirm session correctly — every later response in
      the same invocation is silently dropped, not misapplied, just gone: five
      `y` keystrokes against five matches on one line produced only ONE
      replacement, with `mode()` still reporting `c` afterward. Confirmed as an
      -es/feedkeys artifact rather than real Vim by driving actual interactive
      Vim through a Python `pty` — the identical five `y` keystrokes there
      produced all five replacements and Vim's own "5 substitutions on 1 line"
      message. **Decision held rather than reopened:** goldens are restricted
      to single-response-resolving `:s ... c` cases (`q`/`<Esc>` immediately, a
      lone match answered once, `a` — which by definition never needs a second
      prompt); the sequential multi-response behavior is pinned in
      `semantics.test.ts` instead, transcribed from the pty session, exactly
      the established "oracle structurally cannot express it" remedy already
      used for empty-register writes and `:q`/`ZZ`.
- [x] **Wave 4 macros needed a harness fix, but not the pty oracle above.**
      `feedkeys(keys, 'x')` correctly toggles `reg_recording()` on `q{reg}`,
      but the register comes back EMPTY — only the recording STATE is
      tracked, the keystrokes are never actually captured. Found with the
      scratch probe harness HANDOFF.md recommended building on day one of
      Wave 4 (instrumenting `reg_recording()`/`getreg()` between individual
      keys). Fix: `feedkeys(keys, 'xt')` — the `t` flag ("handle keys as if
      typed") is what real recording needs. A full regenerate with `'xt'`
      changed ZERO bytes of every already-committed golden (verified via
      `git diff` before committing the change), so this was a silent gap,
      not a tradeoff — every prior golden was already correct, macros were
      just unreachable. `gen.vim` and `README.md` detail 4 updated.
- [ ] **A beep is not an exception.** `u` with nothing to undo, a failed motion
      and `d<C-o>` all beep silently and report NO error, so `expectError: true`
      on them is itself flagged as a problem. Only some failures (E20, E353)
      raise catchable exceptions. There is no way to tell from the case which
      you will get — generate and see.
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
- [x] **Some failures raise a catchable exception out of `feedkeys`, not just a
      beep** — E353 among them. `gen.vim` had ONE `try` around the whole group
      loop, so a throwing group abandoned every group after it and silently
      defeated the line above: the follow-up keys were in their own group and
      still never ran. Fixed to a per-group `try` that accumulates messages.
      Found in Wave 3; no existing golden changed, because none of them ever
      threw

### Engine — four waves

**Wave 1 — substrate + motions** `[x]`

- [x] Buffer, position math, `desiredCol` through short lines
- [x] Key tokenizer (independent of the harness's own notation parser, on
      purpose — one shared parser could mis-decode both sides identically)
- [x] Mode machine, cursor clamping (normal vs insert differ by one column)
- [x] `hjkl 0 ^ $`, `gg G {n}G`, `w b e W B E ge gE`, `f F t T ; ,`, `%`, `+ - _`
- [x] **`{ }` paragraph and `( )` sentence motions** — the Wave 1 done-line
      covered `+ - _` and `%` and quietly skipped these; found while auditing
      after Wave 3c and closed with Wave 3d, since both are JUMP commands and
      the jumplist needed them. Faithful ports of `findpar` and `findsent`;
      60 `motions` goldens. Both set `forcesNumbered`, confirmed: a delete over
      either writes **both** `"1` and `"-` even when it is a small single-line
      delete. What an intuitive implementation gets wrong:
      - a paragraph boundary is a genuinely **empty** line, not a blank one —
        `}` walks straight past `"   "`. A leading form feed IS a boundary.
        (Vim also honours nroff macros from 'paragraphs'/'sections'; that
        option is not modelled and is documented as such rather than faked)
      - `findpar`'s `did_skip` refuses any boundary until the walk has passed a
        non-empty line, so `}` from inside a run of blanks clears the whole run
      - running off the end of the buffer only FAILS while counts REMAIN. A
        bare `}` at the end succeeds and does not move, so `d}` there runs a
        degenerate region and mints an undo node, while `d2}` aborts and mints
        none. Same for `{` at the start
      - landing on the LAST line pulls the cursor onto its last character and
        makes the motion **inclusive** — but only going FORWARD. `{` on a
        one-line buffer also "lands on the last line" and stays exclusive at
        column zero, which is why the rule is coded as forward-only
      - `a.b.c` is ONE sentence: the dots have no whitespace after them. Any
        run of `)]"'` may sit between the terminator and the whitespace
      - `(` from mid-sentence goes to THIS sentence's start; from its exact
        first character it goes to the previous one
- [ ] `[[ ]]` section motions — still open, and not on Wave 3's path
- [x] **`H M L` — decided, deferred to M1.** They are screen-relative and
      `vim-core` has no viewport *by design*, so they cannot be implemented
      here without importing a renderer concept the renderer does not yet
      define. **The decision: core stays viewport-free.** `H M L` need a window
      height + topline supplied by `@vimorror/render` at M1, at which point they
      become a thin motion over data core is handed rather than data core owns.
      Recorded here so M1 inherits it as an input instead of re-opening it
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
- [ ] Undo tree, insert session, `lastFind`, marks, the jumplist and the `.`
      record are **not serialized** in `EngineSnapshot` — a restored engine
      starts with the snapshot as its undo root and with no marks or repeatable
      change. Deferred and documented in `engine.ts`; revisit before the M0
      scripted-demo done-line, which round-trips through a JSON snapshot

**Wave 3 — memory** `[x]` — registers/paste, text objects, visual modes,
marks + the jumplist, and `.` dot-repeat all landed and green

- [x] Registers end to end: `"0`, `"1`–`"9` **with correct shift-on-delete**,
      `"a`–`"z`, `"A`–`"Z` append, `"_` blackhole, `"-` small delete. The WRITE
      side landed in Wave 2; Wave 3a added the READ side and pinned both ends
      against Vim with 62 `paste` goldens
- [x] `p P` charwise and linewise, with counts, every register class, and the
      cursor rules — which are **not uniform**: a single-line charwise put lands
      on the LAST character put (this is what makes `xp` transpose), a
      multi-line charwise put lands on the FIRST, and a linewise put lands on
      the first non-blank of the first line put
- [x] **The three states of a register, which Vim distinguishes and most engines
      collapse into two.** UNSET (never written) raises E353 and puts nothing;
      WRITTEN-BUT-EMPTY puts zero characters and reports nothing at all; holding
      text is the ordinary case. `"_` reads back as written-but-empty, *not* as
      unset — so `"_p` is a silent no-op rather than an error. A register
      holding one empty LINE is in the third group, not the second: its text is
      a bare `"\n"` and putting it really does open a blank line
- [x] **A put ALWAYS mints an undo node**, measured with `undotree().seq_cur` —
      including from `"_`, from an empty register, and on the E353 path where it
      reports an error and changes nothing. This **refines** the Wave 2 rule
      rather than contradicting it: what decides the node is not "ran versus
      failed" but whether the command reached its `u_save` before bailing.
      `~` on an empty line beeps in `nv_tilde` BEFORE any save and mints
      nothing; `p` from an unset register bails inside `do_put`, AFTER the save,
      and mints one. Three goldens pin it, each one a `u` that burns on the
      put's own do-nothing node instead of reaching the change before it
- [x] Blockwise `p P` — implemented in `put.ts` (splice at one column across
      successive lines, space-padding short lines). Pinned once `<C-v>` landed
      in Wave 3c and gave it a producer, and again by the visual-`p` cases in
      Wave 3f
- [x] Text objects: `iw aw iW aW i" a" i' a' i( a( i[ a[ i{ a{ i< a< it at ip ap`,
      plus the aliases (`ib`/`ab` = `i(`/`a(`, `iB`/`aB` = `i{`/`a{`, and either
      half of a pair names the pair). 106 `textobj` goldens. An object is not a
      motion — it names its region outright — so `textobject.ts` returns an
      `OperatorRange` and `runOperator` takes it directly
- [x] Semantics measured off real Vim while building these, every one of which
      an intuitively-written implementation gets wrong:
      - `i{` is genuinely **linewise** when the braces sit on their own lines, so
        `di{` removes the body LINE and `yi{` yields a linewise register. Nothing
        in the keys says so; the shape of the text decides
      - a linewise **object** pulls the cursor to column one (`yip`, `yi{`) while
        a linewise **motion** leaves the column alone (`yy`, `y_`). Same range
        kind, different rule — only the object has a real start column. Trying to
        unify them broke `y_`, which is why `runOperator` takes a `fromObject` flag
      - `end_word`'s `stop` argument, which `current_word` passes and `e` does
        not: without it `diw` on the `.` of `foo.bar` takes `.bar`
      - `iw` on an empty line is a **real zero-length region, not a degenerate
        one** — so `yiw` writes an empty register while `diw` mints no undo node.
        This is the same split Wave 2 drew between `D` and `dl` on an empty line
      - `iw` on an empty **last** line is not empty at all: `fwd_word` cannot
        advance, so Vim's `decl` reaches BACKWARD onto the previous line's last
        character, and `op_delete`'s promotion then turns that into whole lines.
        `aw` there genuinely fails instead, because `end_word` fails
      - **quotes are CHAINED, not paired off disjointly.** Candidates are every
        consecutive pair of quotes, so the gap between two strings is itself a
        quoted object and `di"` from the `x` in `"one" x "two"` deletes ` x `.
        Stepping by two looks more sensible and is wrong
      - `di(` finds a block AHEAD of the cursor, across lines. `:h ib` says the
        cursor must be inside the block; the code disagrees
      - a not-FOUND object aborts the operator and mints nothing; a found-but-EMPTY
        one is degenerate and still runs, which is why `ci(` on `()` types between
        the brackets
- [x] **`.` dot-repeat** — 36 `dot` goldens, all green on first generation.
      Built as an explicit recorded-change record, never as raw-keystroke
      replay of what was typed: `f,x` repeats only the `x`, while `df,` repeats
      the whole delete *including a fresh search for the next comma*. Those two
      cases are the pair that make the design forced rather than chosen.
      - the record has two halves, per the Wave 2 refinement: the resolved
        command's tokens PLUS the insert session's raw keystrokes. The insert
        half genuinely IS key replay — `iabc<BS>Z<Esc>` replays the `<BS>`, not
        the net text it produced
      - **a count typed on the `.` REPLACES the whole effective count** rather
        than multiplying it: `2d3w` deletes six words and `2.` after it deletes
        two. So the count is stored apart from the keys, and the keys are
        recorded with every count digit stripped — which is why `Pending`
        carries `dotKeys` alongside `keyBuffer`
      - a new count then STICKS for the following `.`
      - `y` is not a change (the buffer does not move), so `x yw .` repeats the
        `x`. Neither is `u`/`<C-r>`: `dw u .` re-does the delete
      - a visual change repeats by **shape** at the new cursor. A single-line
        charwise selection keeps its WIDTH; a multi-line one keeps the absolute
        column it ended on. Vim splits these in `redo_VIsual` and so does
        `dot.ts`
      - the replay runs back through `step()` rather than through a parallel
        implementation, so a repeated command cannot drift from a typed one; a
        `replaying` flag stops it re-recording itself
      - the recorder sits OUTSIDE the reducer and watches what a key did, so a
        command added later cannot silently forget to be repeatable
- [x] Blockwise register append (`"A` onto a blockwise value) — two blocks
      STACK, and **ragged**: the rows are NOT padded out to a common width.
      Authored guessing the opposite and refuted on first generation; it is the
      register's own recorded width that restores the rectangle on put.
      Linewise still wins when a block is appended onto a linewise value
- [x] Visual modes `v V <C-v>`, with mode switching (`v` then `V` promotes the
      selection you already had to whole lines), `o` to swap ends, counts,
      motions, `f F t T`, text objects, and the operators `d x y c s > < ~ u U
      gu gU g~` plus the force-linewise `D X Y C S R`. 66 `visual` goldens.
      Visual mode needs no motion code of its own: the anchor is fixed, the
      cursor moves, and every Wave 1 motion extends the selection for free
- [x] A third range kind — `blockwise` — since `<C-v>` is the only thing in Vim
      that produces a rectangle. This is what finally pinned the blockwise
      `p`/`P` written in Wave 3a, which had no producer to test against
- [x] Blockwise semantics measured off real Vim:
      - a blockwise **shift** is the one exception to "indent is always
        linewise": it inserts the whitespace at the BLOCK's own left column, so
        `>` on a block at column one gives `a    bcd`, not `    abcd`. And a
        count in visual mode multiplies the SHIFT (`2>` moves two shiftwidths),
        unlike normal mode's `2>>` where the count means two LINES
      - a row that REACHES the block's left column contributes its own slice to
        the register even when empty; a row that stops SHORT contributes a full
        block width of spaces. Identical for `d`, `y` and `c`
      - blockwise `c` types on the FIRST row only and replicates on `<Esc>`,
        skipping rows too short to reach the column. That lives in the insert
        session, not in the operator, which is also how `<C-v>I`/`A` will work
      - the explicit register has to survive the visual→normal transition, or
        `v"ay` silently writes unnamed instead of `"a`
- [x] **The visual-mode edges closed** — `<C-v>I`/`A`, `p` and `r` over a
      selection, `gv` reselect, and `$`-to-end-of-line blocks. 51 `visualops`
      goldens. What had to be measured rather than reasoned out:
      - **`<C-v>I` SKIPS a row too short to reach the block's column; `<C-v>A`
        PADS it out with spaces.** Same block, opposite treatment — and it is
        why `<C-v>$A` is the idiom for appending to every line: with `$` the
        column is each row's own end, so no row is ever short
      - a typed line break abandons replication entirely: only the first row
        gets the text
      - after a block `I`/`A` the cursor returns to the **block's left edge**,
        which for `A` is nowhere near where the typing happened. Block `c` does
        NOT do this — it ends on the last character typed, like any other
        insert. A one-character insert hides the difference, so the goldens
        type two
      - **`$` in visual mode parks the cursor ON the end-of-line NUL**, which
        no other motion does (`l` refuses it without 'virtualedit'). An
        inclusive selection ending past the line then takes the LINE BREAK, so
        `v$d` joins the next line up while `vlld` over the same three
        characters leaves an empty line behind. MAXCOL survives `j`/`k`
      - the same rule explains a selection on an EMPTY line: column zero there
        already IS the end-of-line position, so `v` alone yields `"\n"`
      - visual `p` overwrites the unnamed register with the text it just
        removed; visual `P` deliberately does not, which is what makes `viwP`
        repeatable over several words. The register is read BEFORE the delete
      - a LINEWISE register put into a charwise hole SPLITS the line open, head
        and tail becoming lines of their own around the register's content
      - `op_delete`'s linewise promotion is skipped in visual mode
        (`!oap->is_VIsual`). The buffer is identical either way and only the
        register's TYPE differs, so this stays invisible until something puts
        it back
      - `gv` from inside visual mode SWAPS the stored and current selections
      - visual `r` never replaces line breaks, and ignores a count
- [x] **Marks `m` `` ` `` `'`, plus `<C-o>`/`<C-i>`** — 45 `marks` goldens.
      `m` is neither a change nor a jump: it mints no undo node and pushes
      nothing. `` ` `` is charwise-exclusive and lands on the exact column;
      `'` is linewise and lands on the first non-blank. `` ` `` is on the
      `forcesNumbered` list, `'` does not need to be (linewise always shifts)
- [x] **Mark ADJUSTMENT, which is the half that is easy to skip.** A mark is a
      position in a buffer that keeps changing underneath it:
      - insert a line above → the mark moves down; delete above → it moves up
      - **delete the mark's own line and the mark is DESTROYED, not relocated.**
        A later jump raises E20, indistinguishable from never having set it.
        An implementation that only shifts passes every other case in the file
        and fails this one, which is why it has its own golden
      - an edit that leaves the LINE COUNT alone moves nothing — deleting a
        character before a mark does not drag its column
      - jumplist entries take the same shift but the OPPOSITE deletion rule:
        an entry inside a deleted range CLAMPS to the start of the deletion
        rather than being dropped, so the list never develops holes
      - the shift is applied in `mutate()` as well as `commit()`. `o`/`O` open
        their line long before `<Esc>`, so a shift deferred to `finishInsert`
        compares two buffers that both already contain the new line and
        concludes nothing moved
      - **Modelled as (first differing line, net line-count delta).** That is
        exact for the pure insertions and deletions marks care about, and a
        deliberate approximation for an edit that deletes and inserts at once
        (`2cc`), where Vim adjusts against the real removed range rather than
        the net one. The goldens pin the net-shift behaviour that results
- [x] Jumplist semantics measured off real Vim:
      - jumps are `G gg { } ( ) %` and the two mark jumps. `w`, `j`, `$` and
        `x` are **not** jumps. A jump records its origin even when it lands
        where it started (`3G` on line three still pushes) and even with an
        operator pending (`d}` pushes)
      - the first `<C-o>` after a jump APPENDS the present position before
        stepping back, which is the only reason `<C-i>` has anywhere to return
        to — and it is why one `<C-o>` grows the list by one
      - duplicate entries are removed by LINE, keeping the last occurrence,
        on the way out rather than on push. Columns are not compared
      - `<C-o>`/`<C-i>` are commands, not motions: an operator pending makes
        them beep rather than jump. `<C-i>` and `<Tab>` are the same key
- [ ] Marks, the jumplist and the previous-context mark are **not serialized**
      in `EngineSnapshot`, alongside the undo tree / insert session / `lastFind`
      already listed below. Same deferral, same revisit point
- [ ] Recorded macros (`EditorState.macros`, `recording`, `lastMacroReg`) are
      likewise **not serialized** in `EngineSnapshot` — same deferral

**Wave 4 — automation** `[x]`

Seven sub-waves, ordered by dependency. `4a`–`4c` are mutually independent
and independent of the ex-command chain; `4d` → `4e` → `4f` build on one
another in that order, since `:s`/`:g` need the `:` dispatcher and ranges
first, and `:g`'s typical body command is `:s` itself. `4g` is wrap-up once
the rest is green. New case files follow the existing
`wave{N}-{family}.yaml` convention (`tools/goldens/cases/`); `engine.test.ts`'s
`FAMILIES` gains one entry per family as it lands. Inventory taken against
current code (2026-08-15): **no `macros.ts`, `excmd.ts`, or `search.ts` exist
yet** — Wave 4 starts from zero scaffolding, not partial stubs.

- [x] **4a — `g-`/`g+` undo-tree navigation.** `undoToSeq()` in `undo.ts`
      jumps straight to the node with id `current ± count` (ids are already a
      global creation sequence). Measured against real Vim 9.1 via a scratch
      probe: it is NOT a parent/child hop — crossing into a sibling branch is
      normal, and the cursor rule composes `undo()`'s/`redo()`'s own per-hop
      rule along whichever shape the real tree-walk to that node would take
      (departing node's `changeStart` if the target is a straight-line
      ancestor of the current node, target's own `changeStart` otherwise,
      since the last hop of the walk redoes into it). Confirmed on real Vim
      across a sibling-branch jump and a count-prefixed jump that crosses both
      a branch and a generation in one step — both landed exactly where the
      probe predicted, first generation. `-`/`+` are shared with `d-`/`c-`
      motions, so the dot-repeat exclusion (`state.ts` `recordChange`) checks
      the joined `g-`/`g+` two-key sequence rather than the bare key, unlike
      `u`/`<C-r>`'s single-key `NEVER_RECORDED` entries. 8 `wave4-undotree`
      goldens, all green on first generation.
- [x] **4b — Search motions `/ ? n N * #`.** `vimregex.ts` translates Vim's
      default 'magic' regex to JS (`( ) + ? = { } |` need a backslash to be
      special, `. * [ ] ^ $` don't; `\d \s \w`-style classes, `\<`/`\>` word
      boundaries via `\b`, inline `\c`/`\C`, `ignorecase`/`smartcase` — `\v`
      very-magic and lookaround are out of scope, documented in the file
      header). `search.ts` does the actual line-by-line scan with wraparound.
      `n`/`N` are ordinary entries in `MOTION_KEYS`/`resolveMotion` (pure,
      read `state.searchPattern`); `/`/`?` accumulate as a new
      `awaiting: 'search'` `Pending` state exactly like `f`/`t`'s
      single-char wait, just running to `<CR>`/`<Esc>`/`<BS>` instead of one
      key — this got dot-repeat, operator-pending (`d/foo<CR>`) and count
      composing for free, and needed the same block added to **both**
      `stepNormal` and `stepVisual` (they don't share one dispatch chain).
      `*`/`#` write the search state like `/`/`?` do, not read-only like
      `n`/`N`. Bug caught by goldens on first generation: `*`/`#` must search
      from the identified word's OWN start column, not the raw cursor
      column — mid-word, a backward search from the raw column still saw the
      current word's start as "before" it and wrongly re-found itself.
      Re-enabled the `/` register in `compare.ts` (both directions) and
      added `ignorecase`/`smartcase`/`wrapscan` to `EditorOptions`. 29
      `wave4-search` goldens, all green.
- [x] **4c — Macros `q @ @@` with halt-on-error.** New `macros.ts`: `q{reg}`
      recording is raw keystrokes, not resolved commands (same reasoning as
      `dot.ts`'s insert-session half), stored in a NEW `EditorState.macros`
      token store rather than as text — replay tokenizing the register's
      rendered text back would be lossy (a macro that typed literal `<Foo>`
      in insert mode would round-trip through `tokenize()` as *notation* and
      throw, the exact trap `keys.ts` documents). `macroText()` mirrors the
      finished recording into the actual register as plain text ONLY for
      display, because real Vim genuinely stores a macro's keystrokes as that
      register's content (`qa$xq` leaves `"a` holding `$x`) — this needed
      `keys.ts`'s `literalOf` extended to round-trip `<C-x>` control tokens,
      the one gap in an otherwise-complete inverse of `tokenize()`.
      `@{reg}`/`@@` replay through `step()` itself, exactly like `.`; a NEW
      `macroReplaying` flag (distinct from `replaying`) suppresses re-capture
      into an active OUTER recording without also suppressing `.`'s own
      dot-record — measured, `qaxq` `@a` `.` deletes a SECOND char via `.`, so
      `.` must see the macro's inner change as a normal one.

      Two rules needed a scratch probe, neither obvious from `:help q`/`:help
      @`: **recording never aborts on a failed command** (a beep, same as
      typing interactively) while **replay halts on ANY failure — including a
      plain motion-fail beep, not just a genuine error**; and **a bare `q`
      only stops recording when it would otherwise be a complete new
      command** — with an operator pending (`yq`) it is swallowed as a failed
      motion instead and recording continues (measured: `qa` `yq` `llq`
      leaves `"a` holding `yqll`). Both fell out of the grammar for free: `q`
      only reaches its `case` in `stepNormal`'s switch past the same
      operator-pending bail-out every other simple command already goes
      through.

      Two MORE things surfaced only once real goldens were generated —
      documented as harness details 11 and 12 in `tools/goldens/README.md`,
      because both produce goldens that look entirely plausible while being
      wrong:
      - Harness detail 10's mandatory per-group `:try`/`:catch` (needed so
        one exception doesn't abandon a whole case) DEFEATS a macro's own
        abort-on-error, but only for a genuine Vim ERROR (E353, E20) — a
        plain beep still halts correctly, unaffected, since that check does
        not go through VimL's exception machinery at all. Confirmed as a
        clean A/B: the identical failing `@a` halts when `feedkeys()` is left
        to fail on its own and does NOT halt wrapped in `:try`/`:catch`.
        Since every golden is generated through that unavoidable wrapping,
        "does not halt on a genuine error" is what these goldens correctly
        measure — `state.ts`'s `MACRO_HALT_EXEMPT` encodes exactly the two
        `InvalidReason`s this applies to (`empty-register`, `mark-not-set`).
      - `reg_recording()` and `@@`'s "last register" memory are Vim GLOBALS
        that `s:Setup()` cannot reset (no ex command clears either), so they
        leak across cases sharing one batched Vim process. A case whose own
        keys accidentally leave a recording open (the `yq`-doesn't-stop rule
        above, hit unintentionally) corrupts every case after it in the same
        file — caught this exact bug in a first-draft case via `pnpm test`
        after generating. And a case testing "no macro has ever run" only
        measures true if it is the FIRST thing in the file to touch `@` —
        `pnpm goldens:verify`'s isolated-vs-batched disagreement is what
        catches this one; `wave4-macros` keeps that case first for this
        reason.

      Recording into `"` (the unnamed register) is deliberately UNSUPPORTED:
      measured, it writes the finished text into `"0` as well as `""`, an
      obscure register-0/unnamed-aliasing quirk specific to that one target
      and out of scope for a curriculum that only ever records into a named
      register. Authored through `feedkeys(keys, 'xt')` per harness detail 4
      — `:normal` cannot replay a recording. 18 `wave4-macros` goldens, all
      green, isolation verified.
- [x] **4d — Command-line mode + ranges + simple ex-commands.** New
      `excmd.ts`, pure like `motions.ts`/`operators.ts`: a hand-rolled range
      parser (`. $ %` line numbers, marks including `'<,'>`, chained `+n`/`-n`
      offsets, backwards ranges silently swapped rather than prompted for),
      command-name resolution against Vim's own minimum abbreviations (`:co`
      not `:c`, since `:c` is `:change`; `:t` is a historical synonym for
      `:copy`, not an abbreviation of it), and pure line-splice helpers for
      `:m`/`:t`. `state.ts` owns the actual side effects: `:` accumulates as
      `pending.awaiting: 'command-line'`, the same shape `/`/`?` already use,
      not a new top-level mode — `Mode` has carried an unused `'command-line'`
      variant since M0 (like `'operator-pending'`), and the existing idiom
      already fit. `:d` reuses `operators.ts`'s `applyDelete` directly, so it
      gets numbered-register shifting for free. `:w`/`:q` are core-level
      no-ops that emit `BufferSaved`/`QuitRequested` (with `force` from `!`)
      for the host to act on — core stays zero-I/O, so `:w` never touches a
      filesystem. 25 `wave4-excmd` goldens, all green, isolation verified.
      Semantics measured, several by generating first and correcting the
      hypothesis after, exactly as the harness README recommends:
      - **a truly empty command line is not a no-op.** Verified against a
        fresh, unbatched Vim process (to rule out a batching artifact): a bare
        `:<CR>` advances the cursor to current-line-plus-one, the classic ex
        convention of an empty command meaning ".+1". A range with no command
        (`:5<CR>`) is the already-expected goto; only the fully-empty case
        was the surprise.
      - **`:normal` over a range does NOT shift-adjust its targets the way
        marks do.** Built assuming it would (mirroring `marks.ts`'s
        first-differing-line-plus-delta model) and refuted on first
        generation: `:1,2normal dd` on 4 lines deletes the line at (fixed)
        line 1, then the line at (fixed) line 2 — whatever now sits there —
        rather than adjusting line 2 down to account for line 1's removal.
        `clamp()` already gives the right behaviour once a later target runs
        off the shrunk buffer's end, which is what lets `:1,3normal dd`
        empty a 3-line buffer down to Vim's one-empty-line floor.
      - **the outer `:...<CR>` must never reach `.`.** `recordChange` gained
        a guard on `before.pending.awaiting === 'command-line'` — without it,
        `:d<CR>` would itself become the dot record, and a later `.` would
        replay an ex command instead of repeating whatever normal-mode change
        came before it. Pinned by a golden that does `x`, then `:d<CR>`, then
        `.`, and checks `.` repeated the `x`.
      - **`:normal`'s inner keys reuse `macroReplaying`, not a third flag.**
        The behaviour it needs — suppress capture into an ACTIVE outer `q`
        recording (already typed once as `:normal ...<CR>`) while still
        feeding `.` — is exactly what `@` already needed `macroReplaying`
        for. The one bug this caught before generation: the replayed keys
        must start from a FRESH `pending`, or the first inner key re-enters
        the still-`awaiting: 'command-line'` branch it was called FROM and
        gets appended to the (stale) command text instead of running as a
        command — found because every `:normal` golden failed identically
        (nothing happened) until `pending: EMPTY_PENDING` was added to the
        replay's starting state.
      - **`leaveVisual` now sets `'<`/`'>` on every exit from visual mode**,
        not only before `:` — matching real Vim and reusing the one funnel
        every visual-mode exit already goes through. Invisible to every
        existing golden (marks are not part of `EngineSnapshot` or the
        comparator), so this cannot have changed anything already pinned.
- [x] **4e — `:s` substitution.** New `subst.ts`: delimiter-based argument
      grammar (`:s{delim}pat{delim}repl{delim}flags`, any punctuation but
      letters/digits/`\ " |` as delimiter, an escaped delimiter surviving as a
      literal character in both pattern and replacement), matching built on
      4b's `vimregex.ts` translator (already turns `\(`/`\)` into real JS
      groups), and its own replacement-side escapes (`&`/`\0` → whole match,
      `\1`–`\9` → capture group, `\\x` → `x` literally). `state.ts` owns the
      actual substitution: eager (`g` only) via `subst.substituteRange` in one
      pass, or an interactive `awaiting: 'confirm-subst'` session (mirroring
      `command-line`/`search`'s existing shape in `Pending`) for the `c` flag,
      stepping one `y n a q l <Esc>` response at a time through
      `doConfirmSubstKey`. `proven/subst-g` added `FAMILIES` in
      `engine.test.ts` the moment this landed — unchanged, first try. 20
      `wave4-subst` goldens, all green, isolation verified.

      Semantics measured with a scratch probe before writing any code (same
      technique the README recommends), several refuting a first guess:
      - `:s` writes `searchPattern` and the `"/` register UNCONDITIONALLY once
        a pattern is resolved (an empty one reusing `state.searchPattern`,
        exactly like `/`) — even when nothing ends up matching. It also sets
        `searchDirection: 'forward'`, easy to miss: without it a bare `n`
        right after a failed `:s` can't repeat the pattern it just recorded,
        since `n`/`N` refuse to move at all when `searchDirection` is
        `undefined`. Found by a golden, not reasoned out in advance.
      - unlike `:d`, `:s` touches NO other register — no yank of the replaced
        text into `"`/`"1`, confirmed empty via probe.
      - undo mints a node only once a substitution actually lands — a pure
        search failure (E486) mints nothing, refining the Wave 2/3 "reached
        `u_save`" rule rather than contradicting it: `:s`'s own `u_save` is
        deferred until the first real match, unlike `p`'s, which runs before
        the register lookup that can fail.
      - cursor after a successful `:s` is the first non-blank of the LAST
        line that actually changed — not `range.last`, and not the match's own
        column (disambiguated with a leading-whitespace case; the match column
        and first-non-blank coincide in most naive test buffers). Undo's
        `changeStart` (`uh_cursor`) is the range's FIRST line, matching
        `doExDelete`/`doExMove`'s own convention, not wherever the change
        actually happened.
      - a declined-or-quit confirm session that found at least one match still
        moves the cursor to that match's column (Vim's highlight-and-prompt,
        visible even with no rendering) but mints no undo node; a session that
        finds NO match at all raises E486 before any prompting, same as the
        eager path.
- [x] **4f — `:g` / `:v`.** `doExGlobal` in `state.ts`, next to `doExSubstitute`.
      `excmd.ts` gains `global`/`vglobal` COMMANDS entries (each abbreviates to
      a single letter, matching real Vim); the grammar itself reuses `subst.ts`'s
      `splitDelimited`/`BAD_DELIM` (now exported) for ONE delimiter split into
      `{ pattern, cmd }` — unlike `:s`'s three-part split, everything after
      that first unescaped delimiter is the body command verbatim, even if it
      contains the same delimiter again (`:g/x/s/a/b/`). `types.ts` gains one
      new `InvalidReason`, `invalid-global`. 12 `wave4-global` goldens plus 2
      `semantics.test.ts` cases (the one body shape no golden can safely pin,
      see below), all green, isolation verified.

      Semantics measured with three scratch-probe rounds before writing any
      code, each contradicting a piece of the original design sketch:
      - **undo is coalesced into ONE node for the whole command** — measured
        with `undotree().seq_cur`: a single `u` fully restores every line
        `:g/a/d` deleted at once (not one press per line, the way every other
        multi-step feature in this file works), and a second `u` is a true
        no-op. Registers are NOT coalesced the same way — `:g/[ace]/d` on
        `a b c d e` behaves exactly like three independent `:d` presses for
        numbered-register shifting (`"1` = last deleted, `"3` = first),
        confirmed via probe and pinned by the comparator's automatic register
        diff on `global/scattered-deletes-prove-shift-tracking`. The
        implementation runs each body command through the REAL, existing
        `doExDelete`/`doExSubstitute`/`doExNormal` (registers-and-all,
        self-`commit()`-ing into a scratch copy of the state each time) and
        only discards that scratch copy's own N-node undo chain at the very
        end, replacing it with one `pushUndo` from the original tree straight
        to the final buffer — cheaper than threading `mutate()` through every
        existing body-command implementation, and exactly as correct, since
        only the undo tree (not marks/jumps/registers/lines) needs discarding.
      - **a per-line body failure never aborts the loop** — confirmed for an
        ordinary `:s` pattern-not-found (E486, fully absorbed, every matched
        line still visited) and for a nested `:g`/`:v`. Real Vim's nested-
        global guard only raises a genuine, catchable E147 when the INNER
        global's own cmdline carries an explicit numeric range; a rangeless
        nested global is a true silent no-op (zero exception, zero buffer
        change) either way, and even the E147 case only ever escapes AFTER
        the whole outer loop has visited every match, never mid-loop —
        confirmed with a probe reproducing Report C's exact `2,4g/y/d` inner
        body: buffer fully untouched, cursor parked on the last outer-matched
        line, `EXC: E147...` only once feedkeys ran out. This engine
        deliberately does not replicate the ranged-vs-rangeless split —
        BOTH collapse to the same immediate `invalid-global` rejection
        (state untouched) on every attempt, tracked via a new transient
        `EditorState.inGlobal` flag, the exact precedent `macroReplaying`
        already set.
      - **a confirm-flagged `:s` body is rejected up front, before touching
        anything** — resolved by a probe that the design sketch itself flagged
        as pending: real Vim DOES drive the confirm loop from inside `:g`
        (cursor walks to the last matched line, nothing gets confirmed once
        `-es` stdin runs dry mid-prompt with no response queued) — but since
        this project's oracle already cannot drive one plain `:s ... c` past
        its first response (4e's finding), driving one from inside `:g` too is
        unmeasurable. The engine fails loudly instead: reject before the
        pattern is even resolved or the cursor moves at all. This makes the
        case impossible to pin as a golden — the cursor divergence versus real
        Vim is permanent and deliberate — so it lives in `semantics.test.ts`
        instead, alongside a matching test that the nested-`:g` rejection also
        fires (and does not abort the outer loop) with the specific
        `invalid-global` reason, something no golden can observe either (the
        comparator only diffs buffer/cursor/registers, never event reasons).
      - the matched-line set reuses `marks.ts` wholesale — a `K.Marks`-shaped
        record keyed by ascending numeric strings (so `Object.entries` always
        yields the earliest remaining entry), scanned once up front, with
        `K.adjustMarks` dropping any entry a prior iteration's edit already
        swept away. A body that inserts new lines never grows the set, so new
        lines are never visited — both fall out of reusing existing machinery.
        **One shape `K.lineShift` cannot represent at all: a body that
        REORDERS lines without changing their count.** `:g/x/m$` on a
        scattered-match buffer silently mispositioned every match after the
        first on first implementation — `lineShift`'s "first differing line +
        net delta" model reads a net-zero-delta edit as "nothing moved,"
        found by an adversarial verification pass, not a golden (the goldens
        as authored happened to only ever exercise `:m`/`:t` bodies where the
        match set had already been fully drained by the time the reorder
        happened). Fixed with `remapMatchedByContent`, a real line-content
        LCS used only as the fallback when `K.lineShift` returns `null` for a
        genuinely-changed buffer — approximate only for duplicate-content
        lines, where identity can't be told apart by content alone.
      - zero matches is a silent no-op in real Vim (confirmed: no exception,
        no message, unlike `:s`'s E486) — modelled as the existing
        `pattern-not-found` rejection, which leaves buffer/cursor untouched
        exactly like the real no-op does, even though internally it is still
        a "failure." The pattern/`"/`-register write happens unconditionally
        BEFORE this check, mirroring `:s`'s own early-write.
- [x] **4g — Wrap-up.** New `tools/goldens/fuzz.ts`, reusing `generate.ts`'s
      `runVim` oracle and `compare.ts`'s `runGolden` comparator directly — a
      fuzzed case is an uncommitted golden, diffed and thrown away. Batches
      like `generate.ts` (250 cases per Vim process) for speed; 10k sequences
      run in about a minute. `pnpm test:fuzz [count]`, `VIMORROR_FUZZ_SEED=n`
      for a reproducible run.

      The alphabet is **safe by construction** — `:q :w :x ZZ ZQ :!` and
      shell escapes are never emitted by any generator (no bare `Z`; every
      ex-command atom's command word is drawn from a fixed safe set `d s m t
      normal g v`) — plus `isSafe()`, a second, independent scan applied to
      every fully-rendered sequence before it reaches the batched Vim
      process. It walks past a genuine ex range (digits, `. $ % + -`,
      `'{mark}`) before checking the command word's first letter against
      `q`/`w`/`x`, so it catches a dangerous command wherever it appears —
      including inside a `:g`/`:v` body, since that's just more text in the
      same rendered string, with no need to know anything about nesting.
      `:g`/`:v` bodies never nest another `:g`/`:v`, and `:s` is never
      generated with the `c` flag — not safety, but avoiding the two
      documented permanent oracle divergences (nested-global's cursor walk,
      `:s ... c`'s multi-response limit) that would otherwise manufacture
      guaranteed, uninteresting mismatches.

      Getting the alphabet safe took three rounds of fuzzing-the-fuzzer,
      each a real hazard in composing independently-safe atoms into one
      string:
      - a bare `<`/`<<` (shift) pairs with the FIRST `>` anywhere later in
        the rendered string — `keys.ts`'s tokenizer has no way to know it
        belongs to an unrelated later atom. Fixed by dropping `>`/`<` from
        the alphabet entirely (already well covered by `wave2-indent`/
        `wave3-visualops`)
      - `c`/`cc`/`C`/insert atoms MUST bundle their trailing text and `<Esc>`
        into the very same atom — one left dangling in insert mode at a
        feedkeys group boundary is silently abandoned by real Vim (README
        detail 7's "incomplete command dropped when the typeahead empties")
        while the engine's flat token replay just keeps typing into it
      - `:normal <arg><CR>` can NEVER embed a literal `<Esc>` in `<arg>` —
        it's typed at the real `:` prompt as raw keystrokes, and Esc there
        cancels the whole command line before `<CR>` is ever reached,
        regardless of what's queued behind it. Found when this spelled out
        an accidental `q{letter}`, silently starting a macro recording nothing
        in the alphabet ever stops, which then accumulated every subsequent
        case's keystrokes into one register for the rest of the batch — the
        same cross-case leak class README detail 12 documents
      - `COUNT + '0'` (e.g. `3` then `0`) is never "count 3, motion 0" in
        real Vim — `0` only starts a fresh motion when NO digit precedes it;
        otherwise it's a continuing count digit, leaving a genuinely
        incomplete command that real Vim drops at the next feedkeys group
        boundary (detail 7 again) while the engine carries the pending count
        straight into the next atom. Fixed by dropping bare `0` from the
        motion alphabet (`^` already covers "start of line")

      `pnpm goldens:verify` clean across all `wave4-*` families (unaffected —
      it diffs committed cases against a fresh isolated Vim run, nothing to
      do with the fuzzer).

      Four real engine bugs were found and fixed along the way, each pinned
      with a new golden generated fresh from real Vim (not hand-typed):
      - **`gen.vim` itself was leaking a phantom jumplist entry into every
        case.** `:edit!` (used to load each case's buffer) pushes the file's
        opening position onto the jumplist — confirmed with a scratch probe
        (`getjumplist()` right after `:edit!` already holds one entry at line
        1, before `cursor()` ever runs). A case's very first `<C-o>` popped
        that phantom entry instead of correctly finding an empty jumplist,
        even though nothing the case's own keys did ever jumped. Fixed with
        `silent! clearjumps` in `s:Setup()`, right next to `delmarks!`. A
        full regenerate changed **zero bytes** of every committed golden —
        confirmed silent, exactly detail 12's `'xt'` precedent, not a
        tradeoff
      - **a counted `iw`/`aw` that overshoots the buffer CLAMPED instead of
        aborting**, silently deleting the entire rest of the buffer for a
        count nobody meant literally (`"_9diw` on a short two-line buffer
        deleted everything; real Vim leaves it untouched). `textobjects.ts`'s
        `wordObject` loop used to `break` and keep its last successful
        position on overshoot; now it returns not-found, same as `di(` with
        no bracket. Real Vim's cursor still lands wherever the failed walk
        got to rather than staying put — `textObject`'s return type grew an
        `abortCursor` field to carry that back through `invalid()`'s new
        optional cursor param, pinned by `textobj/diw-count-overshoot-aborts-not-clamps`
      - **`+`/`-` beeped on every count overshoot** instead of only from the
        boundary line. `moveDown`/`moveUp` (`j`/`k`) already had the correct
        rule — fails ONLY when the cursor starts on the last/first line,
        clamps otherwise, matching `cursor_down()`'s established "`2dd` on
        the last line beeps, `9dd` mid-buffer clamps" precedent — but
        `moveLineDownFirstNonBlank`/`moveLineUpFirstNonBlank` (`+`/`-`) had
        no boundary check at all and just failed on ANY overshoot. Now
        mirrors `moveUp`/`moveDown` exactly. Pinned by
        `wave1/plus-count-overshoot-clamps-not-fails` and its `-` twin; the
        existing `delete/d-plus-at-last-line-noop` golden is what caught the
        first (too-broad) attempt at this fix

      Fuzzing at a few hundred sequences per run still surfaces further
      candidate mismatches beyond these four — mostly complex multi-atom
      compositions (visual blockwise register width/type, `iw`/`aw` on runs
      of several consecutive blank lines with a count) that need their own
      dedicated scratch-probe investigation. Not chased further here;
      `pnpm test:fuzz` currently exits non-zero over a full 10k run, so
      "clean over 10k sequences" (below, under "M0 done when") stays open
      rather than being claimed prematurely.

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
- [~] **Fuzz vs. real Vim** — `tools/goldens/fuzz.ts`, sanitized alphabet (no
      `:q`, `:w`, `ZZ`, `ZQ`, `:!`, no shell escapes — see 4g above for the
      full sanitizer writeup). Already found and fixed four real engine bugs
      at a few hundred sequences per run. **Not yet run clean over a full
      10k sequences** — see "M0 done when" below; more candidate mismatches
      remain in complex multi-atom compositions, not yet individually
      triaged.
- [x] `pnpm test:fuzz` script — `pnpm test:fuzz [count]`, defaults to 10,000

### Docs written at M0, alongside the engine

- [ ] `docs/curriculum.md` — **owns the single reconciled table** of acts,
      stages and skills. PlanB's story beats were numbered off its own
      curriculum (only beat 1 aligned), so beats are keyed to acts and skills
      here, never to stage numbers.
- [ ] `docs/story-bible.md`
- [ ] `docs/stage-schema.md`

### M0 done when

**M0 is done.** All three criteria below are met — the third was revised
2026-08-16 (see the note under it) rather than satisfied literally as
originally written in `MergedPlan.md`.

- [x] All four waves' goldens pass — 1153 goldens, 1221 tests, `pnpm
      goldens:verify` isolation-clean across every family
- [x] **Fuzz harness exists and runs continuously — no longer a one-time
      "clean over 10k" gate.** `pnpm test:fuzz` (Wave 4g) already found and
      fixed four real engine bugs on its first runs; a full 10k sequence run
      still surfaces further candidate mismatches in complex multi-atom
      compositions, not yet individually triaged. Fuzzing an unbounded input
      space against a live oracle is inherently open-ended — treating it as
      a checkbox that turns permanently green was the wrong model. Revised
      `MergedPlan.md`'s M0-done line accordingly; triaging remaining
      mismatches (real bug vs. fuzzer-alphabet artifact — see "What comes
      next" in `docs/HANDOFF.md`) is ongoing maintenance, not an M0 blocker.
- [x] A scripted demo drives the engine through `d2w` / `ci(` / `qa…q@a` /
      `:%s//g` from a JSON snapshot and back — `tools/demo.ts` (`pnpm demo`).
      Four scenes, each: build an engine, serialize its snapshot to JSON,
      `VimEngine.restore()` a fresh engine FROM that JSON (the "from a JSON
      snapshot" half), feed the keys, then serialize the result and restore
      a second engine from THAT JSON to prove the round trip is lossless
      (the "and back" half). Expected buffers are taken verbatim from
      already Vim-verified goldens (`proven/d2w`, `proven/ci-paren`,
      `macros/recording-crosses-into-insert-mode`) rather than hand-guessed,
      except the `:%s//g` scene, which composes three independently-golden
      features (`/` search setting the last pattern, empty-pattern reuse,
      the `g` flag over a `%` range) that have no single existing golden —
      reasoned by hand from the already-measured "cursor lands on the first
      non-blank of the last line that actually changed" rule (Wave 4e) and
      confirmed by running it. All four scenes assert and exit non-zero on
      any mismatch, so this is a real check, not just printed output.

**Explicitly NOT in M0:** no rendering, canvas, CRT shader, audio, levels, story
text, save system, or UI.

---

## M1 — `@vimorror/render`

**`docs/M1-PLAN.md` is the decomposed build plan** — file breakdown, package
scaffolding, build order (waves A–E), a verified JetBrains Mono licensing
resolution, testing strategy, and an explicit done-line. The bullets below
stay as the compressed tracking checklist; that doc is the plan of record for
*how*.

**Wave A — pure data layer** `[x]` — package scaffolding (`packages/render/`,
root `tsconfig.json`/`package.json` edits for `DOM`/`DOM.Iterable` lib +
`vite`/`dev:render`), `types.ts` (`Cell`, `CellBuffer`, `Camera`,
`CursorShape`, `Rect`), `cell-buffer.ts`, `camera.ts`, `cursor-shape.ts` +
their vitest suites. `pnpm typecheck`/`pnpm test` green repo-wide (1238
tests), confirmed zero canvas/DOM code in `packages/render/src`.

**Wave B — font** `[x]` — vendored `assets/fonts/JetBrainsMono-Regular.woff2`
(JetBrains Mono v2.304 release ZIP) + `OFL.txt` (its own header confirms
OFL-1.1, matching `M1-PLAN.md`'s pre-verified licensing call). `font-atlas.ts`
pure half (`atlasRectFor`, `atlasDimensions`, a 10x10 near-square grid for the
95 printable-ASCII glyphs, out-of-range codes fall back to slot 0) +
`font-atlas.test.ts` (UV math, column-wrap boundary, fallback) — `pnpm test`
green repo-wide (1244 tests). Impure half `bakeFontAtlas()` (FontFace load +
OffscreenCanvas bake) verified with a one-off demo page served through `pnpm
dev:render` and screenshotted in-browser: all 95 glyphs baked in order, no
cross-cell bleed at 4x zoom — page deleted afterward per the plan's "one-off"
framing, Wave C builds the real demo. Also fixed a real bug surfaced by
actually running `dev:render` for the first time: Vite 6's root is a
positional arg, not a `--root` flag (Wave A's script used the flag form and
had never been executed until this wave). Added `.claude/launch.json` so
`dev:render` is previewable through the browser tool going forward.

**Wave C — the glyph grid** `[x]` — `glyph-grid.ts`: a `GlyphGrid` class owning
a `<canvas>` 2D context and the previous frame's `CellBuffer`. `render(next,
atlas, cursor)` reuses Wave A's `diffCells` and blits only the changed cells
from the atlas via a `source-atop` (recolor the glyph's opaque pixels to
`Cell.fg`) + `destination-over` (fill the still-transparent rest with
`Cell.bg`) composite pair — this is *why* the atlas bakes glyphs
white-on-transparent rather than baking a fixed color per glyph, so one atlas
serves any `fg` a frame asks for. The cursor overlay is a separate pass using
a `difference` blend (inverts whatever's underneath, so it's visible on any
`fg`/`bg` without needing its own color) — a cell the cursor moves off but
whose content didn't change is explicitly redrawn plain first, or the
inverted pixels from the previous frame would stick.

`demo/{index.html,main.ts}` — a real `VimEngine` (not a scripted/fixture
one), a demo-only `KeyboardEvent → KeyToken` translator (deliberately not
real input handling, that's M4's job: ctrl+letter → `<C-x>`, the handful of
named keys with `e.key.length > 1` that vim-core knows, everything else with
`length === 1` passed through raw, everything else ignored so browser
defaults like arrow-key scroll still work), a mode/pending readout, and
canned buttons (`dd`, `d2w`, `ci(`, `yyp`, `v$d`, `gg`, `G`, `u`, redo) that
`feedKeys()` scripted sequences for repeatable spot-checks. Viewport lines
are padded/truncated to a fixed `COLS` before reaching `linesToCells` (reused
as-is, not reimplemented) so the canvas grid size never shifts frame to
frame.

Verified through `pnpm dev:render` in-browser, pixel-level rather than
eyeballed: each of the 4 distinct cursor shapes (the 8 modes collapse to 4
via `CURSOR_SHAPES`) confirmed by sampling canvas pixels before/after a mode
switch — block fills the whole cell, bar only its left slice, underline only
its bottom slice, hollow-block only its border with the center untouched,
each matching the `difference`-inverted-vs-plain arithmetic exactly. Live
typing (`i`, raw characters, `<Esc>`) and a text object (`ci(` on `(word)` →
correctly enters insert with the parens' contents removed) confirmed by
screenshot, dirty-cell redraw confirmed by only the edited region changing.
`pnpm typecheck`/`pnpm test` still green repo-wide (1244 tests, zero new test
infra — `glyph-grid.ts` and the demo are canvas/DOM code, manual-verified
only, per the plan's testing split).

Waves D–E (CRT post-FX, wrap-up) are still open — the bullets below stay
unchecked until the full milestone (working CRT pipeline) lands.

**Owns the decision:** canvas vs DOM, decided against real per-cell animation
requirements. (PixiJS and CodeMirror 6 cannot both be the surface — Pixi is
canvas, CM6 is DOM. Since the interpreter and world are ours, the renderer is
ours.)

- [x] Hand-rolled Canvas 2D glyph grid, offscreen font atlas, dirty-cell redraw
- [x] Camera, cursor shapes per mode
- [ ] WebGL2 single-pass CRT post-FX (curvature, chromatic aberration, phosphor
      persistence, glitch), canvas fallback
- [ ] **Effects Intensity slider wired from day one** — never labelled "epilepsy
      safe mode", which implies a guarantee nobody can make
- [x] JetBrains Mono subset baked to atlas — **confirm the exact licence grant
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
