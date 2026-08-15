# Wave 3 report — bugs fixed, and two things not to lose

Written to be handed to someone (or something) with no prior context. The
project is `vimorror`, a Vim interpreter validated against real Vim 9.1 via
committed golden tests. Plan of record: `MergedPlan.md`. Tracking:
`docs/CHECKLIST.md`. Current state: `docs/HANDOFF.md`. Harness rules:
`tools/goldens/README.md`.

Wave 3 is complete: 1038 goldens, 1080 tests, isolation verified.

```bash
pnpm goldens:generate && pnpm test && pnpm typecheck && pnpm goldens:verify
```

---

## Bugs found in existing code

Both were pre-existing, both invisible to the golden corpus as it stood, and
both were found by probing real Vim rather than by a failing test.

### 1. `op_delete`'s linewise promotion fired in Visual mode

**Where:** `packages/vim-core/src/operators.ts`, `applyDelete()`.

Vim promotes a multi-line charwise delete to linewise when it ends in blanks
and starts inside the indent — but it guards that with `!oap->is_VIsual`, so a
**visual** delete keeps its charwise shape. The engine promoted
unconditionally.

**Why nothing caught it:** the buffer and the cursor come out *identical*
either way. Only the register's TYPE differs. Nothing observes that until
something puts the register back, so every existing golden passed.

**Fix:** `applyDelete()` takes a `promoteLinewise` flag; `runOperator()` passes
`!fromVisual`. That required `runOperator`'s trailing boolean flags to become a
named options object (`RunOperator`), since a fourth positional boolean was
unreadable.

**Pinned by:** `motions/visual-brace` in `tools/goldens/cases/wave3-motions.yaml`.

### 2. `$` in Visual mode clamped to the last character

**Where:** `packages/vim-core/src/motions.ts`, `moveLineEnd()`, and the visual
cursor clamp in `state.ts`.

In Visual mode with `'selection'` inclusive, Vim's cursor may rest **on** the
end-of-line NUL (`col === length`), and `$` is the only motion that puts it
there — `l` refuses without `'virtualedit'`. An inclusive selection whose end
lands past the line then takes the **line break**.

Consequence: `v$d` joins the next line up, while `vlld` over the same three
characters leaves an empty line behind. The engine treated them the same.

**Fix:** `MotionContext` gained `oneMore` (Vim's `one_more`), set only from
`stepVisual`; the visual cursor clamp allows end-of-line; and `selectionRange()`
extends the region to `(line + 1, 0)` when the inclusive end passes the line
end.

**Bonus:** the same rule explains a charwise selection on an **empty** line
yielding `"\n"` — column zero there already *is* the end-of-line position. That
case was also wrong and is now covered.

**Pinned by:** `visualops/v-dollar-eats-the-newline`,
`visualops/v-ll-does-not`, `visualops/v-empty-line-selects-newline` in
`tools/goldens/cases/wave3-visualops.yaml`.

---

## Two things flagged rather than buried

### 1. `proven` has never been diffed against the engine

`tools/goldens/cases/proven.yaml` holds the seven canonical cases the original
prototype validated against real Vim — `d2w`, `ci(`, the `dw`-at-end-of-line
wart, named registers, `:s///g`, dot-repeat, `f,;x`.

They are generated and committed. **They are not run through the engine.**

`proven` is absent from the `FAMILIES` list in `tools/goldens/engine.test.ts`,
which is the only place goldens are replayed through `VimEngine`.
`tools/goldens/proven.test.ts` reads the same files but only asserts the
*generated goldens* against values hand-transcribed from `MergedPlan.md` — it
never constructs an engine. So it proves the harness is wired up correctly and
proves nothing about the interpreter.

**Why it can't be fixed yet:** `FAMILIES` is all-or-nothing per family, and
`proven/subst-g` is `:s/x/Q/g`, which is Wave 4.

**Action:** add `'proven'` to `FAMILIES` the moment `:s` lands. These are the
seven cases most worth having the engine diffed against, and their name makes
it very easy to assume they already are.

### 2. `H M L` are decided, not vaguely deferred

`H`, `M` and `L` are screen-relative, and `vim-core` has no viewport **by
design** (no DOM, no clocks, no I/O — that is what makes `replay()` exact).

**The decision: core stays viewport-free.** `H M L` are not a missing task in
the interpreter. They arrive at **M1**, implemented over a window height and
topline supplied by `@vimorror/render` — at which point they are a thin motion
over data core is *handed* rather than data core owns.

This is recorded so M1 inherits it as an input instead of re-opening the
question mid-milestone. Do not implement them in `vim-core`.

**Separately: `[[ ]]` section motions remain genuinely open.** They were in
`MergedPlan.md`'s Wave 1 inventory, no wave implemented them, and they are
**not** on Wave 4's path. `{ } ( )` were closed during Wave 3 only because they
are jump commands the jumplist needed; `[[ ]]` had no such forcing function, so
they are still outstanding with no owner.
