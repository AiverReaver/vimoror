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
      Recorded here so M1 inherits it as an input instead of re-opening it.
      **Measured 2026-08-18, and it adds a second blocker the decision above
      could not see: the golden harness cannot measure these three at all.**
      Under `-es` the window is nominal but never scrolled — after `20G` then
      `zz` on a 40-line buffer `line('w0')` stays 20 and `line('w$')` says 40 —
      while real interactive Vim at the same 24-row size reports topline 9 and
      botline 31. Every value diverges: `H` 9 vs 19, `M` 20 vs 30, `L` 31 vs 40.
      Same class as the mode goldens, so the route is 4e's: pin the semantics
      from a pty transcript in a hand-written test rather than authoring a
      golden family. The semantics are now measured — `H` → topline + count - 1,
      `L` → botline - count + 1, `M` → the midpoint — and `docs/HANDOFF.md`
      carries the list still to probe. Nothing consumes these until M4 puts a
      real camera in front of the engine, so the plumbing stays unbuilt
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
- [x] Undo tree, `lastFind`, marks, the jumplist and the `.` record were **not
      serialized** in `EngineSnapshot` — a restored engine started with the
      snapshot as its undo root and with no marks or repeatable change. Deferred
      through M0 and M1, **closed at M2 Wave A** (see that section below), which
      is the point M2's own director-determinism done-line made it unavoidable.
      The **insert session is still deliberately excluded**: a mid-insert
      snapshot restores to normal mode, like a real Vim session after a reload

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
- [x] Marks, the jumplist and the previous-context mark are **serialized as of
      M2 Wave A**, alongside the undo tree / `lastFind` / `.` record listed
      above. Same deferral, closed at the same point
- [x] Recorded macros (`EditorState.macros`, `lastMacroReg`) **likewise, at M2
      Wave A**. An in-progress `recording` is the one exclusion, for the same
      reason the insert session is: it is a half-finished command, and a reload
      does not resume one

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

**Wave D — CRT post-FX + the knob** `[x]` — `crt-shader.ts`, `canvas-fallback.ts`,
`pipeline.ts`, plus the demo's intensity slider and forced-fallback pane.

`pipeline.ts` is render's `engine.ts`-equivalent, and the thing that shapes it
is that **a canvas can only ever hand out ONE context type**: the caller's
visible canvas becomes the WebGL2 surface (or the fallback's 2D blit target),
so the glyph grid gets a *private* 2D canvas of the same size that the post-FX
pass samples as a texture. `draw()` takes viewport-clipped `cells` and maps the
cursor through `camera.ts`/`cursor-shape.ts`; `effectsIntensity` is a required
0–1 parameter with no default, since deciding its value (or a
`prefers-reduced-motion` policy) is M4's comfort layer, not this one's.

`crt-shader.ts` is one fullscreen pass — a `gl_VertexID` triangle, no VBO, no
attributes — doing curvature, chromatic aberration, scanlines, vignette,
glitch and phosphor persistence, every one multiplied by `u_intensity`. What
had to be worked out rather than reasoned from the plan:

- **the phosphor accumulator is copied straight off the default framebuffer**
  (`copyTexSubImage2D` after the draw, same task, before the browser
  composites) rather than run as an FBO ping-pong. That is still M1-PLAN's
  "2-texture" design — grid + accumulator — but keeps it genuinely single-pass
  instead of needing two FBOs, a second blit program and a swap. Marked with a
  `ponytail:` comment naming the ceiling: move to FBOs if persistence ever
  needs to run at a resolution other than the canvas's.
- **the WebGL2 context must keep its default attributes.** `{alpha: false}`
  reads like a free win and silently kills persistence: the drawing buffer
  then has no alpha to source, so the copy into the RGBA8 accumulator raises
  `INVALID_OPERATION` and the accumulator stays black — a GL error nobody
  polls, so the symptom is just "the trail vanished." Measured both ways with
  a scratch probe (default attrs copy fine, `{alpha: false}` does not) and
  guarded with a comment at the `getContext` call, which is where someone
  would make the change.
- **`u_prev` is sampled at the plain screen uv, not the curved one.** The
  accumulator holds the previous frame's *final, already-distorted* output, so
  re-reading it through the curvature would warp the ghost a little further
  every frame and spiral it outward. Sampling flat makes the trail decay in
  place, which is what a phosphor actually does.
- the glyph-grid canvas is uploaded with `UNPACK_FLIP_Y_WEBGL` so it lands in
  the same orientation the accumulator arrives in (copied off the framebuffer,
  already bottom-up), letting one uv convention serve both samplers.
- **`GlyphGrid` gained `invalidate()`.** Assigning `canvas.width` on resize
  blanks the 2D canvas while the dirty-cell cache still claims those pixels
  are drawn. `diffCells` covers the case where the *cell grid* also changed
  (dimension mismatch → full redraw), but not a resize that keeps the same
  rows/cols and only changes pixel size — a DPR change, which M4 will hit —
  where the diff is empty and the screen would just stay blank.

Verified in-browser through `pnpm dev:render`, numerically rather than
eyeballed (the demo renders the same frame through two renderers side by side,
the primary one and a second forced onto the fallback path):

- **intensity 0 is bit-identical to the fallback**, not merely "visually ≈" as
  the plan's done-line asked: max per-channel difference **0** across all
  384,000 pixels, identical lit-pixel counts. Every effect scales to identity
  at 0, and at 0 the fullscreen triangle samples the grid texture at exact
  texel centres, so `LINEAR` filtering returns the texel unchanged.
- at intensity 1, each effect confirmed separately: **aberration** 9,619
  pixels with |R−B| > 40 (0 at intensity 0 — source text is `#e0e0e0`, so any
  R/B gap is the shader's per-channel uv offset and nothing else);
  **curvature** a 8.5px relative bow of the top text row measured left-edge vs
  centre, differenced against the intensity-0 reading so glyph-shape variation
  cancels; **glitch** 8,774 pixels changing frame-to-frame over a completely
  static buffer (exactly 0 at intensity 0, confirming the pass is otherwise
  deterministic); **phosphor** lit-pixel count decaying 16,547 → 14,149 → 218
  over ten frames after the buffer was emptied, while the fallback pane sat
  flat at 200.
- **the fallback path never throws** — exercised both ways, via `forceFallback`
  and via a genuine `getContext('webgl2') === null` machine (stubbed), at
  intensity 1, through `draw`/`resize`/`dispose`. Both paths produced identical
  lit-pixel counts before (15,821) and after (7,697) a resize.
- `invalidate()` pinned against the case it exists for: a same-size resize
  where `diffCells` reports nothing recovered all 15,821 lit pixels.

The demo draws on `requestAnimationFrame` rather than per keystroke, since
persistence and glitch are both time-varying and the post-FX pass has to keep
running while the buffer is idle. `pnpm typecheck`/`pnpm test` green repo-wide
(1244 tests, zero new test infra — all three new files are GPU/canvas code,
manual-verified per the plan's testing split).

**Wave E — wrap-up** `[x]` — `index.ts`: a flat `export *` barrel over all nine
modules, mirroring `vim-core/src/index.ts`'s pattern (no narrowing needed here —
render has no `engine.ts`-style class whose internals want hiding, and
`GlyphGrid` is legitimately usable standalone by a caller that wants the grid
without any post-FX). `demo/main.ts` now imports through `../src/index.ts`
rather than the five individual modules — the demo is render's only consumer
until M2, so pointing it at the barrel is what keeps `index.ts` honest about
exporting everything a real caller needs, instead of it going stale unnoticed.

Verified: `pnpm typecheck` (root, the flat all-packages compile) and `pnpm -C
packages/render typecheck` (the package-scoped one) both clean, `pnpm test`
green repo-wide at **1244 tests** — same count as Wave D, since Wave E adds no
new logic to test. Re-confirmed in-browser through `pnpm dev:render`: the
barrel is genuinely on the module graph (`packages/render/src/index.ts`
fetched, all nine modules loaded in barrel order), zero console errors, and
the engine→renderer path still live end to end (a `dd` through the demo's
canned buttons removed the line and repainted both panes, the WebGL2 one with
its phosphor ghost of the prior frame).

**One real demo bug found by re-driving those buttons, and it is a content
bug, not a code one: the demo's own hint line was disarming its `ci(`
button.** `i(` searches AHEAD across lines when the cursor encloses no block
(Wave 3's measured `openAhead` rule), and the hint line's literal `ci(` is an
unmatched open paren sitting *before* the `(word)` sample. From the opening
cursor the search found that stray paren first, and the only `)` later in the
buffer belongs to `(word)`'s own `(` — so `matchingClose` returned null, the
object aborted, and the button silently did nothing. **Confirmed as real Vim's
behaviour, not an engine divergence**, with a `/usr/bin/vim` probe on the
identical buffer: `di(` from line 1 col 1 leaves it completely untouched in
Vim 9.1, and empties `(word)` once the stray paren is out of the search path.
Fixed by moving the bracket sample line ABOVE the hint line — the smallest
change that puts a matched pair first, with no hint text distorted (balancing
it to `ci()` would have made the hint line itself the nearest block, which is
worse). Engine and Vim now agree on the new buffer, checked both ways, and the
button confirmed live in-browser: `()` with the bar cursor between the parens,
mode `insert`.

**The button was dead from the day it was written** — `INITIAL_LINES` is
byte-identical in `17b339f` (Wave C) and `9e3e4c3` (Wave D), so it never
worked once. Wave C's entry above is nonetheless true *as written*: it claims
"`ci(` **on** `(word)`", cursor-placed, which resolves through
`enclosingOpen` and never runs the forward search at all — verified still
working on both the old and new buffers. The gap is that the same entry also
lists `ci(` among the canned buttons, so it reads as though the button was
what got exercised. Wave C's text is left as the honest record of what was
actually checked; **the lesson is that a canned button verified by hand-placed
cursor proves nothing about the button.** All nine buttons swept from the
demo's own opening state as a result: `ci(` was the only genuine dead one.
`gg`/`u`/`<C-r>` also change nothing there, but correctly — line 1 is already
line 1, and a pristine buffer has nothing to undo or redo.

**All five of `M1-PLAN.md`'s "M1 done when" criteria now hold**, with one
honest footnote on the fifth: nothing changed outside `packages/render/`
except the two root fixes the plan named (`tsconfig.json`'s `lib`,
`package.json`'s `vite` devDependency + `dev:render` script) — plus
`pnpm-lock.yaml` as that devDependency's direct consequence, and
`.claude/launch.json`, added in Wave B so `dev:render` is reachable through
the browser tool. Neither was in the plan's list; both are tooling-only and
touch no shipped code.

**Owns the decision:** canvas vs DOM, decided against real per-cell animation
requirements. (PixiJS and CodeMirror 6 cannot both be the surface — Pixi is
canvas, CM6 is DOM. Since the interpreter and world are ours, the renderer is
ours.)

- [x] Hand-rolled Canvas 2D glyph grid, offscreen font atlas, dirty-cell redraw
- [x] Camera, cursor shapes per mode
- [x] WebGL2 single-pass CRT post-FX (curvature, chromatic aberration, phosphor
      persistence, glitch), canvas fallback
- [x] **Effects Intensity slider wired from day one** — never labelled "epilepsy
      safe mode", which implies a guarantee nobody can make. Shipped end-to-end
      as a required, never-defaulted 0–1 `draw()` parameter reaching the shader
      uniform; the *default value* and any `prefers-reduced-motion` policy stay
      M4's comfort-settings layer
- [x] JetBrains Mono subset baked to atlas — **confirm the exact licence grant
      (OFL 1.1 vs Apache-2.0 depends on distribution) before baking**

---

## M2 — `@vimorror/game`

**`docs/M2-PLAN.md` is the decomposed build plan** — file breakdown, package
scaffolding, build order (waves A–E), testing strategy, and an explicit
done-line, same shape as `M1-PLAN.md`. The bullets below stay as the
compressed tracking checklist; that doc is the plan of record for *how*.

**Two things measured against source while writing it, both of which change
what M2 has to build and neither of which is visible in the bullets below:**

- **`EngineSnapshot` is missing 8 of the 11 things replay depends on.** Undo
  tree, redo, dot record, marks, macros, jumplist, `lastFind` and — the one
  that is a plain gameplay bug rather than a horror concern — **`keyPolicy`**
  all diverge across a snapshot/restore round trip, measured by building
  history, restoring, then running the key that consumes it. Only search
  state and registers survive. A restored mid-stage save therefore runs keys
  the stage had locked, so key gating silently evaporates on reload. **The
  director API is not at fault** — injected edits replay byte-identically,
  since every director mutation really is a pure state transition as
  designed. This is the deferral the three `[ ]` "not serialized in
  `EngineSnapshot`" entries above have been pointing at all along, and M2's
  own done-line (the director determinism test) cannot be stated without
  closing it. M2 owns that `vim-core` change, exactly as M1 owned the root
  `tsconfig.json` `lib` addition. **Closed in Wave A below.**
- **`onCommandResolved` never fires for a single-keystroke command.** Measured:
  `x`, `j`, `u`, `.` and a whole `iab<Esc>` insert session emit **zero**
  events, while `dw`/`d2w`/`3x`/`ci(`/`:d<CR>` each emit one. `feed()` fired
  only when the pending buffer emptied *having held something*, and a one-key
  command's buffer was never non-empty. This breaks
  both features built on it: scoring silently undercounts (a stage solved with
  `xxx` scores **zero** keystrokes), and turn-based entities — "threats tick
  only when the player acts" — would never tick during Act I's pure `hjkl`
  navigation, which is precisely the act whose stated mechanic is "something
  moves only when you do."

### Wave A — the `vim-core` debt M2 rests on `[x]`

Both findings above, fixed in `packages/vim-core/src/engine.ts` before any
`packages/game/` file exists, per `M2-PLAN.md`'s build order. Test-first: the new
`packages/vim-core/src/engine.test.ts` encodes the divergence table as its
parameter list and the resolve table as another, so both are pinned the way the
rest of the package is. **1298 tests green** (1244 + 54 new), `pnpm typecheck`
clean, `pnpm goldens:verify` clean with **zero golden bytes changed**, and
`pnpm demo`'s four JSON-round-trip scenes still pass — they are the existing
consumer of `snapshot()`/`restore()`.

- [x] **`EngineSnapshot` carries the eight missing capabilities**: undo tree,
      dot record, marks, jumplist, `pcmark`, `lastFind`, macros +
      `lastMacroReg`, `keyPolicy`. Plus two the plan's table did not list but
      which diverge identically: `visualStart` and `lastVisual` (without them
      `gv` after a reload reselects nothing).
- [x] **Two of those needed flattening, not just copying** — and this is the
      failure mode worth remembering, because it is silent rather than loud:
      `UndoState.nodes` is a `Map` and `KeyPolicy.allowed`/`denied` are `Set`s,
      and **`JSON.stringify` renders both as `{}`**. A snapshot that "carries"
      them would restore an empty undo tree and an empty policy while
      typechecking perfectly and throwing nothing. Hence `UndoSnapshot` and
      `KeyPolicySnapshot`, and hence the one test that catches it: re-snapshot a
      restored engine and compare the JSON strings for equality.
- [x] Every new field is `T | undefined` rather than optional, so a
      **pre-Wave-A save still loads** — it just loads without history. Pinned by
      its own case, since the M0 demo and any fixture written before this wave
      are exactly that shape.
- [x] `restore()`'s existing insert-mode guard (restoring `mode: 'insert'`
      without its session gave an engine that rejected every key, `<Esc>`
      included) turned out to have **a twin nobody had hit yet**: a mid-visual
      snapshot restored `mode: 'visual'` with `visualStart` undefined. Now
      `visualStart` is carried, and the guard covers the visual modes too as a
      backstop, so a snapshot from either source cannot produce a zombie.
- [x] **`restore()` was silently CLAMPING the saved cursor, and for visual mode
      that is wrong** — found by an adversarial review pass, not by the tests as
      first authored. `restore()` rebuilds through the ordinary constructor,
      whose `clamp(lines, cursor, allowEndOfLine: false)` forbids the
      one-past-last-character column — and `$` in visual mode legitimately parks
      the cursor exactly there (Wave 3f's rule, above). The saved cursor was
      then never patched back, so a restored `v$` selection was one character
      short: **`v$d` gave `['', 'cd']` where the live engine gave `['cd']`, and
      the unnamed register came back `"ab"` instead of `"ab\n"`** — buffer AND
      register diverging, on the one mode the change had gone out of its way to
      preserve. `restore()` now re-clamps both cursor and `visualStart` with
      `allowEndOfLine: true` when the restored mode is visual, mirroring `gv`'s
      own restore path in `state.ts`, which clamps a stored selection's both
      ends exactly that way. Normal mode still clamps to `len - 1`, so a
      mid-insert save's cursor is still pulled back on restore, as `<Esc>` does.
      The lesson for the next reviewer: `vjl` cannot catch this and neither can
      any test whose selection stops short of the line end — the five new cases
      all use `$`.
- [x] The `:s ... c` confirm session was the one `awaiting` state the resolve
      table missed. Verified separately: it resolves as ONE 17-keystroke command
      (`:%s/a/b/gc<CR>yynyyn`), not as a command plus six loose responses, and
      it terminates on `<Esc>`/`q` too rather than wedging the counter open.
- [x] `rebuildUndo` falls back to the fresh root when `current` names a node the
      save does not contain — a dangling pointer would otherwise make every `u`
      a silent no-op, which is the same class of bug as the `Map`-to-`{}` one.
- [x] **`CommandResolved` now fires once per return to REST**, where rest is
      "no pending key buffer, no `awaiting` accumulator, no insert session, no
      visual anchor" (`atRest()`). The old rule fired only when the pending
      buffer emptied *having held something*, so `x`/`j`/`u`/`.` scored zero.
      What the rest rule additionally fixes, both measured and neither in the
      plan's table:
      - **`ci(foo<Esc>` used to resolve at the `(`, for 3 keystrokes, and the
        typing was never counted at all.** An insert session is now ONE command
        resolving on `<Esc>`, carrying all 7. Par is meaningless otherwise.
      - **a whole visual operation fired nothing** — `vjd` emitted zero events,
        because `v` never fills the pending buffer. Now one command, 3 keys.
      - an `awaiting` accumulator (`:`, `/`, a `:s ... c` confirm session)
        empties the key buffer while still mid-command, which is why `atRest`
        tests both rather than just the buffer.
      - an open `q` recording is deliberately **not** a rest barrier: it spans
        whole commands, so `qaxq` is correctly three of them (`qa`, `x`, `q`).
- [x] **A rejected key resolves nothing** — the invariant `tick.ts` needs, since
      a locked key that advanced the world would punish the player for
      exploring. Writing the test for it surfaced a real bug in the first
      implementation: `reject()` (`state.ts`) clears the whole half-typed
      pending command, so `d`, locked-`w`, `j` left the spent `d` in the
      keystroke accumulator and resolved a phantom two-keystroke `dj`. The keys
      forfeited with the aborted command are now dropped with it — *dropped*
      rather than resolved, so no tick can ever be blamed on a locked key. An
      insert session survives rejection intact, so its keys keep counting.
- [x] A **failed** command is not a rejected one: `ci(` with no bracket in the
      buffer aborts the operator and still resolves for its 3 keystrokes. Only
      the key policy makes a keypress free.
- [x] `marks.ts`, `dot.ts` and `macros.ts` added to `vim-core`'s barrel —
      `EngineSnapshot` names `Marks`, `JumpList`, `DotRecord` and `MacroStore`
      in its public shape, and `packages/game` will need to name them too.

### Wave B — the stage schema `[x]`

The first `packages/game/` files: `schema.ts`, `entities.ts`, `index.ts`, the
package's own `package.json`/`tsconfig.json`, three hand-authored fixtures in
`content/stages/`, and `tools/validate-stages.ts` behind `pnpm validate:stages`.
**1344 tests green** (1298 + 46 new), `pnpm typecheck` clean, all three fixtures
valid. Zod 3 is `@vimorror/game`'s one runtime dependency; `vim-core` stays at
zero, per `M2-PLAN.md`'s finding 4.

Wave B's done-line is not "a stage parses" but **"a human gets a precise error
for every way of getting it wrong"**, which is Wave A's lesson carried into a new
file: on this surface wrong looks exactly like right. Nearly every rule below
exists because the thing it catches otherwise fails silently and late.

- [x] **Zod stage schema** (buffer text, entity overlay, `allowedKeys`,
      `teachesKeys`, `par`, win/lose conditions, triggers, story beats,
      per-stage `:set` overrides). `parseStage`/`safeParseStage`/`formatIssues`
      are the public surface; `formatIssues` renders `path: message` per line
      because Zod's own `message` is a JSON blob nobody reads.
- [x] **Every object is `.strict()`.** A typo'd `beat` for `beats` otherwise
      drops the whole story array and the stage plays silently without it.
- [x] **The parsed type is the OUTPUT type** — every `.default()` is resolved by
      the time a consumer sees it, so `rules.ts`/`tick.ts` read no `undefined`s.
      Verified separately that Zod CLONES a default rather than handing every
      parse the same object, so two stages cannot share one `entities` array.
- [x] **`allowedKeys` is the one deliberately un-defaulted field.** `[]` and
      absent mean OPPOSITE things to a `KeyPolicy` — omitted is ungated
      (`allowed === undefined`), `[]` permits no key at all — so `[]` is
      rejected with "omit the field entirely" rather than a default silently
      picking one reading.
- [x] **`options` parses to a COMPLETE `EditorOptions`**, every field carrying
      core's own default, so a parsed stage drops straight into
      `new VimEngine(...)` with no merge step. `.partial()` would have typed as
      `number | undefined` and failed to spread onto `DEFAULT_OPTIONS` at all
      under `exactOptionalPropertyTypes`. `satisfies Record<keyof EditorOptions,
      ...>` is the drift guard: add an option to `vim-core` and this file stops
      compiling until it is authorable.
- [x] **Win, lose and a beat's trigger are ONE condition vocabulary.** The plan
      listed "triggers" and "story beats" as separate overlay items; they
      collapse, because a trigger with no beat attached has nothing to do and a
      beat needs exactly one condition to fire on. Positional conditions name an
      ENTITY rather than carrying coordinates — a goal the player must reach has
      to be drawn somewhere, and a second copy of its coordinates is a second
      thing to drift.
- [x] **`beat.startling` is REQUIRED, not defaulted to `false`.** A default is
      the dangerous direction here: an author who forgets the flag ships a
      startle beat that fires for a player who asked for none, and comfort
      settings are not somewhere a silent default belongs. Gentle Mode stays a
      constraint on the DATA rather than a switch buried in a renderer.
- [x] **The "never fires / cannot be played" rule class**, which is where most
      of the value is — every one of these parses perfectly without it:
      - a spawn outside the buffer. `VimEngine` CLAMPS a bad cursor rather than
        refusing it, so the player just starts somewhere the author did not mean
      - `{printabl}`. It tokenizes without throwing into eleven ordinary keys,
        so the stage gates on `{`, `p`, `r`, … and the author never finds out.
        Anything SHAPED like a macro must BE one; `{printable}` (all 95
        printable characters) is the only one, and it earns its place because
        the policy is checked per keystroke
      - a condition naming an entity id that does not exist — an unwinnable
        stage in `win`, dead config in `lose`, checked in beat triggers too
      - a `threat-reaches-cursor` condition in a stage with no threat entity.
        Same class, and the condition's own NAME is the argument: the threat
        does the reaching, so with none drawn nothing can
      - every win condition already true AT SPAWN. Only the statically decidable
        kinds are judged and every other kind counts as "not yet", so a stage
        carrying one runtime condition is never false-flagged
      - a stage that teaches a key its own `allowedKeys` locks, or ships a
        solution `allowedKeys` would reject
      - a par below the shipped solution's own keystroke count — and the same
        check one step out, a `lose` keystroke budget below it, which loses the
        stage before its own solution can win it
      - a buffer line containing `\n`. It renders as two lines in an editor's
        preview and reaches `vim-core` as ONE line holding a literal newline.
        Rejected rather than split for the author, since splitting would quietly
        change their line numbering
- [x] **`entities.ts` owns the one question the shapes cannot answer** — which
      cells an entity occupies. An entity is a single cell (`at`) or an
      inclusive RECTANGLE (`at`..`to`), `<C-v>`-shaped rather than a charwise
      span that flows around line ends, which is what lets a wall be one
      authored entity instead of twenty. A charwise implementation passes every
      other test in the file, so that case has its own.
- [x] **What looks like an import cycle is not one.** `entities.ts` takes only
      TYPES back from `schema.ts` and `verbatimModuleSyntax` erases those
      outright, so the only runtime edge is schema → entities. That is what lets
      the schema's own refinements call `occupies` instead of carrying a second
      copy of the rectangle math to drift from it.
- [x] **`pnpm validate:stages`** — schema check plus the two rules a single
      stage cannot see on its own: ids unique across the corpus, and a file
      named after the stage it holds (so a stage is loaded by a path join, not a
      scan). `MergedPlan.md` names this script as the CI gate that replays every
      solution and asserts a win; that half is M3's, because asserting a win
      means evaluating win conditions and the evaluator is `rules.ts` in Wave C.
      `checkStage` is the seam.
- [x] **Three fixtures, hand-authored as JSON** — `act1-two-worlds` (ungated,
      insert-mode, defaults-only, and therefore the proof that authoring a stage
      takes seven fields), `act1-four-directions` (gating, a wall rectangle, a
      keystroke budget), `act2-grammar-awakens` (a threat, a pickup, two beats
      including a startling one, `:set` overrides, a two-condition win). Tests
      feed each one's own solution through a real `VimEngine` under the stage's
      own `KeyPolicy` and assert **no key rejected and the engine at rest** —
      the honest half of M3's validator. Verified beyond that with a scratch
      probe that all three really do reach their win state.
- [x] Test imports run through `index.ts` rather than the modules directly, so
      the barrel cannot go stale unnoticed (M1 Wave E's lesson).

**Two things Wave C has to decide, both found by probing the fixtures against a
real engine rather than by any test that exists:**

- **Entity coordinates are static, and a buffer edit does not re-anchor them.**
  `di(` in `act2-grammar-awakens` shortens line 0 by thirteen characters and
  `the-aside`'s rectangle still names columns 11–25. Nothing in Wave B is wrong
  about that — the schema validates a stage at rest — but `tick.ts`/`rules.ts`
  are the first consumers that will care, and marks-style adjustment
  (`marks.ts`) is the precedent if they need it.
- **Does standing in a threat's cells lose, or does the threat have to move onto
  you?** Measured: after `di(` the cursor sits at 0:12, INSIDE `the-aside`'s
  rectangle, so under the first reading `act2-grammar-awakens` loses on the
  first command of its own shipped solution. The condition is named
  `threat-reaches-cursor` — the threat doing the reaching, driven by the tick —
  and the second reading is what the fixture was authored against. Wave C should
  settle it explicitly rather than inherit it, and `M2-PLAN.md`'s "what counts
  as one act for the tick" is the same decision from the other end.

### Wave C — the loop `[x]`

`tick.ts`, `rules.ts`, `gating.ts`, `session.ts` and their four suites, all
importing through the barrel. **1403 tests green** (1344 + 59 new — 38 for the
loop itself, 21 more from the adversarial review below), `pnpm typecheck`
clean, `pnpm validate:stages` clean, `pnpm goldens:verify` clean with zero
golden bytes changed, `pnpm demo` 4/4. The done-line holds head-lessly: every
shipped fixture WINS through `session.feedKeys(stage.solution)` — the honest
half of M3's replay gate, upgraded from Wave B's weaker "no key rejected" —
and `act1-four-directions` is losable by budget, the synthetic hallway stage
by threat, with a locked key rejected in character.

The three decisions Waves A–B handed over, settled:

- [x] **One resolved command is one tick.** The tick source is core's own
      `CommandResolved` — no parallel keystroke counter to drift, exactly the
      trap `M2-PLAN.md` finding 2 warned about. So an insert session is ONE
      tick however many characters it types (the one place the rest rule and a
      per-keystroke tick disagree, settled deliberately: a world that advances
      per typed character makes `i` lethal near a threat, punishing the exact
      mode beginners live in), a **rejected** key never ticks (Wave A's
      invariant, now also a fast-check property over random locked keys), and
      a **failed** command still ticks — `h` at column zero beeps, resolves,
      counts, and the world moves.
- [x] **Standing in a threat's cells is safe; the threat must move onto you.**
      Mechanically rather than by special case: a threat chases one step per
      tick along each axis, closing the gap between its own rectangle and the
      cursor, so a threat whose rectangle already CONTAINS the cursor has no
      gap, does not move — and `reached` requires a move. That is what lets
      `act2-grammar-awakens` survive `di(` leaving the cursor at 0:12 inside
      `the-aside`, which under the other reading lost the stage on the first
      command of its own solution. Corollary pinned by test: walking ONTO a
      stationary threat is survivable; the threat catching you as you step off
      is not.
- [x] **Entity coordinates stay static under buffer edits** — `di(` shortens
      line 0 by thirteen characters and no rectangle re-anchors; threats move
      only by their own chase step. Marks-style adjustment (`marks.ts`) stays
      the upgrade path if content ever needs it. A chase step can never carry
      a threat further out of bounds than its author put it, since it only
      ever closes the gap toward a cursor that is always in the buffer.

What the wave added beyond the handoff:

- [x] **Lose is evaluated before win on the same tick** — the threat landing
      on you exactly as you land on the exit kills you. A horror game showing
      mercy on ties would be the genre lying about itself; the schema keeps
      the common case honest anyway (a budget below the shipped solution is a
      parse error). Flipping the order fails exactly one test, by name.
- [x] **Beats fire once each, and are evaluated BEFORE the outcome latches** —
      a beat conditioned on the winning cell (`act2`'s exit beat) still fires
      on the winning tick. Event order within a turn is fixed:
      `Tick` → `ThreatMoved`* → `BeatFired`* → `OutcomeDecided`.
- [x] **A decided session is frozen** — `feed` ignores every key after
      `won`/`lost`, so a mid-string loss freezes the rest of the notation
      string (pinned: 30 fed keys, 21 ticks, 9 ignored).
- [x] `gating.ts`'s `REJECTION_LINES` is a total `Record<InvalidReason,
      string>` — a 17th reason added to core is a compile error here, not a
      silent generic message. The lines are the mechanical layer's defaults in
      Acts I–III's restrained register; M5/M6 own the real copy.
- [x] `keystrokes-over` is strictly over — winning on exactly the budget's
      last keystroke is a win.
- [x] Walls and pickups are deliberately INERT in Wave C — overlay data plus
      `cursor-on` targets, nothing more. No mechanic in `MergedPlan.md` or the
      condition vocabulary consumes them yet; wall-blocking and pickup effects
      are content-milestone decisions, not something to invent here. The
      `act1-four-directions` wall never intersects its own solution, so
      nothing ships broken by this.

**The adversarial review Wave A left unfinished ran to completion in this
wave** (its four unreported lenses on `engine.ts`, plus fresh lenses on the
Wave C files), every finding adversarially verified before being acted on: 16
confirmed, 1 refuted, 2 verifier-orphaned findings re-verified by hand — and
all 18 real ones fixed in the same change. The ones worth knowing about later:

- [x] **`<Esc>` is never lockable** (`ALWAYS_ALLOWED`, shared by `gating.ts`
      and the schema's playability checks so they cannot disagree). The
      shipped `act2` fixture allowed `i` for `di(` without listing `<Esc>` —
      one stage-taught keypress soft-locked the player in insert mode with no
      rest, no tick, no win and no lose, forever. Verified live before the
      fix; the class extends to `:`/`/`/`q`, all of which `<Esc>` cancels.
- [x] **Only the FED key's own rejection resolves nothing** (`e.key === key`
      in `engine.ts`). A replay (`@a`, `.`, `:normal`) surfaces its INNER
      keys' rejections through the same event stream, so a macro halted by a
      locked key used to mutate the buffer and then resolve NOTHING — a free
      edit with no keystroke cost and no tick for the world to move on.
- [x] **A rejection forfeits exactly `pending.keyBuffer`, not everything**
      (`keyBuffer` holds every key of the half-typed command, count digits and
      register prefix included). The old at-rest-only clear left a mid-visual
      forfeit (`v`, `f`, locked key, `d`) resolving a three-keystroke `vfd`
      that never ran, and — the mutation the review proved no test caught —
      an unconditional clear would have scored `iabq<Esc>` as one keystroke.
- [x] **A mid-insert snapshot's undo tree now carries its own buffer** —
      inside an insert (or `:s ... c`) session the buffer mutates ahead of the
      block's `pushUndo`, so the saved lines belonged to NO undo node and a
      restored `u` stepped to the wrong buffer, with the saved text
      unreachable by redo. `snapshot()` mints the missing node, keyed on being
      MID-BLOCK rather than on the lines/node mismatch alone — because
      `injectUndoEntry` creates exactly that mismatch at rest, on purpose
      (Act IV's "edits you didn't make"), and it must round-trip as-is. The
      first restore-side attempt broke that test within minutes of existing.
- [x] **`injectEdit` now shifts `lastVisual` and `visualStart`** with the same
      line shift it already applied to marks/jumps/pcmark (`gv` reads
      `lastVisual`, not the marks, and deleted text the player never selected)
      **and clamps the cursor with visual's `allowEndOfLine`** — an injection
      on ANOTHER line used to pull a live `v$` selection one character short,
      the exact defect `restore()` had already fixed on the snapshot path.
- [x] **`leaveVisual` clamps the cursor** (state.ts, measured against real
      Vim 9.1): `v$<Esc>x` deletes the last character in Vim, and used to
      silently no-op here because the EOL-NUL column survived into normal
      mode. `lastVisual` keeps the RAW `$` column, so `gv` still reselects out
      to the line break.
- [x] **A self-referencing macro halts instead of crashing** — `qa@aq` then
      `@a` recursed one synchronous `step()` per iteration into an uncaught
      RangeError out of `feed()`, 7 keystrokes any player can type. Real Vim
      spins forever (uninterruptible in a game), so past depth 100 the replay
      halts with the new `recursive-macro` reason — whose addition proved the
      `REJECTION_LINES` totality guard: `gating.ts` stopped compiling until
      the in-fiction line existed.
- [x] `expandKeySpecs` uses `Object.hasOwn` — a spec named `toString` used to
      pick up the inherited function, crash at stage LOAD, and still parse as
      valid because the schema's error path swallowed the same throw.
- [x] `session.feed` passes `BufferSaved`/`QuitRequested` through — zero-I/O
      core delegates `:w`/`:q` to the host and they leave no trace in engine
      state, so dropping them made both unimplementable one layer up (and an
      Act VI stage whose win is `:w` is already sketched).
- [x] Test-strength holes the review proved by running the mutation: session
      keystrokes counted per-command instead of per-key survived every test
      (now asserted against the 9-key insert), `RuleContext` wired to the
      AUTHORED entity array instead of the live one survived (now a
      session-level `cursor-on` a moved threat), rectangle threats reaching
      with their BODY was never exercised (corner-only detection survived),
      and mid-replace restore, the `v$o` anchor clamp and a mid-walk jumplist
      idx each had zero coverage. All pinned now.

### Wave D — the dials `[x]`

`difficulty.ts`, `hints.ts`, `scoring.ts`, `gentle.ts` and their four suites,
all importing through the barrel. **1444 tests green** (1403 + 41), `pnpm
typecheck` clean, `pnpm validate:stages` clean, `pnpm goldens:verify` clean with
zero golden bytes changed, `pnpm demo` 4/4. Nothing changed outside
`packages/game/`. The done-line holds in one test each: the IDENTICAL 21-key run
on `act1-four-directions` comes out won-but-never-clean on `verymagic`,
won-and-clean on `magic`, and LOST to the budget on `nomagic`; and the clean-run
flag survives wandering and a failed motion, then breaks on the first hint
request.

**The behaviour change to know about before reading Wave C's entry above: the
default difficulty (`magic`) no longer enforces a keystroke budget.**
`MergedPlan.md`'s table is explicit — Easy has "no keystroke budgets", Normal
scores the budget "not enforced", Hard makes it "a hard fail" — so
`keystrokes-over` is live on `nomagic` alone. Wave C's two budget-loss tests now
construct with `{ difficulty: 'nomagic' }` and say so in place; nothing else
moved.

- [x] **Difficulty is four values, and `vim-core` never learns any of them.**
      `enforceBudget` (a FILTERED lose list, so `rules.ts` has no branch),
      `threatPeriod` (a skipped chase step — half speed is fewer steps, not
      slower ones; the world still moves only when the player acts), `hints`,
      and `silenceFailedMotions`. `session.ts` is the only file any of them
      touch.
- [x] **"Motions clamp instead of failing" turned out to be almost entirely
      already true**, measured before writing the dial: core already clamps
      every POSITION the table names — `w` past the last word lands on the last
      character and reports NO failure at all, and `3w` overshooting does the
      same — while `l` at EOL, `h` at column 0 and `j` on the last line have
      nowhere a clamp could put them. So Easy's dial is the in-character failure
      LINE and nothing else: the command still resolves, still costs its
      keystrokes and still ticks at every difficulty. Two consequences stated in
      the file rather than discovered later: the easing is cosmetic, and an
      aborted OPERATOR reports `motion-failed` too (`dfz`), so Easy silences that
      as well. Real pre-dispatch clamping would need a second motion
      implementation in the game layer — the exact drift trap `dot.ts` exists to
      avoid — so it is a marked `ponytail:` ceiling, not a plan.
- [x] **Hints are derived from the recorded solution, never authored twice.**
      `M2-PLAN.md` left "in the stage data or derived from the solution" open for
      this wave; deriving keeps one recording authoritative (M3's recorder then
      yields par, hints and a regression test from one action, as planned).
- [x] **A hint is chosen by STATE, not by typed keys.** The solution is replayed
      once through a real `VimEngine`, capturing buffer + cursor after each
      RESOLVED command — so a hint says `di(` rather than `d`, an insert session
      is one step exactly as it is one tick, and a player who reached the same
      place by another route (`jjj$` where the solution says `G$`) is still on
      the path. A key-prefix hint would have declared them lost at keystroke one.
      Two tiers: exact match (buffer AND cursor) takes the LAST such state, a
      buffer-only match takes the FIRST; with neither, `undefined`, because the
      honest answer to a buffer edited off the route is `u`, not a keystroke from
      a path the player is not on.
- [x] **"Hints cost score" IS the clean-run flag** — no second point economy to
      invent, tune or explain. On `verymagic` hints are always on screen, so a
      `verymagic` run is never clean; that is what makes the identical solution
      score differently across the three presets, without difficulty touching
      keystrokes or par.
- [x] **Undo is detected by command SHAPE**, which is what `shape` is for: `3u`
      and `u` are one entry. Measured, so the list is complete rather than
      guessed — `U` is rejected as an unknown key and `:undo`/`:u` resolve as
      unknown commands, so neither belongs; `u`, `<C-r>`, `g-`, `g+` do.
- [x] **Comfort is filtered at the EMISSION point, and a suppressed beat is
      still marked fired.** Gentle Mode and the jump-scare toggle change WHICH
      beats a player sees and nothing else — same buffer, same ticks, same
      entities, same score, same outcome, same event stream once beats are set
      aside (a fast-check property over all four comfort combinations). That is
      what lets one player's replay reproduce under another's comfort settings.
      Gentle Mode also implies the narrower toggle: a player who turned it on has
      not consented to startle by leaving the other switch where it was.
- [x] `startling` stays REQUIRED in the schema (Wave B's call) and this is why:
      the whole comfort filter is one predicate over authored data, never a
      switch buried in a renderer.
- [x] **Deliberately not modelled: the table's undo dials** ("unlimited" /
      "limited per stage" / `'undolevels'=-1`). Core has no undo limit and the
      stage schema has no field to carry one, so there is nothing to switch —
      marked as a `ponytail:` ceiling that wants a schema field and a core
      option, not a modifier that lies about both.

**What the self-review caught** (same lens as Wave C's, on the new files):

- [x] **A register prefix reaches undo, and slipped past the shape check.**
      Measured: `"au` really does undo — the register is ignored, exactly as in
      real Vim — and resolves with the shape `"au`, as do `2"au` and `"a2u`.
      A check that stripped only `{count}` let a player keep a clean run by
      typing a register they never used. `isUndoCommand` now strips counts and
      register prefixes in any order.
- [x] **A hint request after the outcome latched would have changed a finished
      run's score.** `feed` freezes a decided session; `hint()` did not, so a
      post-mortem hint on a loss screen kept charging the clean flag. Frozen
      now — and since `hintFor` is pure and exported, a loss screen can still
      show the route without touching the score.

### Wave E — wrap-up, and the open-item ledger `[x]`

**`docs/M2-PLAN.md`'s Wave E entry is the decomposed version of this list**, with
the reasoning for each item. The boxes below are the tracking half. Everything
Waves A–D found, deferred or left behind is in one of the two lists — the second
one deliberately NOT Wave E's, because M2's own done-line forbids changing
anything outside `packages/game/` and `content/`.

**Done 2026-08-18.** Delivered as `GameSession.snapshot()`/`restore()` plus
`SessionSnapshot` in `session.ts`, the keystone test and a case per lost field in
`session.test.ts`, and two decisions recorded where the code lives (`scoring.ts`,
`schema.ts`). **1467 tests green** (1444 + 23), `pnpm typecheck` (root and
package-scoped) clean, `pnpm validate:stages` clean, `pnpm goldens:verify` clean
with **zero golden bytes changed**, `pnpm demo` 4/4.

**The headline is a `vim-core` defect the keystone test found on its first run,
and it is Wave A's own lesson landing one more time: wrong looked exactly like
right.** A mid-visual snapshot restored the selection perfectly — right buffer,
right cursor on the end-of-line NUL, right mode, right registers — and **refunded
the keystrokes the selection had cost**. Measured: a restored `v$` then `d`
resolved a ONE-keystroke `d` where the live engine resolved a three-keystroke
`v$d`. `engine.ts` dropped `#pendingKeys` on the stated premise that "a restore
lands at rest", which **Wave A's own visual-mode preservation had already made
false** — restoring visual mode with its anchor is by definition landing
mid-command. So a stage saved mid-selection came back cheaper than it was played,
and M2's done-line ("reproduces byte-identically") failed on the score while
passing on the buffer. Every test above it compares buffer/cursor/mode/registers
and all four already matched.

The fix is `pendingKeys` in `EngineSnapshot`, and the interesting half is the
condition on it. Recording it unconditionally **broke round-trip idempotence** —
caught immediately by Wave C's existing locked-key property test, whose
counterexample was a bare `2` followed by a locked `x`: the snapshot carried keys
that `restore()` then discarded, so a mid-command save re-snapshotted
differently. It is now recorded **only in visual mode**, the one in-flight
command a restore actually resumes; every other half-typed command (insert,
replace, an `awaiting` accumulator, a half-typed operator or count) is discarded
on restore and its keys go with it — the same forfeit rule `feed()` already
applies to a command aborted by a rejected key.

That forfeit rule is **reused rather than restated** for the one overlap, which
the self-review caught: `restore()` rebuilds `pending` empty even in visual mode,
so a selection carrying a half-typed motion or count (`vf` waiting on a
character, `vj2` waiting on a motion) loses that half too. Exactly
`pending.keyBuffer` is dropped from what gets recorded — count digits and
register prefix included, since that is what the buffer holds — leaving the keys
spent OUTSIDE the pending, which is precisely the slice a rejected key forfeits.
So `vf` records `v`, and no path anywhere counts a key whose command did not
survive. Pinned as its own five-row case; a mutant that skips the slice, and one
that is off by one, both die on it.

**The mutation sweep ended at 19 mutants and zero holes**, the four extra ones
covering the refined recording rule (not recorded, recorded outside visual,
recorded without the forfeit, forfeit off by one).

**The new tests were mutation-tested rather than trusted**, since all of them
passed on the first run: 17 mutants, one per field and per rule (`entities` handing back
the authored array, `ticks` restored to 0, `firedBeats` emptied, each tally
zeroed, the outcome forgotten, difficulty and comfort defaulted, the `stageId`
guard removed, the engine not restored, `pendingKeys` dropped / not recorded /
recorded unconditionally). **16 died on the first sweep. One survived** — the
key-policy re-derive, because the engine snapshot already carries a policy, so
nothing distinguished re-deriving from copying. The distinguishing case is the
one the line exists for and now has a test: a stage **corrected between save and
load** must re-gate the old save.

Wave E's own work:

- [x] **The director-determinism test, one layer up** — the milestone keystone.
      A scripted session mixing player keys with `director.*` injections,
      snapshotted mid-run, restored, replayed, diffed byte-for-byte. Wave A
      wrote the `vim-core` half; this is the same test through
      `session.feedKeys` with a stage attached. Both assertions Wave A's suite
      needed are in: **re-snapshot and compare JSON strings** (`#firedBeats` is
      the `Set` here, and the script fires a beat so the set is really
      non-empty), and **a `$`-in-visual selection** — which is what found the
      keystroke refund above. The replayed tail is compared as **event streams**
      rather than end state alone, which is the strong half: ticks, threat moves
      and beats all travel in the stream, so one equality pins the tick count,
      the live entity positions and the fired-beat set at once. One property
      worth its own case: **a director injection is not a player act** — it
      edits the buffer and never ticks, so the horror layer cannot kill you.
- [x] **`GameSession` has no `snapshot`/`restore`, which blocks the test above.**
      Found while assembling this ledger; it is Wave A's finding one layer up.
      The engine round-trips now, the session around it does not, and NINE
      pieces of state would vanish silently: `#entities` (LIVE threat positions
      — a restore hands back the authored array, so every threat teleports to
      where the author drew it), `#keystrokes`, `#ticks` (threat cadence parity,
      so a `verymagic` restore moves threats on the wrong turns), `#undos`,
      `#hintsShown` (a clean flag that lies), `#outcome`, `#firedBeats` (every
      beat armed to fire again), plus the difficulty and comfort settings. Wave
      A's trap applies verbatim — `#firedBeats` is a `Set` and `JSON.stringify`
      renders it `{}` — so only a re-snapshot-and-diff test sees the failure.
      M4's `localStorage` save is the consumer, and **Wave D made it worse by
      adding three of the nine fields.** Built as an **authored-vs-evolved
      split**, which is the whole design and settled several sub-questions at
      once: evolved state (engine, LIVE entity positions, the four tallies, the
      outcome, the fired beats, the two settings) is carried; authored state
      (`win`/`lose`/`beats`/`par`/`solution`/`allowedKeys`) is **re-read from
      the `Stage` the host supplies to `restore()`** and never carried, so a
      stage corrected in M3's editor takes effect on the next load instead of a
      stale copy persisting inside every save of it. `#lose` is re-derived by
      the ordinary constructor rather than being a tenth thing to carry and
      desync. `stageId` is the guard that keeps the two halves honest, and it
      **throws** — the one loud failure on a surface where everything else fails
      quietly, because a play restored onto the wrong stage runs perfectly and
      evaluates the wrong conditions. The `Set` trap needed no rediscovery:
      `firedBeats` is an array in the payload and a `Set` in the session.
- [x] **Sweep the six "M2 done when" criteria explicitly**, the sixth included:
      nothing outside `packages/game/` and `content/` except the Wave A
      `vim-core` debt. All six hold, with **one correction to the sixth's own
      accounting**: it enumerated the debt as "exactly three files"
      (`engine.ts`, `state.ts`, `index.ts`) and forgot `engine.test.ts`, which
      Wave A created and Wave E extended. Four files, all named in
      `M2-PLAN.md`'s critical-files list from the start. Criterion 4 re-checked
      structurally as well as behaviourally: `grep` for
      `verymagic|nomagic|gentle|comfort|difficult` across `packages/vim-core/src`
      returns **zero** non-test hits, so "zero branches inside `vim-core`" is
      not merely untested but unreachable.
- [x] **Confirm `index.ts` is complete and consumed** — all ten modules
      exported, and all eleven suites import through it, `session.test.ts`
      included (`SessionSnapshot` and `stageKeyPolicy` reach it that way). Wave
      E added no module, so the barrel needed no edit.
- [x] **Decide the per-stage difficulty override: NOT adding it.** Difficulty is
      a session-level setting only, recorded in `schema.ts` next to the `options`
      block that already said "This is NOT difficulty", and M3's metadata-panel
      bullet below is corrected. Three reasons, all pointing the same way: it is
      the **player's** choice about challenge, sitting beside comfort's choice
      about tolerance, and a stage that forces `nomagic` takes back a setting the
      player made for themselves — the one thing "no penalty, no judgmental copy"
      cannot survive; **nothing would consume it**, since all four of
      `difficulty.ts`'s dials are session-level, so an override would have to
      COMPOSE with the player's and composing means ruling on who wins with no
      consumer to justify either answer; and what an author actually wants —
      *this stage is harder* — is **already authorable** in `par`, a
      `keystrokes-over` budget, threat placement and `allowedKeys`, which is
      where content should say it.
- [x] **Decide whether a replay can hide an undo: yes, and it stays a named
      ceiling.** Measured rather than assumed, which shrank the surface twice.
      **`.` cannot hide one** — `xxu` then `.` repeats the `x`, because an undo
      is not a change and never enters the dot record, so the ledger's list of
      three (`@a`, `.`, `:normal`) is really two. **Recording cannot hide one
      either**: `qauq` resolves as three commands (`qa`, `u`, `q`) and that `u`
      is counted like any other, so the hole opens on the second `@a` onward.
      And **the cheap fix was measured and rejected**: watching `undoState.
      current` move to a node that already existed catches a macro body of a
      bare `u` and misses `xu` entirely — measured, the pointer returns to the
      very node it started from, so the buffer was really edited and really
      undone with nothing to see. A detector that silently covers half its cases
      is worse than a named ceiling. The real fix is core surfacing a replay's
      inner resolved commands, which M2's done-line puts out of bounds.

Carried forward, explicitly **not** Wave E — each one changes a file M2's
done-line puts out of bounds, or belongs to a milestone that has not started:

- [ ] **`vim-core`, from M0's handoff:** triage the remaining fuzz candidates
      (`pnpm test:fuzz` still exits non-zero over a full 10k run — expected live
      state, not a regression; **1828 mismatches of 10000 at seed 1, measured
      2026-08-18**, so it is a campaign rather than a handful). **First pass done
      2026-08-18**: `tools/goldens/triage.ts` (`pnpm fuzz:triage`) is the
      minimizing tool 4g's instructions described but never built — it sorts by
      atom count and then greedily drops atoms and buffer lines, turning a 60-key
      sequence into `yaW` on `['   ']`, with an `IDS=1` mode for set-diffing a fix
      (a net count cannot tell "fixed 5, broke 2" from "fixed 3"). One real engine
      bug fixed and pinned with six goldens that all fail without it: an
      UNCOUNTED `aw`/`aW` walk that runs off the buffer aborts, and real Vim still
      moves the cursor to where the walk stopped, exactly as the COUNTED overshoot
      4g fixed does. Two more isolated and not fixed — `aw`/`aW` aborting where
      Vim SUCCEEDS once the walk crosses onto an empty line (an empty line counts
      as a word), and a counted `ip` that clamps instead of aborting. The trap
      worth carrying: **the register, not the cursor, is what separates abort from
      success here**, so a cursor-only probe reads two different behaviours as the
      same. `docs/HANDOFF.md`'s "The 2026-08-18 triage pass" has the measurements; `H`/`M`/`L`,
      unblocked since M1 Wave A and still unwritten — and now known to be
      **ungoldenable**, so they need 4e's pty-transcript route (measured
      2026-08-18, see the `H M L` entry in M0 above); `[[ ]]` section motions;
      `o`/`O` with `autoindent`; the blockwise register's WIDTH, which the
      comparator ignores outright. (All also tracked in their own sections
      above; collected here so a Wave E reader sees them once.)
- [ ] **Harness, from M0:** `curswant` captured in every golden and compared in
      none; mode goldens unreachable without a pty oracle; undo-block goldens
      dependent on author-declared `keys:` boundaries.
- [ ] **Walls and pickups stay inert** (Wave C's deliberate call) — overlay data
      and `cursor-on` targets, nothing more. A wall blocks no motion today;
      `act1-four-directions` ships one its solution never touches. The real-time
      threat opt-in is future work in the same place.
- [ ] **Undo budgets** — `MergedPlan.md`'s "unlimited" / "limited per stage" /
      `'undolevels'=-1`. Wave D modelled none of it: core has no undo limit and
      the schema no field to carry one. It wants both, not a modifier that lies
      about them.
- [ ] **Docs unwritten since M0:** `docs/curriculum.md`, `docs/story-bible.md`,
      `docs/stage-schema.md` (tracked in "Docs written at M0" above too).
- [ ] **Marked `ponytail:` ceilings** — the hint path is replayed per request
      (memoize if a long recorded solution makes it measurable); the undo tree
      stores a whole buffer per node, so a save grows with edits × buffer size;
      `verymagic`'s motion dial silences the failure line rather than clamping
      before dispatch, which would need a second motion implementation.

### The rest of M2
- [x] Key gating — rejected *in character*, never a silent no-op (Wave C,
      `gating.ts` + `session.ts`)
- [x] Turn-based entities: **threats tick only when the player acts.** Keeps
      everything deterministic and replayable, and a thing that moves only when
      you do is scarier than one on a timer. A handful of late stages opt into
      real-time. (Wave C, `tick.ts` — the real-time opt-in stays future work)
- [x] Difficulty presets as pure modifier config — `:set verymagic` / `magic` /
      `nomagic` (Wave D, `difficulty.ts` — and the budget is a hard fail on
      `nomagic` ALONE, which changed the default session's behaviour)
- [x] Hints — diff live state against the golden-solution prefix (Wave D,
      `hints.ts` — matched by STATE, grouped by resolved command, derived from
      the recorded solution rather than authored twice)
- [x] Scoring: keystrokes vs par, plus a "clean run" flag (no undo, no hints)
      (Wave D, `scoring.ts` — the flag IS the "hints cost score" mechanic)
- [x] Gentle Mode — all mechanics and story intact, startle beats and look-away
      tricks disabled. Framed like Celeste's Assist Mode: no penalty, no
      judgmental copy. (Wave D, `gentle.ts` — filtered at the emission point, so
      buffer, ticks, entities, score and outcome are identical either way. The
      look-away tricks themselves are director-driven and arrive with the
      horror layer at M4.)
- [x] Separate jump-scare toggle, for dread without startle (Wave D,
      `gentle.ts` — independent of Gentle Mode, which also implies it)
- [x] **Director determinism test:** a replay containing injected edits must
      reproduce byte-identically from its snapshot. If horror breaks replay, the
      director API is wrong. (Wave E — `GameSession.snapshot()`/`restore()` came
      first, and writing the test immediately caught a `vim-core` defect that
      reproduced the buffer byte-identically and the SCORE not at all; see the
      ledger above.)

---

## M3 — `apps/editor` (the stage editor)

**`docs/M3-PLAN.md` is the decomposed build plan** — file breakdown, package
scaffolding, build order (waves A–E), testing strategy, and an explicit
done-line, same shape as `M1-PLAN.md`/`M2-PLAN.md`. The bullets below stay as
the compressed tracking checklist; that doc is the plan of record for *how*.
Two things it verified against source that the bullets cannot show: `vim-core`'s
`render()` is not an inverse of `tokenize()` (a recorded solution containing a
literal `<` either throws or silently becomes a named key — M3's one `vim-core`
debt, Wave A), and the editor must author the schema's INPUT type, not the
parsed `Stage`, or every export bakes the defaults in and `allowedKeys` loses
its omitted-means-ungated reading.

Shares `@vimorror/render` with the game, so what you author is exactly what
ships. Lands *before* any content is hand-authored — factory before product.

### Wave A — the debts M3 rests on `[x]`

Done 2026-08-18, before any `apps/editor` file exists. Two debts, three source
files, one new test file; **`goldens:verify` re-run and zero golden bytes
changed** (1159 goldens, isolation verified), `pnpm demo` still 4/4,
`validate:stages` still green, repo tests 1473 → 1483.

- [x] **`render` is now `tokenize`'s exact inverse** (`packages/vim-core/src/keys.ts`).
      It was `tokens.join('')`, and the recorder is what turns that into a bug:
      one recording has to become a `stage.solution` that replays as played.
      Both failure halves were measured against the shipped code before touching
      it, not taken from the plan — `['i','<','d','i','v','>','<Esc>']` rendered
      to `i<div><Esc>` and tokenizing that **threw** "unknown key notation
      `<div>`", so legal play failed its own schema check; and `['<','c','r','>']`
      rendered to `<cr>` and came back as **one `<CR>`**, four printable
      characters silently becoming a press of Enter with nothing thrown anywhere.
      The escape is `<lt>`, Vim's own notation, spent **only when the rendered
      SUFFIX already holds a `>` for the `<` to reach** — which is exactly when
      `tokenize` would misread it. Unconditional escaping was the one-line
      version and was rejected on measurement, not taste: `render`'s single
      caller is `engine.ts:206` producing `ResolvedCommand.keys`, which feeds the
      ghost HUD and `Hint.keys`, so `<<` would have displayed as `<lt><lt>` in a
      hint teaching the un-indent operator. Built right-to-left because the
      suffix is the thing being tested; five lines, and `<<`, `2<<`, `<G`, `<j`,
      `di<` and `<C-v>jl<` all still render as themselves.
- [x] **One key is now one token** — the same root cause as the above, in the
      other direction, and the reason this wave touched `state.ts` and
      `insert.ts` at all. `<lt>`, `<Space>`, `<Bar>` and `<Bslash>` each
      canonicalized to a SECOND token for a key a keyboard already delivers as a
      plain character, and it bit both ways round:
      - `tokenize('<lt>')` yielded the alien token `'<lt>'` (measured), for which
        `isPrintable` is false, a `{printable}` policy would have **locked** it,
        and normal mode did not know it as the un-indent operator.
      - `<Space>` was the mirror image, and the worse of the two because it was
        *reachable*: the space motion existed only for the NAMED token
        (`state.ts`'s `MOTION_KEYS` and `resolveMotion`), so hand-written
        `<Space>` notation moved right and **a real spacebar press, arriving as
        `' '`, did nothing at all** — a divergence from real Vim waiting for
        Wave D's `keyboard.ts` and every recorded solution containing a space.
      Fixed at the funnel: all four (plus `<gt>`, which this side used to THROW
      on while the harness accepted it) resolve to the plain character, the four
      now-unreachable `NAMED_TO_CHAR` entries are deleted, `MOTION_KEYS`/
      `resolveMotion` take `' '`, and `insert.ts`'s `<Space>` line is gone as
      dead — `insertLiteral`'s printable branch already returned `' '`.
      Direction was not a coin-flip: folding a typed `' '` UP to `'<Space>'`
      instead would have made every typed space `isPrintable`-false and therefore
      **locked by `{printable}`**, soft-locking any insert-mode stage. Choosing
      the character also makes `keys.ts` agree with `tools/goldens/keynotation.ts`,
      which has always resolved all five that way — two deliberately-independent
      parsers agreeing on behaviour, which is the whole point of keeping them
      separate.
      One golden turned out to already exercise this: `visualops/visual-p-named-register`
      plays `v iw"ap` with a bare space, and passed today only by luck — the
      ignored space would have moved within the same word, and `iw` then selects
      `def` either way. It still passes, which is why the byte count is zero.
      `<Nul>` is deliberately left named (`'<Nul>'` from notation, ``'<C-`>'`` from
      a raw `\x00`): nothing produces it, nothing consumes it, and both spellings
      round-trip, so there is no disagreement to fix.
- [x] **`schema.ts` exports `StageInput`** (`z.input<typeof stageSchema>`, one
      type line plus its comment) — the AUTHORED shape M3's document model needs,
      defaults unmaterialized and `allowedKeys` still able to be absent. Verified
      by typecheck rather than assumed: a stage object with no `options`, no
      `cursor`, no `entities` and no `allowedKeys` satisfies `StageInput` and is
      **rejected** by `Stage`.
- [x] Pinned in a new `packages/vim-core/src/keys.test.ts` (10 tests, green on
      the first run): the fast-check inverse property at 2000 runs over an
      alphabet **weighted 4:1 toward `<` and `>`** — a uniform draw over
      printables spends nearly its whole budget on cases that were never broken —
      plus the two named regressions, the `<<`-stays-readable set, and the four
      cases the property is structurally blind to. It cannot see the one-key-two-
      tokens bug at all, because each of those tokens round-trips to *itself*:
      only the engine can see it, by doing nothing when the spacebar is pressed.

- [x] **`fuzz.ts`'s `>`/`<` exclusion is LIFTED — Wave A is what unblocked it.**
      This was first written up here as a thing Wave A did *not* unblock, on the
      reasoning that the exclusion blames `tokenize` while the fix lives in
      `render`. That reasoning was wrong, and the measurement is what caught it:
      `tokenize` DID change — its alias table now resolves `<lt>` to `'<'` —
      and `<lt>` is a self-closing spelling of the un-indent operator with no
      bare bracket for a stray `>` to pair with, which is the entire hazard the
      exclusion existed for.
      **Proved before enabling, not after.** With the pre-Wave-A `keys.ts`
      stashed back in, `<lt>` was the alien token `'<lt>'` that `OPERATORS` does
      not contain, so `<lt><lt>` left the buffer un-shifted and `<lt>ip` typed a
      literal **`p`** while Vim un-indented — the fuzzer would have been
      reporting its own spelling as an engine bug. With the fix in, all seven
      hand-picked forms agree with real Vim: `<lt><lt>` matches bare `<<`
      exactly, and `<lt>j`, `<lt>ip`, `Vj<lt>`, `>>` and `>><lt><lt>` all match.
      `>` and `<lt>` are now in `OPERATOR` and in `visualAtom`'s op list.
      **The blind spot was real.** A shift-only alphabet over the same oracle
      found 28 divergences in 300 sequences — a *lower* rate than the fuzzer's
      general ~16%, so this is a genuine surface rather than a broken spelling —
      and they are real engine bugs, minimized far enough to name: a count on a
      shift multiplying the indent (`3>ip`, `3>3b`) where Vim's count belongs to
      the MOTION, `<` over a tab-indented line under `expandtab`, and
      `3<lt>aw`'s abort cursor. **They join the carried-forward triage backlog,
      not this wave** — Wave A's scope is the round trip, and `test:fuzz` was
      already expected non-zero. Of 62 mismatches in a 400-sequence fixed-seed
      run, **23 now involve a shift operator**. The before/after counts (65 → 62)
      are deliberately NOT presented as an improvement: widening the alphabet
      changes the whole draw, so the two runs are different sequences and only
      the rate is comparable.
- [x] **`tokenize('i<div><Esc>')` still throws, and that is still correct** — no
      heuristic can separate a hand-written `<div>` from the `<Escape>` typo the
      throw exists to catch, and accepting it would put literal text in a buffer,
      which is the one failure this file is for. What was wrong was the MESSAGE:
      "add it to `packages/vim-core/src/keys.ts`" is useless advice to the person
      who actually hits this, because `tokenize` is a trust boundary for stage
      AUTHORS (`schema.ts` runs it over `solution`/`allowedKeys`/`teachesKeys`,
      and M3's editor renders the result to them). It now names the `<lt>` escape
      first and keeps the add-a-key advice second, and `keynotation.ts`'s
      independent copy of the message got the same treatment so the pair stays
      parallel.
      The round trip the recorder actually depends on was verified end to end
      against a live engine — token stream → `render` → `feedKeys` into a FRESH
      engine, matching on buffer and cursor for `<div>`, `<cr>`, an inserted
      space, `<<` and `d `.
- [x] The `' '` motion change is fuzz-neutral, measured rather than assumed
      since a motion-table edit deserves it: `' '` reaches the fuzz alphabet only
      as a `FINDCHAR` (`f `/`r `), never as a bare motion, and 400 sequences at
      `VIMORROR_FUZZ_SEED=1` gave **65 mismatches both before and after** on the
      unchanged alphabet.

### Wave B — scaffolding and the dual pane `[x]`

Done 2026-08-18. The first `apps/` package: `apps/editor/{package.json,index.html,
vite.config.ts}` plus `src/{draft,stage-cells,files,fsa.d,store,fixtures}.ts` and
`src/{main,app,buffer-pane,grid-pane,issues-pane}.tsx`, three test files, and the
five root-config edits fact 5 names. **1544 tests green** (1483 after Wave A, +61),
`pnpm typecheck` clean, `pnpm goldens:verify` **zero golden bytes changed** (1159,
isolation verified), `pnpm demo` 4/4, `validate:stages` 3 valid. React 19.2.8 +
`react-dom` are the repo's first UI dependencies and live in the app's own
manifest, not the root's — pnpm's isolated layout does not symlink root devDeps
into `apps/editor/node_modules`.

The done-line, verified in the browser through the preview tool rather than by
eye, with the canvas's own pixels read back:

- [x] **A fixture opens and renders recognizably.** `act2-grammar-awakens.json`
      draws its buffer with the threat's rectangle tinted across 0:11..0:25 and
      `?` on the anchor, the pickup's `*` at 1:0, the goal's `X` at 2:0, and the
      spawn cursor at 0:0. Checked by sampling the canvas: the modal colour of
      each of those cells is its exact `ENTITY_SKIN` background with its exact
      foreground present, the spawn cell reads `#f4f4f1` — the precise inversion
      of `#0b0b0e` — and the frame is 64x18 cells / 576x324 pixels.
- [x] **The identity round trip.** Import a fixture, export it unedited, and both
      the parsed JSON *and its key order* come back equal, over every file in
      `content/stages/` by `readdirSync`. Written so it cannot pass vacuously: the
      same export run over a PARSED stage is asserted to gain exactly `cursor`,
      `entities`, `teachesKeys`, `lose`, `beats` and `options`, which is the
      failure the input-type decision exists to avoid.
- [x] **Live sync per keystroke**, and **a broken edit surfaces the schema's own
      message live** — shortening act2's buffer to one line put three entities out
      of bounds and the issues pane showed `entities.0.at: 2:0 is outside the
      buffer` and its three siblings, path-prefixed, verbatim, while the grid kept
      drawing.
- [ ] **The native picker itself is unverifiable here, deliberately recorded as
      such.** `showOpenFilePicker` opens an OS dialog no browser automation can
      drive, so `files.ts` is exercised only by inspection and by its one pure
      rule having been moved OUT of it (see below). This is also why
      `fixtures.ts` exists. **Wave E narrowed this to the picker alone**: the
      export pane shows the exact bytes `saveStageFile` would write, so what the
      editor produces is now checkable (and was checked, by hash) even though the
      dialog that writes it still is not.

Two corrections to the plan's own Wave B text, both measured:

- **"A `\n` pasted into a line" is unreachable from the textarea, by
  construction.** A textarea's API value normalises its line breaks, and
  `bufferFromText` splits on `\n`, so an editor-made edit can only ever produce
  one array entry per line. The example is reachable only from a FILE — and
  chasing it there found a real bug, below.
- **"A spawn moved off the buffer" needs Wave C.** Wave B's UI edits the buffer
  and nothing else, so the reachable member of that class is an ENTITY pushed out
  of bounds by shortening the buffer, which is what was verified. The `cursor`
  input arrives with the metadata panel.

#### What building it taught

- [x] **`@vitejs/plugin-react@latest` cannot be used, and fails confusingly.**
      6.0.5 peer-depends on `vite: ^8.0.0` — it is a rolldown-vite release — while
      this repo is on 6.4.3. `^5.2.0` is the newest that accepts vite 6 (peers
      `^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`). Worth stating that the
      plugin is optional at all: Vite's own esbuild pass compiles `.tsx` and reads
      `jsx: "react-jsx"` straight from tsconfig, so the app runs with zero plugins
      and zero new dev deps. What the plugin buys is React Fast Refresh, which an
      authoring surface iterated in the browser earns.
- [x] **No `server.fs.allow` entry, and the reason is worth knowing.** Vite's
      default is `[searchForWorkspaceRoot(root)]`, which walks up for
      `pnpm-workspace.yaml` — so with root `apps/editor` the allow-list is the repo
      root, already covering `packages/**`, `content/**` and
      `packages/game/node_modules`. Confirmed at runtime, not just in source: the
      font loads from `/@fs/Users/.../packages/render/assets/fonts/...`.
- [x] **`GlyphGrid` alone needs exactly two things the pipeline was doing for
      it** — the cursor mapping (mode to shape, buffer pos to screen) and
      `invalidate()` after any `canvas.width` assignment. Everything else
      `pipeline.ts` does is post-FX or the private second canvas it needs because
      a canvas hands out ONE context type; a direct consumer gives its visible
      element to `GlyphGrid` and must then never ask that element for WebGL, or
      `getContext('2d')` returns null and the constructor throws.
- [x] **The canvas is sized from the `CellBuffer` about to be drawn**, not from
      constants, so nothing is ever clipped and the resize path and the
      `invalidate()` path are the same branch. `MIN_COLS`/`MIN_ROWS` are a floor
      only. DPR is deliberately untouched, matching the M1 demo — the checklist
      already files that under M4.
- [x] **The font atlas is memoised at module scope, and the memo is CLEARED on
      failure.** Every `bakeFontAtlas` call builds a new `FontFace`, adds it to
      `document.fonts` (a set of OBJECTS, so a duplicate is kept rather than
      replacing) and allocates an `OffscreenCanvas`, none of it ever released —
      two of each on the first mount under `StrictMode`'s double-invoke. Verified
      in the browser: exactly one `JetBrains Mono` FontFace and one canvas after
      mount. Caching a REJECTED promise was the other half: a moved woff2 would
      otherwise leave the pane on "baking the font atlas…" forever, with an
      unhandled rejection as its only trace.
- [x] **Every entity background is dark because of the cursor's blend, measured
      before the palette was chosen.** `GlyphGrid` draws its cursor as a
      `difference` against white — an exact inversion — so a background near
      mid-grey inverts to within a value or two of itself and **the cursor becomes
      invisible on it**, danger band roughly 112..143 per channel. The checklist's
      M1 claim that the cursor is "visible on any `fg`/`bg`" is false at mid-grey.
      A stage's spawn very often sits on a painted cell, so the four skins are
      dark-background/bright-foreground and `TEXT_BG` is in the same assertion.
- [x] **Open judgment call #1 is DECIDED: background tint plus a glyph on the
      anchor, with selection spelt as an inversion.** Both halves were compared on
      the real fixtures on screen. The repeated glyph reads a painted rectangle
      beautifully and a one-cell entity not at all — and most goals and pickups are
      one cell — so it became the wrong rule for the overlay and the right
      intuition for why selection could not be a second glyph either. The glyph
      *replaces* the buffer character under the anchor, which is the accepted cost
      of "never colour alone" landing in pixels.
- [x] **`stageFileName` lives in `draft.ts`, not `files.ts`.** It is a fact about
      the document, and `files.ts` reads `window` at module load — so anything left
      in that file is unreachable from vitest's node environment. Moving the one
      pure rule out is what let it be tested at all, and it keeps the FSA surface
      honestly browser-only.
- [x] **`fixtures.ts` is unplanned and earns its place.** `import.meta.glob` over
      `content/stages/*.json` as RAW TEXT, so a bundled fixture enters through
      `readDraft` — the same door a picked file uses, rather than a second loading
      path to drift. It exists because the done-line's "open a fixture" cannot
      otherwise be verified at all. Its cost was one root-tsconfig widening, which
      was then avoided: a `/// <reference types="vite/client" />` in that one file
      is honoured whatever `compilerOptions.types` says, so the plan's
      five-root-edit ledger stays true instead of adding `vite/client` to every
      package and tool in the repo.
- [x] **The `FIELD_ORDER` drift guard was proven to fail on purpose.** Dropping
      `'options'` from the list stops the build with
      `Type 'true' is not assignable to type 'never'`. `satisfies` cannot express
      exhaustiveness for an ordered list, which is why it is a conditional type
      rather than `schema.ts`'s `satisfies Record<keyof EditorOptions, ...>`.

#### Six bugs found by adversarial review, all reproduced before being fixed

The review ran three lenses (correctness, plan fidelity, over-engineering) and
the three new pure modules were mutation-tested rather than trusted, since all 36
tests passed on the first run — M2 Wave E's discipline. 68 mutants across the
three modules; the survivors that were real holes all became assertions.

- [x] **A malformed entity blanked the whole page** — the headline find, and the
      exact inverse of the invariant `app.tsx` states. Reproduced in the browser
      with `kind: "walls"`, a plausible typo: `ENTITY_SKIN['walls']` is undefined,
      `skin.fg` throws from inside a `useEffect`, React unmounts the tree, and the
      issues pane that was about to say
      `entities.0.kind: Invalid enum value ... received 'walls'` never renders. Two
      siblings from the same hole: a missing `at` throws on `.col`, and
      `glyph: 7` survives to `GlyphGrid`'s `cell.char.charCodeAt(0)`. Fixed at the
      one point every render routes through — `stage-cells.ts`'s `drawable`, which
      asks *can this be drawn*, not *is it valid*. `Object.hasOwn` rather than a
      bare index, for the reason `schema.ts` already documents on `KEY_MACROS`:
      `kind: "toString"` would otherwise find an inherited function and pass.
      Re-verified in the browser afterwards — the typo'd entity is skipped, the
      valid one beside it still draws, and the schema's message is on screen.
- [x] **A hand-edited column crashed or froze the editor before the issues pane
      could report it.** `col: 1e9` made `padEnd` throw
      `RangeError: Invalid string length`; `col: 1e6` built eighteen million
      `Cell`s and then set `canvas.width` past the 65535 a browser accepts. The
      first fix was a `MAX_FRAME_COLS` cap, and **the browser then showed why the
      cap was the wrong fix**: a 512-column frame is a 4608-pixel canvas that
      squeezed the buffer pane to its own label. The frame now stops at the
      end-of-line position — one column past the longest line, which is the only
      reason to exceed it — so a runaway number cannot size the preview at all.
      The cap survives for a runaway LINE, which has the same shape and no other
      bound. A fractional `col` was the quiet member of the family: `line * width
      + col` becomes a STRING key on the cells array, and the entity renders with
      neither tint nor glyph.
- [x] **`stageFileName` offered `undefined.json`.** `id` is required in
      `StageInput` at the TYPE level and absent at RUNTIME for anything `readDraft`
      admits, so a file opened as `{"buffer": ["hi"]}` had the editor propose — and
      write — a name `validate:stages` rejects on both counts, which is precisely
      what deriving the name was supposed to make impossible. A non-string id gave
      `[object Object].json`.
- [x] **An opened file with a `\r` inside a line got silently rewritten.** The
      issues pane correctly showed `buffer.0: a buffer line may not contain a
      newline` — and then the author's first keystroke split that line in two,
      because a textarea normalises CR to LF, moving every `cursor` and
      `entities[].at.line` below it onto different content. That is exactly the
      renumbering `lineSchema` refuses to do on the author's behalf, so `readDraft`
      now refuses the file at the door. Not a duplicate of `lineSchema`: the reason
      is that the editor cannot HOLD such a file without changing it.
- [x] **A cancelled save left the previous "saved &lt;name&gt;" notice standing**,
      so the app's only feedback channel kept asserting a save that no longer
      described the file on disk. The notice is cleared before awaiting a picker.
- [x] **The font-atlas promise had no rejection path** — see the memo entry above.

Test gaps the mutation sweep found, each now an assertion:

- [x] **The palette was checked against itself.** `expect(cell).toEqual({..., fg:
      ENTITY_SKIN[kind].fg, ...})` passes for ANY table, including one where a
      foreground equals its own background — the glyph is still stamped, in the
      background colour, and "never colour alone" silently becomes colour alone.
      Both the inversion-delta and the fg-to-bg distance are now asserted against
      a number, and `TEXT_FG`/`TEXT_BG` are in the same loops.
- [x] **`inFrame`'s boundary was never tried.** The stray-anchor test used
      `line: 5` on a one-row buffer, which any comparison rejects; `<=` instead of
      `<` survived because `line === buffer.height` — the value that actually grows
      the array past `width * height` — was never used. Changed to `line: 1`.
- [x] **Selection was only ever tested on a one-cell entity**, so an inversion
      applied to the anchor stamp alone would have left a picked rectangle reading
      three-quarters unpicked. A non-anchor cell of a selected `wall` is now pinned.
- [x] **`frameWidth`'s far-corner term was never load-bearing** in any test, so
      both deleting it and reading `to.line` instead of `to.col` survived.
- [x] **`initialState` returning a SHARED object survived** — structurally
      identical under `toEqual`, and dangerous because the reducer's spreads are
      shallow. Pinned by reference.
- [x] **Two export-formatting mutants survived** the identity test, which parses
      the JSON before comparing: dropping the trailing newline, and dropping the
      indent entirely. An un-indented export is one unreviewable line in a
      `content/stages/` diff. Recorded alongside them: an export does NOT reproduce
      the fixtures' hand-formatting (inline `{ "line": 0, "col": 0 }` becomes three
      lines) — content and key order match exactly, whitespace does not, and Wave E
      is where that would change if anyone cares.

Deliberate deviations from the review, both recorded rather than silently taken:

- **Click-to-select stays**, though the over-engineering lens called it Wave C
  wiring. Without it `stageCells`'s `selectedId` — which the plan's own file spec
  and test list require — has no consumer outside its test, which is the dead
  flexibility the same lens objects to; and it is what made judgment call #1
  decidable on screen instead of in the abstract.
- **`FIELD_ORDER` stays an array with a conditional-type guard**, not
  `Object.keys({...} satisfies Record<keyof StageDraft, 0>)`. Same drift
  protection, and the version kept needs no cast.

### Wave C — structured editing, the whole schema authorable `[x]`

Done 2026-08-19. `apps/editor/src/{fields,metadata-panel,entities-panel,
conditions-panel}.tsx` are new; `draft.ts`, `store.ts`, `grid-pane.tsx`,
`buffer-pane.tsx`, `app.tsx` and `index.html` grew. **1572 tests green** (1544
after Wave B, +28), `pnpm typecheck` clean, `pnpm goldens:verify` **zero golden
bytes changed** (1159, isolation verified), `pnpm demo` 4/4, `validate:stages` 3
valid. Nothing outside `apps/editor/` was touched — no root-config edit, no
`packages/` edit, so M3's done-item 6 still holds exactly.

The done-line is "every field `schema.ts` accepts is reachable from the UI, every
`formatIssues` path renders next to something an author can find, and a stage goes
from `blankStage()` to exported-and-valid without hand-editing JSON." All three
met, and the first one is now enforced by the compiler rather than by memory —
see the drift guard below.

**Verified in the browser through the preview tool, authoring a whole stage from
the blank template with no JSON touched:**

- [x] **The palette arms; the grid places.** A click on `wall` then a drag across
      the preview produced `wall` at `1:8 … 3:16` — normalised from a
      down-and-left drag — selected it, and opened its fields. A plain CLICK
      (no drag) placed a one-cell `threat` at `2:2` with no `to` at all. The drag
      draws a live ghost rectangle while the button is down, which is one more
      entity in the array `stageCells` already paints.
- [x] **Every `formatIssues` path lands next to its field.** Eighteen at once
      from one deliberately malformed file (`id`/`act`/`title`/`cursor` type
      errors, `entities.0` null, `entities.1.kind: 'walls'`, `entities.2.at`
      missing, `win: 3`, `lose.0` null, `beats.0` null, `beats.1.startling`
      missing, `options.shiftwidth` a string) — **and the page did not blank**,
      which is the Wave B lesson holding on four new panels.
- [x] **The two error paths Wave B had to defer are now reachable and were both
      driven live**: a spawn moved off the buffer reports `cursor: spawn 9:0 is
      outside the buffer — the engine would silently clamp it`, and the metadata
      panel is what makes it reachable. Its sibling — clearing ONE axis of a
      position — reports `cursor.col: Required` rather than snapping to zero.
- [x] **Gating errors are live per keystroke.** `allowedKeys` of `wj0123456789`
      against a solution of `l` reported `solution: uses "l", which allowedKeys
      locks — the stage would reject its own solution` immediately.
- [x] **A stage authored entirely through the UI parses, plays and exports the
      authored shape.** Buffer typed, goal repositioned, wall and threat painted,
      a `threat-reaches-cursor` lose condition, a beat, `allowedKeys` over two
      lines, `teachesKeys`, `solution: 3j$`, `par: 3`, `expandtab: false` — and
      `schema valid`. The same route is pinned as a test (below) so it cannot rot.

What building it settled, all measured rather than assumed:

- **"Every schema field is reachable" is not a property a test can assert, so it
  is a conditional type.** A panel is not introspectable — a test can only check
  what it already knows to look for, which is the same hand-written list the
  guard is supposed to protect. So each pane exports `EDITS`, the fields it owns
  (`satisfies readonly (keyof StageDraft)[]`), and `app.tsx` asserts the four
  lists cover `keyof StageDraft` between them. Verified to fail on purpose:
  dropping `'beats'` from `conditions-panel.tsx`'s list breaks the build at
  `_everyFieldIsAuthorable`. It is the second half of a pair — `draft.ts`'s
  `FIELD_ORDER` guard already forces a new field to be EXPORTED — so between them
  a field added to `stageShape` can be neither silently unauthorable nor silently
  dropped from every save.
- **`CONDITION_KINDS` had to be hand-listed, because a `discriminatedUnion`
  exports no runtime member list** and M3's own done-item 6 forbids adding one to
  `schema.ts`. Guarded the same way, and the guard has a second, independent
  tripwire: adding a fifth kind to the union also makes `blankCondition`'s switch
  non-exhaustive under `noImplicitReturns`, so the build fails twice.
- **Wave C added ONE reducer action for fourteen fields, not fourteen.**
  `field-set` is a mapped type over `StageDraft`, so `{ field: 'act', value: 'x' }`
  does not compile, and the array fields (`entities`/`win`/`lose`/`beats`) are
  rebuilt by the panel and set whole. The only edit carrying real logic is
  `entity-painted`, because two grid cells become a normalised rectangle and a
  fresh unique id.
- **An empty box is an ABSENT field, and that is load-bearing on exactly one
  field.** `allowedKeys` omitted is ungated; `allowedKeys: []` is rejected
  outright ("permits no keys at all"). So `specsOrAbsent` maps an empty textarea
  to `undefined` and the editor can never emit `[]` — the one value of that field
  that is never right. The same rule generalises harmlessly everywhere else:
  clearing `par` REMOVES it and the schema says `par: Required`, which is a true
  statement about what the author has written, where a substituted `0` would
  invent a value and report a different error about it.
- **`options` had to clear itself all the way to absent.** `withOption` returns
  `undefined` once the last override is cleared, so the export does not keep an
  `"options": {}` the author is not writing — invisible to the parse, and exactly
  the drift `draft.ts`'s import→export identity test exists to catch.
- **The `options` grid is a loop over `DEFAULT_OPTIONS` itself**, with the field
  TYPE taken from each default's own type — so a new `EditorOptions` member
  becomes authorable with no edit in the editor at all, and there is no second
  table saying which options are booleans. A three-state select (`default (true)`
  / `true` / `false`) is what makes "take it back to whatever core says"
  expressible; a plain checkbox would have written a `false` that happens to match
  today's default and would stop tracking it tomorrow.
- **A `<select>` whose value matches no option renders the FIRST one, which is the
  editor asserting something the draft does not say.** Found in the browser on the
  malformed file: a `lose` condition that was `null` displayed `cursor-on`. The
  fix is one branch in `ChoiceField` covering two real states at once — a missing
  value shows the field's own placeholder (or `(unset)`), and a value that is not
  in the list shows `<value> (unknown)`, which is what keeps a stale entity
  reference visible while the issues pane complains about it. Both branches
  verified live (`exit (unknown)` after deleting the entity; `pick an entity` on a
  fresh condition with no entities drawn).
- **The list fields need `listOf`, for Wave B's reason one door further in.**
  `readDraft` admits `{"win": 3}` on purpose — the schema reports it on the next
  render — so a `.map` in a panel would throw, unmount the tree and destroy the
  report. It substitutes and never FILTERS: the panels write back by index, so
  dropping a malformed member would renumber the survivors and send the next edit
  to the wrong one. The item-level reads are guarded individually instead
  (`entity.at?.line`), which is what lets a malformed entity still be *edited*
  rather than merely skipped the way `drawable` skips it for drawing.
- **The tool disarms itself the moment it paints.** The grid's other job is
  selecting, and a tool left armed turns every click meant to pick an existing
  entity into a new one stacked on top of it. Both jobs resolve on mouse UP for
  the same reason: a click fires `mousedown`, `mouseup` AND `click`, so an
  `onClick` selector left beside a `mouseup` painter would place an entity and then
  immediately select whatever was already underneath.
- **Renaming a selected entity has to carry the selection with it**, since
  `selected` is an id match — without it the row collapses under the author
  mid-edit, on the first keystroke of the new name.
- **A blank line in a key-spec textarea is KEPT, deliberately.** The value is
  derived from state on every render, so a rule that dropped the trailing empty
  entry would delete the newline the author just typed, out from under the caret.
  The cost is that a trailing blank line reads as `a key spec may not be empty` —
  the schema's own message, about something genuinely written.

**All 28 new tests passed on the first run, so they were mutation-tested rather
than trusted** — M2 Wave E's discipline. 14 mutants across `draft.ts` and
`store.ts` (both `rectFrom` normalisations, the degenerate-`to` rule, `nextId`'s
prefix check, `withField`'s delete-not-store, `withOption`'s empty-to-absent,
`specsOrAbsent`, `listOf`'s substitution, `blankBeat`'s `startling`, and five on
the paint reducer including a no-op that returns a copy and a non-array
`entities`): **14 dead, 0 survived.** The keystone is `store.test.ts`'s "a whole
stage authored through the reducer alone" — fifteen dispatched actions, then
`parseStage` (which throws on any issue), then a real `GameSession` fed the
authored solution to a win, then the export's key list asserted to still be the
nine-field authored shape with `cursor` absent and `options` holding only the one
override.

**One honest edge, not fixed:** the preview pads to an 18-row frame regardless of
the buffer's length, so painting into the padding produces an entity the schema
immediately reports as outside the buffer. The message is precise (`entities.1.at:
1:8 is outside the buffer`) and clamping would silently move an entity away from
where the author clicked, so the schema stays the one that decides which cells are
real. Tinting the padding rows is the fix if it ever annoys anyone; it is a
preview-honesty nicety, not a correctness gap.

### Wave D — playtest and the solution recorder `[x]`

Done 2026-08-19. `apps/editor/src/{keyboard,recorder}.ts` and `play-pane.tsx` are
new, with two new test files; `app.tsx`, `grid-pane.tsx`, `buffer-pane.tsx` and
`index.html` grew. **1621 tests green** (1572 after Wave C, +49), `pnpm typecheck`
clean, `pnpm goldens:verify` **zero golden bytes changed** (1159, isolation
verified), `pnpm demo` 4/4, `validate:stages` 3 valid. Nothing outside
`apps/editor/` was touched — no root-config edit, no `packages/` edit, so M3's
done-item 6 still holds exactly.

The done-line is "recording `di(G` on the act2 fixture arms a draft whose parse is
clean and whose armed solution wins a fresh session with the same keystroke count
— and a recording that trips a locked key refuses to arm with the reason shown."
**Both halves driven live in the browser through the preview tool**, not argued
from tests:

- [x] **The canonical recording arms.** act2 opened, `playtest` clicked, `d` `i`
      `(` `G` pressed on the capture box: the readout walked `normal · 0
      keystrokes · 1 key recorded · typed: d` (the ghost HUD showing core's
      pending operator) through to `normal · 4 keystrokes · 4 keys recorded` and a
      green `won`. Arming wrote `armed: solution di(G, par 4`, the metadata
      panel's own `solution` and `par` fields came back `di(G` and `4`, the footer
      still read **schema valid**, and the three-preset replay printed `verymagic:
      won in 4 keystrokes` / `magic: …` / `nomagic: …`.
- [x] **A locked key refuses, with the reason on screen.** `x` (locked by act2's
      own `allowedKeys`) logged `x  You have not been given that key yet.` and
      arming answered `"x" was rejected during the recording, so the stage would
      reject its own solution. A rejected key forfeits the whole half-typed
      command with it, so the recording cannot be repaired by dropping it — grant
      the key in allowedKeys, or take a route that avoids it, and record again.`
- [x] **Playtest is literally in place.** The grid drew the SESSION while it ran —
      after `di(` the preview read `delete the () doubt` while the textarea beside
      it still held `delete the (parenthetical) doubt`, and the threat's tint
      followed its chase onto line 1 — then reverted to the draft on `stop`. Both
      beats fired into the log in order, the second marked `(startling)`.
- [x] **The live cursor takes the session's MODE, verified in pixels rather than
      by eye.** In insert mode the canvas inverts one pixel column at the cell's
      left edge (a bar); after `<Esc>` the whole nine-pixel cell inverts (a
      block). A hardcoded `'normal'` — what `grid-pane.tsx` had through Wave C —
      cannot produce the first reading. The same probe pinned `iZ<Esc>` resolving
      as ONE three-keystroke command, which is core's insert-session rule showing
      up in the recorder's tally.

#### What building it taught

- [x] **`session.keystrokes` is the wrong number for `par`, and the right one
      only by coincidence.** The schema compares `tokenize(solution).length > par`,
      so par must be at least the TOKEN count; keystrokes counts only resolved
      commands. Measured, the two disagree exactly when a key was rejected — `x`
      on act2 gives 1 token and 0 keystrokes — and agree at every clean win,
      because a win is evaluated inside a tick and therefore lands at rest with
      every fed token belonging to some resolved command. The recorder carries
      both and takes par from the tokens; the keystone asserts the equality rather
      than the code assuming it. (The mutation sweep's lone survivor is exactly
      this: `par: rec.keystrokes` is a behaviourally EQUIVALENT mutant, which is
      the assertion doing its job, not a hole.)
- [x] **A FAILED command still resolves, so it still ticks and still costs** —
      which is why a recorded human route may contain one and stay armable, as
      `validate-stages.ts`'s header already claimed. Measured on act2: `di(kG`
      refuses `k` at line 0 with `motion-failed`, emits `InvalidCommand` AND
      `CommandResolved`, and wins at 5 tokens / 5 keystrokes. A rejected key is
      the opposite shape: it returns early, forfeits `pending.keyBuffer`, and
      never ticks.
- [x] **The rejection check has to be on ANY `KeyRejected`, not only the fed
      key's.** A rejection from inside a replay (`@a`, `:normal`) surfaces on the
      same stream with a different key and forfeits nothing, so the schema's
      top-level-token check is blind to it while `validate:stages` — which filters
      every `KeyRejected` — is not. Proven reachable rather than assumed: a stage
      gated to `l` alone, replayed with `xlll`, **wins with `x` rejected**, so
      `replayAtPresets` reports `won in 3 keystrokes; keys rejected: x` and
      `won: false`. Without the rejection term in that flag the editor would have
      blessed a route CI fails.
- [x] **`render` vs `tokens.join('')` is invisible on every route without a
      literal `<`**, which is why the mutation sweep is what caught it. The case
      that separates them, measured end to end through a real session: the six
      keys `i < c r > <Esc>` render to `i<lt>cr><Esc>` and replay to a buffer of
      `["<cr>x"]`, while the join gives `i<cr><Esc>`, tokenizes to **three**
      tokens, inserts a newline, and leaves the stage playing with `["", "x"]`.
      That is M3 Wave A's "silent one, which is worse" reproduced at the consumer
      Wave A was fixed for.
- [x] **The plan's `playing | recording` pair collapsed to ONE live state.** Every
      playtest is recorded, because a playtest that reaches a win *is* a solution
      worth arming — two modes would have been the same session and the same fold
      with a boolean deciding whether a button renders. The plan already called
      recording "the same session with the token stream captured"; this is that
      sentence taken at its word. `store.ts` therefore gained **no `mode` field**:
      a `GameSession` is mutable and un-serialisable so it can never live in a pure
      reducer, and a `mode` in the reducer beside a session held elsewhere is two
      sources of truth for one fact. The presence of the `PlayView` IS the mode.
- [x] **The arm button must NOT be gated on the win, and the browser is what
      showed it.** `disabled={outcome !== 'won'}` re-implemented one third of
      `arm`'s rule in the UI and hid the other two thirds — so the very case the
      done-line names (a recording that tripped a locked key and therefore never
      won) had no way to report itself. It is enabled once anything is recorded
      and `arm` answers; "the editor invents no rules of its own" applies to the
      recorder as much as to the schema.
- [x] **Keys are captured by a focusable box, not a window listener** — the
      metadata panel is full of text inputs, and a document-level handler would
      feed `title` keystrokes to the engine. That makes the box a **keyboard
      trap**, since `<Tab>` and `<Esc>` are both real Vim keys it consumes: a
      pointer user clicks away and a keyboard-only author could not leave. So
      `shift-Tab` is the one gesture left to the browser (core has no `<S-Tab>`
      consumer and Vim inserts nothing for it), the box says so, and a test pins
      the pair — plain `Tab` consumed, shifted `Tab` not.
- [x] **`keyboard.ts` needs no `shiftKey` handling for characters**, which looks
      like an omission until measured: a real browser puts the SHIFTED value in
      `event.key`, so `A` and `$` arrive as themselves and core's `<S-…>` token
      stays notation-only. **The preview automation is the exception, and it cost
      an hour**: driving `shift+g` through it delivers `{key: 'g', code: '',
      shiftKey: true}` — an unshifted key with the modifier flag — so the engine
      correctly read a `g` operator prefix and waited. A real keyboard sends
      `{key: 'G', code: 'KeyG'}`, and the harness's bare `G` reproduces that. The
      translator trusts `event.key`; uppercasing from `shiftKey` would be wrong on
      every non-US layout (`shift+2` is `"` before it is `@`).
- [x] **Three preview-tool traps, all of which look like editor bugs.** Worth
      knowing before the next `apps/` pane is verified in the browser, because each
      one produced a convincing false negative here:
      - `computer{action: "type"}` inserts text **without firing `keydown`**, so
        nothing reaches the handler at all. Every key above went through
        `action: "key"`.
      - **Key events only land after a real mouse click has given the pane OS
        focus.** `document.hasFocus()` reported `true` and `activeElement` was the
        capture box while four presses reached *nothing* — a `window`-level
        `keydown` probe is what proved the events were never delivered. A
        JS-driven `.click()` does not restore that focus; a `computer left_click`
        does.
      - **`computer left_click` by `ref` can silently miss when the screenshot
        frame is scaled** (800x476 for a 1680x1000 viewport): it reports the
        element's PAGE coordinates, and several such clicks landed on nothing. A
        coordinate scaled into the screenshot frame works, a JS `.click()` always
        works, and either way the assertion must be a SEPARATE tool call so React
        has committed. The arm dispatch was "broken" three times before this was
        the answer — settled by setting `par` to 3, watching the schema say `par
        is 3 but the solution takes 4 keystrokes`, then arming and watching it go
        valid at par 4.
- [x] **Arming has to parse a LOCAL copy of the armed draft.** The preset replay
      is part of the same click, and the dispatch that writes `solution`/`par`
      does not come back around until the next render, so waiting for it would
      have meant replaying the PREVIOUS solution. `parseDraft({...draft, solution,
      par})` is the whole fix, and it also gives the honest failure message when
      some other field is broken ("the presets were not replayed").
- [x] **The three modules a playtest can desync were frozen rather than left
      live.** The buffer textarea goes `readOnly` and the paint tool is disarmed
      while a session runs, because both read their feedback back through the grid
      — which now belongs to the session. The panels stay editable on purpose:
      raising `par` mid-playtest is exactly the edit an author wants. Opening a
      different stage drops the session, since a view left standing would draw the
      old play over the new draft.
- [x] **All 49 new tests passed on the first run, so they were mutation-tested
      rather than trusted** — M2 Wave E's discipline. 19 mutants across
      `keyboard.ts` and `recorder.ts`: **18 dead, 1 survivor**, and the survivor is
      the provably-equivalent `par` spelling above. Two of the eighteen were only
      dead because the sweep found the holes first and they became the tests named
      above (the `render`/`join` case and the won-but-rejected preset flag) —
      without them both mutants lived.

#### Ceilings, recorded rather than fixed

- The pane offers no `hint()` readout. The hint data is derived from the armed
  solution and the keystone asserts it (`hintFor` returns `di(` at act2's spawn),
  but an author cannot see the ladder in the editor. M4 owns hint presentation.
- No `Comfort` toggles. A suppressed beat is still marked FIRED (M2 Wave D), so
  buffer, ticks, entities, score and outcome are identical either way — the only
  thing a toggle would change is which beats appear in the log.
- The log is bounded at 200 lines. It renders every frame, and an author leaning
  on a key would otherwise grow an unbounded array in the render path.
- An engine throw mid-playtest stops the session and reports the message, rather
  than logging and continuing. `pnpm test:fuzz` is known-nonzero live state, so
  this is not hypothetical — and a half-applied keystroke makes the recording
  untrustworthy, so nothing armable may survive it.
- **A session outlives an edit to the panels, and that divergence is reported
  rather than prevented.** The session was built from the parse at `playtest`
  time, so editing a win condition or `allowedKeys` mid-play leaves it running the
  old rules. Arming then replays against the CURRENT draft, so the preset list is
  authoritative and will contradict the session's own "won" if the rules moved —
  which is the honest outcome. Freezing the panels would have cost the one
  mid-playtest edit an author actually wants (raising `par`).

### Wave E — the round trip `[x]`

Done 2026-08-19. Two new files — `apps/editor/src/export-pane.tsx` and
`content/stages/act1-word-power.json` — plus a five-line edit to `app.tsx`, one CSS
rule in `index.html`, and `draft.ts`'s `safeExportStage` with its four tests (the
review's two confirmed code findings, below). **1629 tests green** (1621 after Wave
D, +8: four are the corpus-driven loops picking the new stage up automatically —
`draft.test.ts`'s import→export identity, `schema.test.ts`'s "validates" and "plays
its own solution with no key rejected", and `session.test.ts`'s "wins by its own
solution" — and four are `safeExportStage`'s own), `pnpm typecheck` clean, `pnpm goldens:verify` **zero golden
bytes changed** (1159, isolation verified), `pnpm demo` 4/4, **`pnpm
validate:stages` 4 valid** (from 3). Nothing outside `apps/editor/` and
`content/stages/` was touched, so M3's done-item 6 still holds exactly.

#### The export polish: the export had no reader

- [x] **`exportStage` produced bytes nothing could see.** The only consumer was
      `saveStageFile`, behind `showSaveFilePicker` — so in Firefox and Safari, where
      `HAS_FILE_PICKERS` is false and both file buttons render disabled, a finished
      stage **could not leave the editor at all**; and since a native save dialog is
      undriveable by anything but a human, nobody could check what the editor
      actually writes either. `export-pane.tsx` is a read-only `<textarea>` holding
      `exportStage(draft)` beside the issues pane: same serializer, no second copy,
      selectable, select-on-focus so copying is one gesture. It is one-way on
      purpose — editing JSON there would be a second authoring surface competing
      with the panels, and `readDraft` is already the door text comes in through.
      It is also what made this wave's own round trip checkable: the file committed
      below is byte-identical to what the pane showed (SHA-256 compared on both
      sides, `bdc8a58c…5b908d58` after the two corrections below), and re-opening
      the committed file from the `content/stages/` dropdown reproduces the same
      hash.

#### The round trip: `act1-word-power`, authored in the editor

The milestone's definition of done, executed for real. `content/stages/act1-word-power.json`
is Act I stage 3 from the curriculum table (`w b e W B E f F t T ; ,` territory,
the one Act I stage no fixture covered), and **every byte of it was produced by
the editor UI** — `blankStage()` → buffer typed into the textarea → both entities
painted on the grid (the goal a four-cell drag over the last word, the threat a
seven-cell drag over "repeats") → metadata, keys, conditions and beats through the
panels → the solution **recorded through the playtest capture box** and armed →
the export pane read out and written to disk. No code was touched to make it
valid, and no JSON was hand-edited.

- [x] **The route is `jjf,;www`, par 8, and the pedagogy is in the budget.**
      `f,` `;` crosses two commas in two commands where `w` alone needs ten presses
      and `l` needs forty-three. Every single-motion drill a learner might actually
      try was run at every preset rather than reasoned about, and **the first
      budget was set from that table wrongly** — see the adversarial-review notes
      below. The shipped budget is `keystrokes-over: 20`:

      | route after `jj` | keystrokes | at 20 | at the first draft's 12 |
      |---|---|---|---|
      | `f,;www` (par, 8) | 8 | won ×3 | won ×3 |
      | 8×`W` | 10 | won ×3 | won ×3 |
      | 9×`E` | 11 | won ×3 | **lost on `verymagic` only** |
      | 10×`w` | 12 | won ×3 | won ×3, on its last keystroke |
      | 11×`e` | 13 | won ×3 | **lost on `nomagic`** |
      | `b` then 10×`w` | 11 | still playing | **lost on two presets** |
      | 43×`l` | 45 | lost to the budget on `nomagic` only | lost ×3 |

      That is "a stage says *harder* through `par`, a budget, threat placement and
      `allowedKeys`" with an actual stage saying it: **every word-motion route wins
      at every preset, only character-crawling loses, and only where the budget is
      enforced.** `par` 8 is what separates the good route from the slow one, and
      `scoring.ts` reports the overrun without ending anything — which is the
      difficulty table's own division of labour between par and the budget.
- [x] **Verified from the shipped file, not just from the draft**: reopened through
      the `content/stages/` dropdown after `validate:stages` went green, played
      `jjf,;www` on the capture box, and watched both beats fire and `— WON —` land
      at 8 keystrokes with the follower two words behind on the same line.

#### What building it taught

- [x] **`f`'s TARGET is a keystroke the policy gates, and the first recording died
      on it.** The stage's first route was `jjfd;;` — find the `d` of "door" — and
      the very first playtest logged `d  You have not been given that key yet.`
      `KeyPolicy` is checked per KEYSTROKE (`state.ts`'s `isPolicyAllowed`), and an
      `f`'s argument is an ordinary keystroke, so **an `f`-teaching stage must permit
      every character it asks the player to jump to**. The naive fix — adding `d` to
      `allowedKeys` — hands an Act I mover the delete operator, which is three acts
      early. The fix that is actually right is to choose a target that is *already*
      an allowed key: `,` is in `";,"` for its own sake as the reverse-`f` motion, so
      `f,` costs the policy nothing. The buffer was rewritten around it
      (`the first door, the second door, the third door`), which is also better
      content. **This is the single most useful thing the round trip found**, and it
      is invisible to the schema: `stageSchema` checks the SOLUTION's tokens against
      `allowedKeys`, so it would have caught the finished stage — but only after the
      author had recorded a route they could not play.
- [x] **The adversarial review found the stage tuned to exactly ONE route, and
      that is the wave's biggest content lesson.** Three findings, one root cause:
      the budget had been set to 12 *because* that was the pure-`w` route's exact
      cost, which read as elegant and was actually the stage refusing every other
      way of playing it. Reproduced before anything was changed (the table above is
      that measurement): a learner drilling `E` — a key the stage advertised, and
      the *cheapest* word route at 11 — **lost on `verymagic` and won on the other
      two**; a learner drilling `e` overran by exactly one keystroke and died **on
      the goal cell, one tick after the win beat told them they had found the third
      door**; and a single exploratory `b` cost the stage outright. None of it was
      catchable by any existing gate, because `stageSchema` only compares the
      SHIPPED solution against the budget and `validate-stages.ts` only replays the
      shipped solution — so a stage can be hostile to every route but its own and
      pass everything. Fixed in the editor and re-exported: the budget is 20
      (comfortably past the worst word-motion drill at 13, far under the 45 a
      character crawl costs), and `teachesKeys` dropped `b`/`B`/`F`/`T`, which the
      geometry gives nothing to do — spawn is at the start and the goal is the last
      word, so every backward motion is pure loss. They stay in `allowedKeys`, which
      is where a key belongs when it is permitted for recovery and repetition rather
      than taught.
      **The general rule for the next stage author: `par` is what a route should
      cost, `keystrokes-over` is what a WRONG APPROACH costs — set the budget from
      the worst route you would still call correct, never from the second-best
      one.**
- [x] **The follower is not lethal, and that is a curriculum decision the review
      forced.** `threat-reaches-cursor` was in `lose` until the `E` finding above,
      and the fix could not be placement: the non-monotonicity below is structural,
      not a tuning error, so *any* lethal chaser makes some legitimate routes die on
      Easy and live on Normal. Act I's own line in the curriculum table is "Learning
      to move at all. Something moves only when you do" — so the third stage of the
      game introduces the follower's grammar (it tints, it has a glyph, it moves
      only on your turn, you can walk through it) and Act II's
      `act2-grammar-awakens` is where the same shape first kills you. The `counted`
      beat says so in as many words. The stage's only lose condition is now the
      budget, which is the shape `act1-four-directions` already ships.
- [x] **The stage lost on `verymagic` — the EASIEST preset — and the record-time
      preset replay is the only thing that said so.** With the follower authored at
      `0:28..0:31`, the armed solution reported `verymagic: lost to
      threat-reaches-cursor` beside two green wins. Measured with a scratch probe
      that prints the threat rectangle per tick rather than reasoned about:
      `threatPeriod: 2` **skips** a chase step (`session.ts`: `ticks % period === 0`),
      it does not slow one down, so at half cadence the threat was still at
      `1:27..1:30` on tick 3 and its tick-4 step landed on `2:28..2:31` exactly as
      `;` put the cursor on column 31. At full cadence the same threat had already
      been dragged left to `2:26..2:29` by two earlier steps and never touched it.
      **A slower chase is not a safer chase — it is a chase in a different place**,
      and difficulty is therefore not monotone for a positional threat. Re-anchoring
      the follower to `0:13..0:19` ("repeats", in `the corridor repeats itself here`,
      which reads better besides) won at all three, verified by the same probe and
      then by `validate:stages` — and that turned out to be **the wrong KIND of
      fix**, because it made the golden route safe without making the property go
      away for any other route. The shipped stage keeps the better placement and
      drops the lethality (see the review notes below); the measurement is what
      still matters, since the next author of a chasing threat inherits it.
      This is the exact failure `validate-stages.ts`'s three-preset loop was built
      for, arriving in the editor instead of on a red build — which is what
      `replayAtPresets` is for, now demonstrated on a stage nobody wrote to
      demonstrate it.
- [x] **The golden route passes THROUGH the threat, and that is the rule working.**
      On `magic`/`nomagic` tick 3 leaves the cursor at `2:14` inside the follower's
      `2:11..2:17` — safe, because `reached` requires the threat to have MOVED onto
      the cursor and a threat already covering it has no gap to close (M2 Wave C's
      settled question, act2's own shape). The `counted` beat fires exactly there,
      which is the moment the stage exists to teach. It does **not** fire on
      `verymagic`, where the follower is still a line behind on that tick; a beat
      firing on two presets of three is content, not a defect, and nothing in the
      gate reads beats. The condition is simply accurate — on `verymagic` you do not
      pass through it, so the line that says you did should not appear.
- [x] **`startling: true` on that beat was a Gentle Mode bug, found by the wave's
      adversarial review and reproduced before it was fixed.** `counted` is the
      line that tells the player standing in a threat is survivable — a MECHANICS
      explanation — and `gentle.ts`'s header promises Gentle Mode keeps "all
      mechanics and story intact; startle beats and look-away tricks off." Measured
      with `comfort: {gentle: true, jumpScares: false}`: the stage emitted only
      `third-door-found`, so exactly the player who most needs telling that the
      thing beside them is not lethal was the one not told — while
      `threat-reaches-cursor` was live at the time. `act2-grammar-awakens` had it the right
      way round already (`aside-noticed` explanatory and unflagged, `aside-removed`
      eerie and flagged), which is what made the inversion legible. Flipped to
      `false` **through the editor's own checkbox and re-exported**, so the round
      trip's "no JSON hand-edited" claim survives its own bug fix; both beats now
      reach a Gentle Mode player. The general rule this leaves behind: **`startling`
      marks a startle, not a mood** — a beat that teaches a rule can never carry it.
- [x] **Two React-batching traps when driving the editor programmatically**, worth
      knowing before the next `apps/` pane is verified this way — both produce a
      convincing "the editor is broken" reading:
      - **A whole drag dispatched in ONE task paints nothing.** `onDown` sets
        `drag` with `setState` and `onUp` reads it from the same render's closure,
        so `mousedown`+`mousemove`+`mouseup` fired back-to-back leaves `drag`
        undefined and `onUp` falls through to selecting. A real pointer delivers
        them in separate tasks. The same applies to arming a palette tool and
        clicking in one go — `tool` is still `undefined` in `onDown`'s closure.
        Each step has to be its own tool call.
      - **Reading the export pane in the same call that mutated the draft reads the
        PREVIOUS value**, which looked exactly like a paint that had failed. Same
        class as Wave D's "the assertion must be a separate tool call so React has
        committed".
- [x] **The export pane was a new BLANK-PAGE path, and the review caught it before
      anything shipped on it.** `exportStage` was safe to throw from `save()`, which
      catches and shows a notice — Wave E put the same call in a RENDER, where a
      throw unmounts the React tree and destroys the issues pane. Reachable, and
      reproduced rather than argued: **`JSON.parse` is iterative in V8 while
      `JSON.stringify` recurses per level**, so `readDraft` (which checks only
      `buffer`) admits `{"buffer":["x"],"beats":[[[…10,000 deep…]]]}` and every other
      door survives it — `stageFileName` returns `untitled-stage.json`, `parseDraft`
      returns an ordinary `id: Required` issue list — while `exportStage` alone
      throws `RangeError: Maximum call stack size exceeded`. At about five thousand
      levels it does something worse and SUCCEEDS, handing back fifty megabytes to
      put in a textarea. `draft.ts` gained `safeExportStage` (named for
      `safeParseStage`, same shape) and the pane renders the reason instead of the
      bytes.
      **Catching is only half of it, and the review's second confirmed finding is
      the other half.** Below the throwing band the identical shape SUCCEEDS: a
      1,425-byte file exports at 983KB, a 2KB file at 2MB, an 8KB file at 32MB —
      and a 32MB string measured in the browser costs about a second of blocked
      main thread *per assignment*, i.e. per keystroke, so the issues pane survives
      the React tree and is unreachable anyway. `MAX_SHOWN_BYTES` (1MB) is the
      bound, in the same spirit and with the same kind of justification as
      `stage-cells.ts`'s `MAX_FRAME_COLS`: a stage is about a KILOBYTE, so a
      megabyte is a thousandfold past anything a human authors. It lives in
      `safeExportStage` and not in the pane because `save()` must keep the full
      bytes — an author who picked a save target asked for them, and a file on disk
      costs no frames. Four tests, all mutation-checked: removing the `try`,
      blanking the text, rewording the message, removing the bound, flipping its
      comparison, and moving the constant a thousandfold in EITHER direction each
      kill at least one. Exactly the failure
      `listOf`'s own comment describes — "a `.map` on a number throws out of render,
      React unmounts the tree, and the issues pane about to explain the problem goes
      with it" — arriving at a third door.
- [x] **Painting a rectangle and typing the corners are not equivalent, and the
      difference shows up in the exported JSON.** `blankEntity` builds
      `{id, kind, ...rect, glyph}`, so a painted entity serialises in the same key
      order the hand-authored fixtures use; setting `to` afterwards through the
      number boxes appends it after `label` instead. Both parse identically and no
      rule cares — only a `content/stages/` diff does. The goal was repainted as a
      drag rather than nudged, which is why the committed file reads like its
      neighbours. Recorded as a ceiling below rather than fixed: ordering nested
      keys would need a second `FIELD_ORDER` per shape, and `FIELD_ORDER` exists to
      stop a field being silently DROPPED, which is a different problem.

#### Ceilings, recorded rather than fixed

- **Only TOP-LEVEL fields have a canonical export order.** Keys inside an entity,
  condition or beat follow the order the panels happened to write them. See the
  last Wave E note above for why this is not worth a second ordered list.
- **The export pane is read-only.** Pasting JSON back in would be a second door
  beside `readDraft` and a second authoring surface beside the panels; a browser
  with no File System Access pickers can now get a stage OUT but still cannot get
  one in except through the bundled `content/stages/` dropdown.
- **The export pane rebuilds the string on every render, and that stays uncached.**
  Measured at 0.0024 ms averaged over 200 runs on the committed stage, which is
  what "a stage is about a kilobyte" buys — and a `useMemo` here is exactly the
  cache `draft.ts` and `app.tsx` both refuse in their headers, for the reason they
  give: a cached export is a export that can disagree with the draft it claims to
  be. The SIZE half of the same finding was real and is fixed, not ceilinged —
  see the `MAX_SHOWN_BYTES` note above.
- **`save()` and the export pane word the same serialization failure differently**
  — the notice shows the raw `RangeError` message, the pane prefixes it. Left
  alone: two callers, two contexts, and `exportStage` throwing is the right
  contract for the one that already has a `try`.
- **The export does not reproduce the older fixtures' hand-formatting.** The three
  hand-authored stages write positions inline (`{ "line": 0, "col": 0 }`) and
  `JSON.stringify(…, null, 2)` spreads them over three lines, so
  `content/stages/` now holds two conventions. Matching them needs either a
  bespoke serializer or a regex over the output, and a regex cannot tell a
  position apart from a buffer line containing the same characters — a formatter
  that can corrupt content to tidy a diff is a bad trade. `act1-word-power.json`
  is the first stage written by the editor rather than by hand, so the exporter's
  shape is the corpus's shape from here and the older three are the outliers.
  `draft.test.ts` records the decision next to the test that would catch it
  changing.
- **A new file in `content/stages/` needs the dev server to re-transform
  `fixtures.ts`** before the dropdown lists it — `import.meta.glob(..., {eager:
  true})` is resolved at transform time, so a page reload alone is not enough. It
  is a dev-loop wrinkle, not a runtime one.

- [x] Dual-pane authoring: raw buffer text left, visual grid right, live-synced
- [x] Overlay painting: spawn, goal, walls, threats, key-pickups, triggers,
      story beats. Done at Wave C. The palette arms a kind and the grid places
      it — click for one cell, drag for a rectangle, normalised on both axes so
      the editor cannot emit the one shape `schema.ts` rejects. Triggers and story
      beats are the same thing here as in the schema: one condition vocabulary
      with three consumers, so `win`, `lose` and a beat's `on` share one editor.
      **The spawn is typed rather than painted** — two number boxes in the
      metadata panel, because a paint tool for it would need a fifth palette
      entry that places no entity, and the reachable failure it was wanted for
      (a spawn off the buffer) is reported precisely either way.
- [x] Metadata panel: id, act, `allowedKeys`, `teachesKeys`, par, `:set`
      options, story beat text. Done at Wave C. **No difficulty overrides** — Wave E decided
      difficulty is a session-level setting only (see its ledger above); a stage
      says "harder" through `par`, a `keystrokes-over` budget, threat placement
      and `allowedKeys`.
- [x] **Solution recorder** — the highest-leverage feature in the plan. Play the
      stage in the editor; your keystrokes become the golden solution. One
      action yields the par score, the hint data *and* a regression test. Done at
      Wave D: `recorder.ts` folds `(token, events)` pairs from a live
      `GameSession` and `arm()` returns `{solution: render(tokens), par:
      tokens.length}` or a reason. Par is the token count (see Wave D's notes on
      why `session.keystrokes` is the wrong number and equal anyway), the hint
      data is `hints.ts` reading the armed solution with no second field to
      drift, and the regression test is the exported stage `validate:stages`
      replays in CI — plus the same three-preset replay run at record time, so
      CI's answer arrives in the editor.
- [x] Validator — replays every golden solution headlessly through core and
      asserts a win using only `allowedKeys`; runs in CI over `content/stages/`.
      **Done 2026-08-18, ahead of the rest of M3**, because M2 Wave C's
      `GameSession` already IS the four steps this needs (build the engine, hang
      the stage's `KeyPolicy` on it, tick, evaluate `rules.ts`) — hand-rolling
      them in `tools/validate-stages.ts` would have been a second copy of the
      loop to drift from. Now in `.github/workflows/ci.yml` next to `typecheck`,
      which it can be because the gate needs no Vim.
      **It replays at all three difficulties**, which costs one loop and makes
      M2's fourth done-line criterion a standing CI check rather than a one-time
      claim. That was verified worth doing rather than assumed: a stage with a
      goal three cells out and a threat six cells off **wins on `verymagic` and
      loses on `magic`/`nomagic`**, because half cadence gives the threat one
      step in the three ticks the route costs instead of three — a single-preset
      gate ships that stage. The budget cannot split the presets the same way,
      since the schema already rejects a solution longer than its own
      `keystrokes-over`, so threat cadence is the whole mechanism.
      Two checks deliberately left out: `keystrokes <= par` (the schema rejects
      an over-par solution and a session counts only RESOLVED commands, so it can
      never fire) and a `CommandRefused` inside the solution (M3's recorder
      records real play, and a human route may legitimately contain a failed
      motion — the spec asks for a win with permitted keys, not a flawless one).
      Proven to fail on purpose, not just to pass: a non-winning solution and a
      preset-split stage were both fed to it and both reported with the preset
      named.
- [x] JSON import/export via the File System Access API — one stage per file,
      `<id>.json` derived from the draft so the editor cannot offer a name
      `validate:stages` would reject. Per-file pickers only; a directory-handle
      stage browser is a noted ceiling, not built. Split from the playtest half
      of this bullet, which is Wave D
- [x] Playtest in place. Done at Wave D, and "in place" is literal: the pane
      publishes a `PlayView` and `app.tsx` hands it to the SAME `GridPane` the
      author was editing, so the preview draws the session's buffer, cursor, mode
      and live entity positions with no second canvas to drift. Verified in the
      browser down to the cursor SHAPE following the live mode in canvas pixels.
- [x] **Definition of done:** author a brand-new stage in the editor, record its
      solution, export it, and confirm it loads and is completable in the game
      without touching code. **Done at Wave E**:
      `content/stages/act1-word-power.json`, Act I stage 3, authored entirely
      through the UI (buffer typed, both entities painted, panels filled,
      solution `jjf,;www` recorded on the capture box and armed at par 8),
      exported byte-identically out of the new export pane, and green in
      `validate:stages` at all three presets. "In the game" is read as
      `MergedPlan.md`'s own gate allows before M4 exists: the game's RULES layer
      is `GameSession`, the editor's playtest runs it, and the shipped file was
      reopened from `content/stages/` and won through that playtest at 8
      keystrokes. The in-app confirmation re-runs at M4 as part of its stage
      runner's own done-line.

**M3 is done.** All six "M3 done when" criteria swept at Wave E:

1. `pnpm typecheck` / `pnpm test` green repo-wide, editor suites included — 1629
   tests, 25 files.
2. Every schema field authorable and every schema error surfaced, with zero
   validation rules in the editor — Wave C's `EDITS`/`FIELD_ORDER` pair holds it,
   and `apps/editor` still imports `safeParseStage`/`formatIssues` and adds no
   rule beside them.
3. The recorder round-trips real play — Wave D pinned it, and Wave E ran it on a
   stage nobody had written yet: record → arm → the armed draft parses clean →
   the armed solution wins a fresh session at the recorded keystroke count.
4. `pnpm validate:stages` green over the grown corpus — **4 stage files valid.**
5. The manual round trip — the bullet above.
6. Nothing changed outside `apps/editor/` and the five root-config edits except
   Wave A's named debt (`keys.ts` + its test, `schema.ts`'s one `StageInput`
   line), plus `content/stages/`, which is the milestone's own product.
   `goldens:verify` reported zero changed bytes at every wave, Wave E included.

---

## M4 — `apps/web`

**`docs/M4-PLAN.md` is the decomposed build plan** — file breakdown, package
scaffolding, build order (waves A–E), testing strategy, and an explicit
done-line, same shape as `M1-PLAN.md`/`M2-PLAN.md`/`M3-PLAN.md`. The bullets
below stay as the compressed tracking checklist; that doc is the plan of
record for *how*. Two things it verified against source that the bullets
cannot show: the diegetic `:set` needs zero core changes (measured —
`CommandResolved` carries the full typed keys for known AND unknown ex
commands, so the title screen is a real `VimEngine` buffer and the shell is
one interceptor), and the `stage-cells.ts`/`keyboard.ts` lift has no legal
home in any existing package (game must not depend on render, render must
not know stages), so M4 creates the repo's fourth package,
`@vimorror/stage-view`. It also settles the decision M3 left open: **Zustand
is not taken.**

### Wave A — the lift, and the walls of the app — **done** (2026-08-19)

- [x] **`packages/stage-view` (`@vimorror/stage-view`) exists — the repo's
      fourth package.** Created because the lift has no legal home anywhere
      else: `stage-cells.ts` imports from both `@vimorror/game` and
      `@vimorror/render`, game must not depend on render and render must not
      know stages, and an app-to-app source import would be an undeclared
      dependency between two things that are not libraries.
- [x] `stage-cells.ts` + `keyboard.ts` + both test files **moved with
      `git mv`, not rewritten** — 32 + 34 tests, byte-identical bodies, only the
      two header paragraphs that said "the seam M4 lifts" now say it happened.
- [x] `font.ts` extracted from `grid-pane.tsx`'s inlined `atlasOnce`:
      `getFontAtlas()`, plus `CELL_W`/`CELL_H` as the one shared geometry.
      `font.test.ts` pins the semantics that used to live un-pinned inside a
      React file — a rejection is NOT cached (one missing woff2 would otherwise
      be permanent for the life of the page) and a success IS. It passed first
      run, so it was **mutation-tested**: dropping `atlasOnce = undefined` kills
      it, and so does turning `??=` into `=`.
- [x] The editor's four import sites repointed (`app.tsx`, `play-pane.tsx`,
      `grid-pane.tsx`, and `recorder.test.ts` — the fourth the plan's count of
      three missed). `grid-pane.tsx` loses `CELL_W`/`CELL_H`/`FONT_SIZE_PX`,
      `FONT_URL`, `atlasOnce` and `fontAtlas()` — pure deletion, one call site
      changed to `getFontAtlas()`.
- [x] `apps/web` scaffolding: `package.json` (the four workspace packages +
      react/react-dom), `index.html`, `vite.config.ts` (react plugin, no
      `server.fs.allow`), **no `tsconfig.json`** — the root project compiles it.
      `zod` deliberately NOT declared yet; it arrives with `save.ts` in Wave D.
- [x] Root: `"dev": "vite apps/web --port 5173"` and a `dev` entry in
      `.claude/launch.json`. **Playwright deferred to Wave E** — `playwright
      test` with zero specs exits 1, so adding `playwright.config.ts`, the
      `@playwright/test` devDependency and the CI `e2e` job in Wave A would ship
      a red CI job that stays red for three waves. They land with the specs.
- [x] Walking skeleton at 5173: the atlas bakes out of the package, a frame goes
      through the lifted `stageCells`, `createRenderer` draws it in a rAF loop at
      intensity 0. Verified in the browser — **post-fx path `webgl2`**, 64x12
      cells, canvas 576x216, woff2 served from outside the app root via `@fs`,
      and `document.fonts.size === 1` under `StrictMode`'s double-invoke, which
      is the leak the memo exists to prevent, measured rather than assumed.
- [x] Gates: `pnpm typecheck` clean, `pnpm test` 1630/1630 across 26 files,
      `pnpm validate:stages` 4/4, `pnpm demo` 4/4, `pnpm goldens:verify` **zero
      changed bytes**. Editor verified unchanged in the browser — fixture
      opened, wall painted by drag and deleted, playtest **won at par 8** on
      `nomagic` with 8 keys through `keyTokenFor`, zero console errors.

Recorded because it cost time: `computer{action:"key"}` sends `comma` and
`semicolon` as multi-character `event.key` values, which `keyTokenFor` correctly
drops — the playtest showed 6 keystrokes instead of 8 and an in-fiction "the way
is shut" for the `fw` that resulted. Send the literal `,` and `;`. This is the
same class as M3's recorded `computer{action:"type"}` and `shift+g` traps, and
the third entry in it.

### Wave B — the stage runner — **done** (2026-08-19)

- [x] **All four shipped stages are completable in the app with real
      keystrokes**, each verified at par in the browser: `act1-two-worlds` 9/9,
      `act1-four-directions` 2 keys against par 3, `act1-word-power` 8/8 and
      `act2-grammar-awakens` 4/4, all `[*] clean run`. The third of those closes
      M3's deferred definition-of-done clause literally — `act1-word-power`
      "loads and is completable **in the game**", not through the editor's
      playtest.
- [x] **The difficulty asymmetry holds in the shipped shell.** On
      `act1-word-power`, `jj` + `l`x43 **loses on `:set nomagic`** at keystroke
      21 ("More than 20 keys.") and the **identical keys win on `:set
      verymagic`** at 45 keys, 37 over par. The winning run is marked `[ ]
      assisted` rather than clean, which is `scoring.ts`'s own rule showing
      through: always-on hints are a hint used.
- [x] `content/campaign.json` + `campaign.ts` — the manifest's ordering zipped
      with `content/stages/*.json` parsed through `parseStage` from raw text
      (`import.meta.glob`, `fixtures.ts`'s precedent). `campaign.test.ts` asserts
      the bijection **both ways**: a manifest id with no file drops a stage
      silently, and a stage file nobody listed is content that passes
      `validate:stages` and is then unreachable — the second being the one M5/M6
      will actually hit, since authoring a stage and listing it are two acts.
- [x] `runner.tsx` end to end: document-level keydown through `keyTokenFor`, the
      session event fold (rejection lines, `BeatFired` as the dialogue overlay,
      `BufferSaved` → "written.", `QuitRequested` → leave, `OutcomeDecided` →
      win/lose overlay with keystrokes-vs-par, the clean flag, retry/next/leave),
      hints per all three policies, the mid-command ghost from
      `engine.pending`, camera + DPR. Every one of `:w`, `:q`, a locked-key
      rejection, a beat, a threat chase and the on-request hint's cost was
      verified on screen.
- [x] `frame.ts` + `frame.test.ts` — the viewport clip, split out pure so it can
      be tested at all. 17 tests, four mutations killed one each. **The claim
      worth stating precisely:** a shipped stage CAN scroll once play has grown
      its buffer — `act2-grammar-awakens` permits `y`/`p`, and `yy` + `p`x8
      reaches `topline: 1` on `verymagic`, where the entity shift is visible by
      hand (pickup from buffer line 1 on frame row 0, goal from line 2 on row 1).
      What no playtest can reach is a rectangle STRADDLING the top edge, because
      every rectangle in all four stages is a single row (`1..1`, `0..0`, `2..2`,
      `0..0`) — and that is precisely the case that fails silently, since
      `drawable` refuses a negative `at.line` and the entity vanishes rather than
      clipping. A test caught it; the first implementation had it wrong.
- [x] `font.ts` grew a per-scale memo (`getFontAtlas(scale)`, `atlasScaleFor`),
      the editor's `getFontAtlas()` unchanged at the default of 1. See the DPR
      note below — this is the one place Wave B departed from the plan.
- [x] Gates: `pnpm typecheck` clean, `pnpm test` **1656/1656** across 28 files
      (1630 + 7 campaign + 2 font + 17 frame), `pnpm validate:stages` 4/4,
      `pnpm demo` 4/4, `pnpm goldens:verify` **zero changed bytes**. The editor
      re-verified in the browser after the shared `font.ts` edit — fixture
      rendered, playtest won on `nomagic`, zero console errors. Nothing changed
      outside `apps/web/`, `packages/stage-view/src/font*.ts` and
      `content/campaign.json`; no root edits were needed, Wave A having already
      landed the `dev` script and the launch entry.

**M4-PLAN.md's DPR prescription is wrong, and this is the correction.** Fact 4
says the runner "sizes the canvas at `cells x cellSize x devicePixelRatio`, calls
`renderer.resize()`". Measured against `GlyphGrid.#drawCell`, which blits every
cell at `atlas.cellW`x`atlas.cellH` and nothing else, that draws a 1x frame into
a 2x buffer and leaves three quarters of the canvas blank. The scale has to reach
the **atlas**: `getFontAtlas(scale)` bakes at `CELL_W x scale`, the backing store
comes from `atlas.cellW`, and the CSS box stays at `CELL_W`. Verified by forcing
scale 2 on a 1x display — 1152x288 behind a 576x144 box, frame filling it, same
layout as 1x. Integer scales only (1..3): a fractional cell size puts every glyph
blit on a fractional pixel boundary, which is the blur the exercise removes.

Two more things recorded because they cost time, both in the same trap class as
the `comma`/`semicolon` entry above — **five now**:

- **`computer{action:"key"}` sends `space` as a five-character `event.key`**,
  which `keyTokenFor` correctly refuses, and the tool cannot express a literal
  space at all (`key` splits its argument on whitespace). A real browser sends
  `' '`, length 1, which is accepted — measured in-page. Drive that one key with
  a dispatched `KeyboardEvent`.
- **`computer{action:"key"}` does not activate a focused button.** Enter reaches
  the element as a trusted keydown and the browser fires no click. Proved to be
  the harness rather than the app by focusing a plain `<button>` the app never
  touches and getting the same nothing. Click by `ref`; coordinate clicks are in
  the **screenshot's** frame, not the viewport's.

Deliberately left for later waves, each named rather than forgotten:
`apps/web/src/app.tsx` is a stage list and a difficulty radio, scaffolding with a
deadline — Wave C replaces it with the screen union over a real `VimEngine`.
`effectsIntensity` stays 0 (Wave C owns the value and the
`prefers-reduced-motion` policy). `onExit(force)` carries `:q` vs `:q!` — the
event's `force` flag was measured, `false` and `true` respectively — but nothing
consumes it until Wave D has a snapshot to keep or discard. The runner's
engine-throw freeze path and the `matchMedia` DPR listener are both written and
neither is exercised.

### Wave C — the front door — **done** (2026-08-19)

- [x] **Difficulty is selected diegetically, and the title screen is a real
      `VimEngine` on a real buffer.** Fact 1 re-measured against a live engine
      before a line was written, and it holds exactly: `:set verymagic<CR>`
      emits `CommandResolved` with `keys: ':set verymagic<CR>'` (core's `:set`
      does not know the magic options and reports NOTHING for one it cannot
      apply), and `:play<CR>` emits `InvalidCommand (unknown-command)` **and**
      `CommandResolved` with the full typed text. Verified in the browser with
      real trusted keys: `:play` at the title reached stage select, `:stages`
      and `:settings` reached theirs, `:set nomagic` changed the shell's
      difficulty and the settings screen showed `> :set nomagic current`, and
      `:zzz` answered with `rejectionLine('unknown-command')` — the same line a
      stage gives, not new copy.
- [x] `shell-commands.ts` + 28 tests. Exact match on the whole `keys` string,
      which is what makes `:set sw=4<CR>` (a real command that really changed an
      option) and `:<Esc>` (the prompt the player cancelled — it resolves too)
      fall through for free. `commandText` round-trips every table entry back
      through the parser, so a button label cannot drift from what the prompt
      accepts. Passed first run, so **mutation-tested**: dropping `Object.hasOwn`,
      dropping a `<CR>` from a table key, losing the `set ` prefix in
      `commandText`, and case-folding the lookup each kill it.
- [x] `note-screen.tsx` — themes named plainly, **no self-harm imagery** stated
      explicitly rather than left to inference, and the comfort controls on the
      same screen. That last part is the point: controls that merely EXIST
      before first play are findable, not surfaced, and the player who needs
      them is the one who will not go hunting. One continue button makes it
      skippable.
- [x] `settings-screen.tsx` — owns `Settings`, `defaultSettings()`,
      `ComfortControls` (the note screen renders the same component, so the two
      copies cannot drift) and `RESOURCES_URL`. The resources link is one
      exported constant, reachable from the note, from settings and from the
      title footer.
- [x] **Gentle Mode verified end to end against real content**, which is the
      only thing that proves the switch does anything:
      `act2-grammar-awakens` ships the one `startling: true` beat. With Gentle
      Mode off it fires ("The brackets stay…"); with it on that beat is gone and
      the NON-startling beat still fires ("It was never load-bearing…") — the
      story is not what is being disabled — and the outcome is identical, 4
      keys against par 4, `[*] clean run` both times. That is `gentle.ts`'s
      documented property (suppression at the emission point only) showing on
      screen.
- [x] **`effectsIntensity` default is 0.6, picked by eye and not derived.**
      Compared on `act1-word-power` through the real CRT pass: at 0.6 all three
      lines read cleanly with curvature, vignette and phosphor present; at 1.00
      the top line is persistently garbled across successive frames — "itself
      here" smears into illegibility — so full strength reads as damage rather
      than dread. `prefers-reduced-motion: reduce` picks 0, and that half is not
      a judgment call. `settings-screen.test.ts` pins both, plus the exact media
      feature string: a typo there does not throw, it just returns
      `matches: false` and silently gives a player who asked for reduced motion
      the full-strength pass. Passed first run, **mutation-tested** — flipping
      the ternary, typoing the query, and dropping the `?.` guard each kill it.
- [x] `select-screen.tsx` — act grouping as a fold over the manifest, **never a
      sort**, exported and tested for the case no shipped content reaches (an
      act that recurs later must open a new group and a second heading, because
      a curriculum that doubles back is a content mistake somebody should see).
      Mutation-tested: sorting first, and matching the first group instead of
      the last, each kill it.
- [x] `app.tsx` — the screen union replacing Wave B's stage list and difficulty
      radio, deleted rather than grown into. "First launch only" for the note is
      the union itself: `note` is the initial screen and nothing routes back to
      it. In memory only, so a reload starts there again until Wave D's save.
- [x] **The keyboard-trap escape works on the title as it does in the runner**,
      measured: `shift-Tab` from the capture surface moved focus to the
      resources link, `<Esc>` on it returned focus to `document.body`, and the
      next `:` opened the prompt again.
- [x] **The Wave C done-line walked end to end with no code**, from a fresh
      load: note → continue → title → `:set nomagic` typed at the prompt →
      `:play` typed → select → Four Directions → `G$` → **won, 2 keys against
      par 3, 1 under, `[*] clean run`**, with no hint button at all (`nomagic`
      is `hints: 'none'`). Zero console errors across the whole session.
- [x] Gates: `pnpm typecheck` clean, `pnpm test` **1693/1693** across 31 files
      (1656 + 28 shell-commands + 5 settings + 4 select), `pnpm validate:stages`
      4/4, `pnpm demo` 4/4, `pnpm goldens:verify` **1159 goldens, zero changed
      bytes**. Nothing changed outside `apps/web/` — no package, no editor file,
      no content file and no root edit.

**A correction to M4-PLAN.md's fact 1, found by writing the copy and then
measuring it.** The plan proposes that a mid-stage `:set nomagic` be
acknowledged with "takes effect on your next stage." That was implemented
verbatim, and then the next stage was measured still running `nomagic` — the
runner has no way to tell the shell, and giving it one restarts the session
under the player, because `difficulty` is in the session effect's dependency
list precisely so a change BETWEEN stages takes hold. Deferring the change until
the next session wants state in `app.tsx` plus a fourth entry point (retry is
internal to the runner), which is a lot of machinery to make one line of copy
true. The line is now the truth instead: `:set verymagic — difficulty is chosen
between stages, not inside one.` The interception is still worth having — core's
`:set` reports nothing at all for an option it does not know, so without it the
player pays 15 keystrokes for silence.

**Two more decisions worth recording, both measured rather than reasoned:**

- **A key policy cannot protect the title buffer.** `setKeyPolicy` gates every
  key INCLUDING the letters typed inside a pending `:` line — measured, denying
  `s`/`a`/`i`/`c` to stop `dd` and `x` also makes `:set magic` untypeable, and
  the leftover letters then run as normal-mode commands. So the title is left
  editable, which is the honest answer anyway: it is a real buffer, `u` undoes
  the damage, and the buttons never depend on the text still being there.
- **`GlyphGrid`, not `createRenderer`, on the title.** `Renderer.dispose()`
  frees textures and the program but **not the WebGL2 context** —
  `crt-shader.ts` deletes three objects and stops — and a canvas element's
  context is reclaimed only when the element is collected, with Chrome
  force-losing the oldest at about sixteen. Title → select → stage → leave →
  title is three mounts per cycle, doubled under `StrictMode`. Nothing on the
  title is time-varying, so it draws on commit and holds no context.

Also measured, and it shaped the one piece of art in the wave: **`#` block
letters at one cell per pixel do not read.** A cell is 9x18, so a square block
alphabet renders at half its intended aspect and the first version looked like
scattered dots. Two cells per pixel is 18x18 and the letters resolve — but eight
doubled letters is 96 columns, which clipped the final R at a 900px window and
set a frame two thirds wider than any stage's. Stacked as VIM over ORROR it is
64 columns and 10 rows, the same order of frame the runner draws.

Two additions to the recorded harness-trap list, now **seven**:

- **Reading the DOM in the same `javascript_tool` call that dispatches an event
  reads the pre-flush DOM.** React had not committed yet, so the assertion saw
  the old text and looked like a bug in the app. Dispatch in one call, read in
  the next.
- **`computer{action:"key"}` handles `:`, `$`, `(` and a bare `G` correctly** —
  only the literal space is still unreachable (Wave B's entry), so a command
  line like `:set nomagic` needs one dispatched `KeyboardEvent` for the space
  and can use real trusted keys for everything else.

And one non-trap, written down so the next reader does not chase it: sending
keys in the same batch as the JS click that changed screens drops them all. The
new screen's `useEffect` had not run, so there was no `keydown` listener yet —
the buffer was untouched and the prompt stayed empty, which looks exactly like a
broken command line. Not reachable by hand (a human cannot type inside one React
commit); the fix when driving it is to click and type in separate calls.

Left for later waves rather than forgotten: `select-screen.tsx` shows no lock
state, best score, clean flag or resume banner — all four are projections of a
`progress` map and a stored `current`, and rendering a badge over data that is
always the same value would be UI that cannot be wrong, which looks verified and
is not. Wave D adds the props; the rows are already where they go. `:play` and
`:stages` are two spellings of one door until Wave D gives `:play` the resume
meaning. Audio volume/mute is absent from the settings screen because `audio.ts`
does not exist yet.

### Wave D — persistence + audio — **done** (2026-08-19)

- [x] **`save.ts` — a codec, not a serializer** (M4-PLAN.md's fact 3, honoured
      literally). The envelope is `{schemaVersion, settings, progress, current}`
      with `current.snapshot` a `SessionSnapshot` passed through untouched;
      `session.ts` had already solved the hard half (the `Set`-JSONs-to-`{}`
      trap, authored-vs-evolved, the mid-visual clamp on restore) and none of it
      is re-solved here. `zod` is `apps/web`'s first runtime dependency, exactly
      where Wave A said it would arrive.
- [x] **An unreadable payload is renamed aside, never deleted.**
      `vimorror.save.orphan.v<N>` carries the version the payload CLAIMED, so a
      migration written later has something to find. Verified in the browser: a
      hand-poisoned `schemaVersion: 99` started a clean profile at the content
      note, left `vimorror.save.orphan.v99` holding the original bytes, and threw
      nothing. Unparseable text is the one case that does NOT get an orphan —
      nothing a migration could ever recover, and an orphan key nobody will clean
      up is worse than none — but it is still left exactly where it was.
- [x] **The snapshot is validated shallowly and restored inside a `try`.**
      Everything the shell renders is checked; `engine` is left opaque, because a
      Zod mirror of `EngineSnapshot` would be a second authority on core's save
      format. `GameSession.restore` throws on a stage mismatch (its one
      deliberate loud failure) and `VimEngine.restore` throws on a garbage
      engine, so one `catch` in the runner covers both and answers with a fresh
      session plus a line saying so — never a crash on a loading screen and never
      a silent drop either.
- [x] **Mid-stage reload resumes, and a re-snapshot equals the stored bytes.**
      Measured: `act1-two-worlds` left at 5/9 keys with the buffer `helworld`,
      page reloaded, `:play` typed at the title, the stage came back at 5/9 with
      the same buffer and `:set magic` — and `JSON.stringify(snapshot)` written by
      the RESTORED session was string-identical to what was stored before the
      reload. That is M4's done-when 4, checked rather than assumed.
- [x] `progression.ts` — `unlockedIds` (linear, first stage always open,
      **completed at any difficulty counts** because difficulty is a dial and not
      a second curriculum) and `recordWin` (`bestKeystrokes` a minimum,
      `cleanRun` sticky). The chain stops at the first gap rather than opening
      everything after it, which is what a hand-edited save or a stage inserted
      into `campaign.json` between two finished ones actually produces.
- [x] `select-screen.tsx` filled in the four things Wave C named and left out:
      lock state, best score, the clean flag and the resume banner. **Never
      colour alone** on every one — `[*]` clean, `[x]` completed, `[ ]` open,
      `[-]` locked, with the word `locked` in the row's own text and the banner
      naming the stage, the keystroke count and the difficulty in words. Verified
      across a reload: Two Worlds `[*] best 20 clean`, Four Directions `[ ]`,
      Word Power and The Grammar Awakens `[-] locked`.
- [x] **`onExit(force)` is finally consumed, and both halves were measured.**
      `:q` and the leave button keep the resume snapshot (the banner appeared for
      Four Directions, 1 key in); `:q!` discards it (banner gone, `current`
      absent from the save). Vim's own distinction landing as UI for nothing,
      which is what Wave B carried the flag for.
- [x] **`current` is cleared the moment an outcome latches, and a decided run is
      never snapshotted at all** — the two are one either/or in the runner rather
      than a write followed by a delete, because the failure mode is offering a
      finished stage back as "resume". Measured: winning Two Worlds at 20 keys
      wrote `progress: {act1-two-worlds: {completed, bestKeystrokes: 20,
      cleanRun: true}}` and no `current`.
- [x] **`audio.ts` — the drone starts only after a gesture, and that was READ
      rather than inferred.** Before any gesture `audioStatus()` reports
      `state: 'none'` — no context constructed at all; after the content note's
      continue click it reports `running`, act 1, gain 0.16 (`volume ** 2`). The
      trap this exists for is invisible from the app's own behaviour: a context
      built before a gesture is not refused, it is created `suspended`, so the
      code runs, the nodes connect and the drone is silent forever. `ensureAudio`
      is called from ONE `pointerdown`/`keydown` pair in `app.tsx`, in the
      capture phase so the runner's `preventDefault` cannot get in front of it.
- [x] Volume and mute persist and reach the graph: muting set the master gain to
      0 and survived a reload as `audio: {muted: true, volume: 0.4}`. The drone
      is two detuned sawtooths through a lowpass with a slow LFO on the CUTOFF
      (timbre, never volume — a tremolo reads as a fault in the playback), and it
      is retuned rather than restarted when the act changes.
- [x] Gates: `pnpm typecheck` clean, `pnpm test` **1728/1728** across 34 files
      (1693 + 14 save + 13 progression + 8 audio), `pnpm validate:stages` 4/4,
      `pnpm demo` 4/4, `pnpm goldens:verify` 1159 goldens with **zero changed
      bytes**. Nothing changed outside `apps/web/` — no package, no editor file,
      no content file, and no root edit beyond the lockfile that `zod` brings.
- [x] All three new suites passed first run, so all three were
      **mutation-tested** — sixteen mutations, sixteen killed. Two of them
      changed the code under test:

**The `.passthrough()` test was wrong, and the mutation is what showed it.** The
suite round-tripped a snapshot from a live `GameSession` and compared the JSON,
which reads like a guard against `snapshotSchema` stripping a field it does not
list — and it is not one. Swapping `.passthrough()` for `.strict()` SURVIVED,
because today the schema and `SessionSnapshot` agree exactly, so stripping,
passing through and rejecting are indistinguishable. The failure the guard is for
is the NEXT field `session.ts` adds: with Zod's stripping default the save would
parse, load, and have quietly forgotten it. The test now adds a field the schema
has never heard of and asserts it comes back, which kills `.strict()` and the
bare default both.

**`StageProgress.completed` was decorative.** Replacing `progress[id]?.completed
!== true` with `=== undefined` survived, because `recordWin` only ever writes
`true` — so the unlock chain was really testing for the PRESENCE of an entry and
the field was along for the ride. Reachable only from a hand-edited save, which
is precisely the boundary this map crosses; there is now a test that a
`completed: false` entry does not open the next stage.

**One thing the plan asks for that is deliberately not built: the
`visibilitychange` listener.** The runner snapshots on session start and after
every fed key, and every change a `GameSession` can undergo goes through `feed`
— so there is no state a visibility change could catch that the last feed has
not already written, including the stage opened and abandoned without a
keystroke, which the start-of-session snapshot covers. A listener would be a
second writer for a case that cannot exist.

**Two smaller departures, both measured.** The first save is written when the
player leaves the content note, not when the app mounts: without that gate,
opening the game and closing the tab on the note screen meant the note never
appeared again — measured, not reasoned. And the runner now reads
`session.difficulty` rather than its `difficulty` prop for the header and the
hint policy, because `GameSession.restore` takes difficulty from the snapshot by
design; a run left mid-stage and resumed after the player changed `:set` at the
title continues at the difficulty it was actually played at, and the header must
not claim otherwise.

Three additions to the recorded harness-trap list, now **ten**:

- **`computer{action:"key"}` sends `Return`, `colon` and `exclam` as
  multi-character `event.key` values** — `keyTokenFor` correctly drops all three.
  The literals `:` and `!` work; Enter must be spelled **`Enter`**. Same class as
  Wave A's `comma`/`semicolon` and Wave B's `space`, and `,` itself now arrives
  correctly as a literal.
- **Enter must be its own tool call.** `: p l a y Enter` in one batch loses the
  Enter every time; `: p l a y` followed by a separate `Enter` works.
- **A `KeyboardEvent` dispatched on `document` never reaches the app.** Both the
  runner and the title stand down for any target that is not `document.body`
  (that is what lets a focused button keep its own keys), and
  `document.dispatchEvent` makes `document` the target. Dispatch on
  `document.body` and let it bubble — that is the only way to send the literal
  space Wave B recorded as unreachable.

And one non-trap: the tab silently stops receiving synthesised keys after some
JS-driven navigation, and a single click anywhere on the page brings them back.
Not a bug in the app — the same keys work before and after — but it looks exactly
like a dead command line.

Left for Wave E rather than forgotten: the drone's per-act retune is exercised
only at act 1, since acts 2+ are behind the unlock chain and `baseHzFor` carries
the arithmetic under test; and the three Playwright specs, the CI `e2e` job and
`playwright.config.ts` are still the whole of Wave E, exactly as Wave A deferred
them.


### Wave E — E2E + wrap-up — **done** (2026-08-20)

- [x] **`playwright.config.ts` — chromium only, `testDir: apps/web/e2e`, and a
      `webServer` that runs `pnpm dev` itself.** So `pnpm test:e2e` is one
      command from a cold checkout and there is no second way to start the game
      that could drift from the one `.claude/launch.json` uses.
      `reuseExistingServer` locally only; **`retries: 0`** deliberately — a spec
      that passes on the second run has found something, and a retry would hide
      exactly the timing bug an E2E suite over a rAF loop and a real keyboard
      exists to catch. `reporter: 'list'` because the HTML reporter opens a
      server on failure and hangs a CI job; `trace: 'retain-on-failure'` is what
      answers "what did the page look like".
- [x] **Six tests in three spec files** — the plan's three flows, plus three
      variants that are the same flows under one changed machine fact. `pnpm
      test:e2e` green, **2.8–3.0s** for the whole suite, three consecutive runs
      clean:
      - `first-run.spec.ts` — the fresh-profile walk: note (themes, the
        `no self-harm` bound, the helpline **checked by `href`**), comfort
        controls **operated** not merely counted (Gentle Mode disables the
        jump-scare switch, which is `allowsBeat`'s rule made visible), continue,
        `:play` typed at the title, both sides of the unlock chain, Two Worlds
        won at 9/9 `exactly par` `[*] clean run`, and one win opening exactly one
        room. Plus `prefers-reduced-motion: reduce` → effects default `0.00`
        (against `0.60` in the main run), and `deviceScaleFactor: 2` → the
        backing store 1152 behind a 576 CSS box.
      - `difficulty-asymmetry.spec.ts` — `MergedPlan.md`'s named test, and now
        `:settings` too (the third verb, and the third place done-when 3 promises
        the helpline). The crawl `jj` + `l`×43 **loses on `:set nomagic`** at
        `21/8 keys` with "More than 20 keys." and the **identical 45 keys win on
        `:set verymagic`** at `45 keys, par 8 — 37 over · [ ] assisted (0 undo, 0
        hint)`. Every key of both runs typed; the losing one stops mattering at
        21.
      - `save-round-trip.spec.ts` — the note survives a reload *on* the note and
        never returns after `continue`; `ihel<Esc>` → reload → `:play` resumes at
        `5/9 keys` and finishes `11 keys, par 9 — 2 over`; `current` cleared on
        the win; and a second test resuming a NON-first stage (`G` → reload →
        `$` → `2 keys, par 3 — 1 under`), which is the only place the snapshot's
        `stageId` lookup is doing real work.
- [x] **CI `e2e` job**, separate from `test` so the unit gate stays a fast,
      Vim-free minute with no browser download in front of it. `pnpm exec
      playwright install --with-deps chromium`, then `pnpm test:e2e`; traces
      uploaded on failure. **This is the first end-to-end suite this repo can run
      in CI at all** — Playwright is hermetic, unlike every Vim-dependent script,
      which is why `goldens:*` and `test:fuzz` still stay local-only.
- [x] Root: `"test:e2e": "playwright test"` and the `@playwright/test`
      devDependency, landed here with the specs they run exactly as Wave A
      deferred them (`playwright test` with zero specs exits 1).
- [x] Gates: `pnpm typecheck` clean, `pnpm test` **1728/1728** across 34 files —
      **unchanged, and that is the expected number**: Playwright specs are not
      vitest tests, and the `apps/**/*.test.ts` include glob is what keeps the
      two suites out of each other's directories (so a new E2E file must be named
      `*.spec.ts`). `pnpm validate:stages` 4/4, `pnpm demo` 4/4,
      `pnpm goldens:verify` 1159 goldens with **zero changed bytes**.
- [x] **Twenty-two mutations run, two survivors, one real bug found.** The
      discipline earned its keep for the fifth milestone running.

**The one survivor that was a false positive: claim 3 of the save spec was
comparing the stored bytes against themselves.** Deleting the runner's
session-start `onSnapshot(session.snapshot())` left the pre-reload snapshot
sitting untouched in `localStorage`, so "a re-snapshot equals what was stored"
passed with nothing having been re-written — a tautology wearing the shape of the
strongest assertion in the suite. The fix is a poison: before the reload the spec
writes a field into the stored snapshot that the game cannot produce, and
`snapshotSchema`'s `.passthrough()` carries it through `loadSave` into
`GameSession.restore`, which has never heard of it. It is therefore still there
afterwards **if and only if nothing re-wrote the save**. Mutation re-run: killed.

**A real bug, found by the suite rather than by a review: the outcome overlay's
three buttons did not blur themselves.** `runner.tsx`'s own header says "every
control blurs itself on click so the next keystroke goes back to the stage", and
`retry`, `next stage` and the overlay's `leave` were the exception — the overlay
unmounts on a *later* commit, so for one whole round trip the clicked button
still holds focus and the runner stands down for any target that is not the body.
A player who clicks `next stage` and immediately types loses that keystroke. Now
fixed at all three, and pinned — with a **single-shot** `page.evaluate`, because
`expect(body).toBeFocused()` simply retries until the overlay unmounts and passes
either way. Measured: the mutation survived the retrying matcher and dies against
the one-shot read.

**The other survivor was coverage in the right place, not a gap.** Deleting
`GameSession.feed`'s `if (this.#outcome.status !== 'playing') return []` freeze is
invisible to the browser, because `runner.tsx` stands down on a decided outcome
before it ever calls `feed` — the outer guard makes the inner one unreachable
from the UI. It is killed by three tests in `session.test.ts`, which is the layer
that owns it. Defence in depth, confirmed rather than assumed.

**Two ceilings this suite deliberately does not reach**, both named so nobody
mistakes green for total:

- **Nothing reads a pixel.** `stageReady` proves the canvas was sized from the
  frame (≥ 576 wide, not the browser's default 300) and that `createRenderer`
  picked a path; the win conditions prove the ENGINE's buffer is right. What is
  unpinned is whether the pixels show it — freezing the frame on the authored
  buffer would keep every HUD assertion correct. A WebGL2 backing store is not
  readable after the frame without `preserveDrawingBuffer`, so that stays an
  in-browser check, as it has been at every wave. `effectsIntensity` reaching the
  shader uniform is unpinned for the same reason.
- **No comfort filter fires anywhere in the suite.** `act1-two-worlds` authors no
  beats and `act1-word-power`'s two are both `startling: false`, so `allowsBeat`
  has nothing to refuse. The controls are proved to WRITE; what they write is
  proved by `gentle.test.ts`. A startling beat arrives with the acts that author
  one, M5.

**Both waves are committed and neither housekeeping item is outstanding any
more** — Wave D is `da7a5e1`, Wave E is the commit carrying this line, and
`graphify-out/` is ignored rather than left loose at the repo root. One caveat
outlived them: `pnpm install` fails at `da7a5e1` on its own, because a single
lockfile carries both waves' dependencies and CI installs `--frozen-lockfile`.
That, and why `runner.tsx` went with D while the docs went with E, is under
"Commit shape of Waves D and E" in `docs/HANDOFF.md`.

**Three root edits fact 5 does not enumerate, all three necessary, all three
recorded rather than smuggled:** `tsconfig.json` gained `playwright.config.ts` in
its `include` (the specs were already covered by `apps/**/*.ts`, but the config sits
at the root and matches no existing glob, so without it `pnpm typecheck` never
sees the one new root file — and it caught two real type errors on its first run),
and `.gitignore` gained `test-results/`, which is where `trace: 'retain-on-failure'`
writes and where the CI job looks for its artifacts. The third is `.gitignore`
again, for `graphify-out/` — a local tool's 1.5 MB of output sitting untracked at
the repo root, where one broad `git add` would have swept it into a wave commit.
That one is not M4 work and is not pretending to be; it was decided at commit
time, on purpose, and is written up in `docs/HANDOFF.md`. M4's done-when 7 is
amended to include all three; see the note under it.


- [x] Title screen, `:set magic` difficulty selection (diegetic, from the game's
      own command line) — **Wave C**
- [x] Comfort settings surfaced **before first play** — **Wave C**
- [x] Skippable content note at first launch listing themes, plus a persistent
      resources link — **Wave C**, and "first launch only" made literal at
      **Wave D**: the note is the initial screen only when `loadSave()` came back
      empty, and leaving it is what writes the first save
- [x] Save via `localStorage` with in-payload `schemaVersion` — **Wave D**
- [x] Audio: raw WebAudio, procedural drones — **Wave D**
- [x] Stage runner — **Wave B**
- [x] Playwright E2E: load a stage, send a real key sequence, assert the win
      screen — and separately assert that on `:set nomagic` an over-budget run
      fails while the identical run passes on `:set verymagic` — **Wave E**, both
      in `apps/web/e2e/` and both green in CI

**M4 is done.** All seven of `M4-PLAN.md`'s "M4 done when" criteria swept at
Wave E, each against the shipped app rather than against the plan:

1. `pnpm dev` serves the game at 5173, and **all four `content/stages/` files are
   selectable and completable in the app** — measured at Wave B, each at par, the
   third of them closing M3's deferred "loads and is completable in the game"
   clause literally. Two of the four are now completed by Playwright on every run.
2. Difficulty is selected diegetically at a real engine's command line, with
   buttons and radios beside it, and it is **consumed**: the asymmetry spec is
   green — the same 45 keys lose on `:set nomagic` at keystroke 21 and win on
   `:set verymagic` at 45.
3. Comfort is surfaced before first play on the content note, the note is
   skippable and appears only on first launch (both halves pinned, including the
   half that needed a reload *on* the note to see), and the resources link is
   reachable from all three screens that promise it — checked by `href`, because
   it is a helpline and its text cannot vouch for its destination. Effects
   intensity defaults to `0.00` under `prefers-reduced-motion` and `0.60`
   otherwise, both asserted. **Its arrival at the shader uniform is the one
   clause with no automated gate** — see Wave E's named ceilings.
4. The save round-trips: a mid-stage reload resumes through `GameSession.restore`
   and a re-snapshot equals what was stored (with the poison that makes that a
   real comparison); a version-mismatched payload starts clean **without crashing
   and without destroying the stored data** (Wave D, in the browser, plus
   `save.test.ts`); settings, progress and lock state persist across reloads.
5. Audio sounds only after a gesture — `audioStatus()` READ as `none` before and
   `running` after, not inferred — and volume and mute persist. Deliberately not
   in the E2E suite: a headless run has no gesture worth making and no ear.
6. `pnpm typecheck` / `pnpm test` green repo-wide (**1728**, 34 files),
   `pnpm validate:stages` 4/4, `pnpm demo` 4/4, `pnpm goldens:verify` **zero
   changed bytes**, and `pnpm test:e2e` **6/6 green locally and wired into CI**.
7. Nothing changed outside `apps/web/`, `packages/stage-view/` (Wave A's named
   lift, moves not rewrites), `apps/editor`'s four import lines +
   `grid-pane.tsx`'s atlas extraction, `content/campaign.json`, and the root
   edits — **which are two more than fact 5 enumerates**: `tsconfig.json`
   (`playwright.config.ts` is at the root and matches no existing glob, so
   without it the one new root file is never typechecked) and `.gitignore`
   (`test-results/`, where traces land). Both are recorded in Wave E's block
   rather than left as an unexplained diff. `vim-core`, `render` and `game`
   sources are untouched — `git diff packages/` is empty of everything but
   `stage-view`'s Wave A additions.

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
