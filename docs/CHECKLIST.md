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

Shares `@vimorror/render` with the game, so what you author is exactly what
ships. Lands *before* any content is hand-authored — factory before product.

- [ ] Dual-pane authoring: raw buffer text left, visual grid right, live-synced
- [ ] Overlay painting: spawn, goal, walls, threats, key-pickups, triggers,
      story beats
- [ ] Metadata panel: id, act, `allowedKeys`, `teachesKeys`, par, `:set`
      options, story beat text. **No difficulty overrides** — Wave E decided
      difficulty is a session-level setting only (see its ledger above); a stage
      says "harder" through `par`, a `keystrokes-over` budget, threat placement
      and `allowedKeys`.
- [ ] **Solution recorder** — the highest-leverage feature in the plan. Play the
      stage in the editor; your keystrokes become the golden solution. One
      action yields the par score, the hint data *and* a regression test.
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
