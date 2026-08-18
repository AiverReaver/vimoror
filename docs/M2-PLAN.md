# M2 — `@vimorror/game` build plan

`MergedPlan.md` and `docs/CHECKLIST.md` both leave M2 as an undecomposed bullet
list and say every milestone after M0 "needs its own plan before it starts."
This doc is that decomposition, the same way `docs/M1-PLAN.md` was for M1.

M2 delivers `packages/game/` — a framework-free rules layer that turns a
`@vimorror/core` `VimEngine` into a playable stage: a Zod-validated stage
schema, key gating rendered in character, turn-based entities, difficulty as
pure modifier config, hints, scoring, and Gentle Mode. Nothing here renders
(that's M1's package, already done), builds app chrome or the editor (M3/M4),
or authors content (M5/M6).

## Four facts verified against source, not trusted from the plan docs

Each of these changes what M2 has to build, and three of them are not visible
anywhere in the existing bullets.

### 1. `EngineSnapshot` is missing 8 of the 11 things replay depends on

> **Resolved in Wave A (2026-08-17).** Every row below reads OK now. Building it
> turned up four things this section did not predict — they are written up under
> "What Wave A found that this plan did not" at the end of the section, because
> two of them are traps that fail *silently* and one is a defect this plan's own
> table could never have surfaced.

**This is the big one, because "director determinism" is M2's own done-line.**
`MergedPlan.md` states it as: *a replay containing injected edits must
reproduce byte-identically from its snapshot. If horror breaks replay, the
director API is wrong.*

Measured directly — build history, snapshot, restore, then run the key that
consumes that history, and diff live vs. restored:

| capability | before save | after restore | result |
|---|---|---|---|
| undo tree | `dw` | `u` | **DIVERGES** |
| redo | `dwu` | `<C-r>` | **DIVERGES** |
| dot record | `dw` | `.` | **DIVERGES** |
| marks | `majj` | `` d`a `` | **DIVERGES** |
| macros | `qaxq` | `@a` | **DIVERGES** |
| jumplist | `G` | `<C-o>` | **DIVERGES** |
| `lastFind` | `fa` | `;` | **DIVERGES** |
| key policy | `setKeyPolicy` | denied key | **DIVERGES** |
| search state | `/line<CR>` | `n` | ok |
| registers | `yw` | `"0p` | ok |
| injected undo entry | `injectUndoEntry` | `u` | ok |

**The director API is not the problem — `EngineSnapshot` is.** Injected edits
replay perfectly (measured separately: `injectEdit` mid-script reproduces
byte-identically, because every director mutation really is a pure state
transition, exactly as designed). What breaks replay is that `snapshot()`
serializes only lines/cursor/desiredCol/mode/registers/search/options.
`docs/HANDOFF.md` and three separate `CHECKLIST.md` entries already flag this
as deliberately deferred, each pointing at "revisit before the demo done-line."
That revisit is now: M2 cannot state its own done-line without it.

The `key policy` row deserves its own note, because it is not a horror concern
at all — it is a **gameplay correctness bug reachable by any player who
reloads**. `setKeyPolicy` is stage configuration, `snapshot()` doesn't carry
it, so a restored mid-stage save silently runs keys the stage locked. Key
gating is the pedagogy; it must not evaporate on reload.

**So M2 owns one `vim-core` change**, exactly as M1 owned the root
`tsconfig.json` `lib` addition: extend `EngineSnapshot` to carry undo tree,
dot record, marks, jumplist, `lastFind`, macros and `keyPolicy`, and make
`restore()` rebuild them. This is additive to a package with 1244 green tests
behind it — the existing corpus is the regression net, and every field added
is a field `restore()` currently drops on the floor, so nothing that passes
today can start failing.

#### What Wave A found that this plan did not

The claim above — "every field added is a field `restore()` currently drops on
the floor, so nothing that passes today can start failing" — held. What did not
hold is the assumption that carrying the fields is the whole job.

- **Two of the eleven cannot be carried by copying, and fail silently if you
  try.** `UndoState.nodes` is a `Map` and `KeyPolicy.allowed`/`denied` are
  `Set`s, and **`JSON.stringify` renders both as `{}`**. A `snapshot()` that
  simply spreads them typechecks perfectly, throws nothing, and restores an
  empty undo tree and an empty key policy — the key-policy half re-opening the
  exact gameplay bug this section calls out two paragraphs up. Hence
  `UndoSnapshot` and `KeyPolicySnapshot`, and hence the one test that can catch
  it: **re-snapshot a restored engine and compare the JSON strings**. Nothing
  weaker sees it, because both failures are shaped like success.
- **The list of fields is 11, not 7.** `visualStart` and `lastVisual` diverge
  identically and are not in the table above (`gv` after a reload reselected
  nothing), and `pcmark` is separate from `marks` (`` `` `` and `''` return to
  it). A restore that carries `mode: 'visual'` without `visualStart` is also
  the same class of zombie as the mid-insert restore `engine.ts` already
  documented — an engine in visual mode with no anchor.
- **`restore()` silently CLAMPS the saved cursor, which is wrong for visual
  mode.** It rebuilds through the ordinary constructor, whose
  `clamp(..., allowEndOfLine: false)` forbids the one-past-last-character
  column — and `$` in visual mode legitimately parks the cursor exactly there.
  A restored `v$` selection was one character short: **`v$d` produced
  `['', 'cd']` where the live engine produced `['cd']`, with the unnamed
  register coming back `"ab"` instead of `"ab\n"`** — buffer *and* register
  diverging, on the one mode the change had gone out of its way to preserve.
  Fixed by re-clamping cursor and `visualStart` with `allowEndOfLine: true`
  when the restored mode is visual, mirroring `gv`'s own restore path in
  `state.ts`. **This plan's divergence table could not have found it** — every
  row builds history and then consumes it from a normal-mode rest state, and
  this defect only exists mid-visual. It was caught by an adversarial review
  pass afterwards, and a test whose selection stops short of the line end
  (`vjl`) cannot see it either.
- **A dangling undo pointer is the third silent failure.** A restored
  `undoState.current` naming a node the save does not contain makes every `u` a
  no-op rather than an error; `rebuildUndo` falls back to the fresh root.

The through-line worth carrying into Wave B: **on this surface, wrong looks
exactly like right.** Three of the four defects above produce a working,
non-throwing engine that is quietly missing history. Assertions on
buffer-and-cursor alone are not enough; the JSON-identity check is what makes
them visible.

### 2. `onCommandResolved` never fires for a single-keystroke command

Measured, feeding each sequence to a fresh engine with a listener attached:

| keys | events | keys | events |
|---|---|---|---|
| `x` | **0** | `dw` | 1 — `dw`, 2 keystrokes |
| `j` | **0** | `d2w` | 1 — `d{count}w`, 3 |
| `u` | **0** | `3x` | 1 — `{count}x`, 2 |
| `.` | **0** | `ci(` | 1 — `ci(`, 3 |
| `iab<Esc>` | **0** | `:d<CR>` | 1 |

`engine.ts:89` fires only when the pending buffer *empties having held
something* — and a one-key command's buffer was never non-empty. The comment
there states this as intentional ("that is the unit keystroke scoring
counts"), but it breaks both features M2 builds on top of it:

- **Scoring.** "You did that in 7 keys, par is 3" would silently undercount
  every `x`, `j`, `u`, `.`, and every insert session. A stage solved with
  `xxx` scores **zero** keystrokes.
- **Turn-based entities.** "Threats tick only when the player acts" is Act I's
  entire mechanic ("something moves only when you do") — and Act I's stages
  are pure `hjkl` navigation, which fires no events at all. Threats would
  stand still for the whole act.

M2 owns the decision. The recommendation is to fix it in `vim-core` alongside
the snapshot work rather than counting keystrokes independently in the game
layer: `shape` is the documented scoring unit, and a second keystroke counter
in `game` would be a parallel implementation of something core already almost
does — the exact "drift between two implementations" trap `dot.ts` was
designed to avoid. Wave A pins the intended table as tests **first**, since
this is a behavior change to a package whose whole value is that its behavior
is pinned.

#### What Wave A found that this plan did not

> **Resolved in Wave A (2026-08-17).** The recommendation was taken: fixed in
> `vim-core`, no second counter in `game`.

**"Single-keystroke" turned out to be the wrong diagnosis of the right bug.**
The table above reads as "one-key commands are missed", which suggests a narrow
fix — fire when the buffer went from empty to empty. Two much larger holes sit
in the same place and are invisible in that framing:

- **An insert session's typing was never counted at all.** `ci(foo<Esc>`
  resolved at the `(` for **3 keystrokes when the player pressed 7** — it is in
  the *right* column of the table above, scored as a success. Every `c`, `i`,
  `a`, `o`, `s` stage would have scored its edit as free. Par is meaningless
  against that.
- **A whole visual operation fired nothing.** `vjd` emits zero events, because
  `v` never fills the pending buffer — so visual mode is as invisible to
  scoring and ticking as `hjkl` is, and it is not in the table above either.

So the rule is not "also fire for one-key commands" but **"a command resolves
once per return to REST"**, where rest is: no pending key buffer, no `awaiting`
accumulator, no insert session, no visual anchor (`atRest()` in `engine.ts`).
The `awaiting` clause matters on its own — `:`, `/` and a `:s ... c` confirm
session all empty the pending key buffer while still mid-command, so testing
the buffer alone would resolve `:%s/a/b/gc<CR>` and then score each `y`/`n`
response as its own command. Measured: the whole session correctly resolves as
one 17-keystroke command, and terminates on `<Esc>`/`q` rather than wedging the
counter open. An open `q` recording is deliberately **not** a rest barrier — it
spans whole commands, so `qaxq` is correctly three of them.

**And one defect the plan's framing actively hid.** The rejected-key rule this
plan states under Wave C ("a rejected key must not advance the tick") has a
prerequisite in Wave A that only surfaced while writing its test: `reject()` in
`state.ts` clears the whole half-typed pending command, so `d`, locked-`w`, `j`
left the already-spent `d` in the keystroke accumulator and resolved a phantom
two-keystroke `dj`. Keys forfeited with an aborted command are now dropped with
it — **dropped rather than resolved**, so that no tick can ever be blamed on a
locked key. A *failed* command is not a rejected one: `ci(` with no bracket in
the buffer still resolves for its 3 keystrokes. Only the key policy makes a
keypress free.

### 3. Zero scaffolding exists — `packages/game/`, `apps/`, `content/` are all absent

`pnpm-workspace.yaml` already globs `packages/*` **and `apps/*`**, so the
workspace needs no edit. `vitest.config.ts`'s `packages/**/*.test.ts` glob
already covers game's tests, and `environment: 'node'` stays correct — every
module in `game` is DOM-free by construction, same as `vim-core`.

### 4. Zod is not installed, and that is fine

`game` is where the repo's dependency policy first has to be stated precisely,
because the invariant is narrower than it looks: **"zero runtime dependencies"
binds `vim-core` only** (`CHECKLIST.md`'s invariant reads "zero runtime
dependencies, zero DOM in `vim-core`"). `MergedPlan.md` picks Zod for stages
deliberately — "stages are data; untrusted content must validate" — and stage
JSON authored in M3's editor and loaded at runtime is genuinely untrusted
input. Zod is `@vimorror/game`'s one runtime dependency. `vim-core` stays at
zero, and this plan does not add a dependency to it.

## Package scaffolding

- **`packages/game/package.json`** — mirrors `render`'s shape (`private`,
  `type: module`, `exports: {".": "./src/index.ts"}`, a `typecheck` script),
  `"@vimorror/core": "workspace:*"`, plus `"zod": "^3.24.0"`. No dependency on
  `@vimorror/render` — the rules layer must not know how anything is drawn,
  which is what lets M3's editor and M4's app compose them independently.
- **`packages/game/tsconfig.json`** — extends `tsconfig.base.json`, no `lib`
  override (game is DOM-free; it does not need M1's `DOM` addition), includes
  `src/**/*.ts`, excludes `src/**/*.test.ts`.
- **Root `package.json`** — add `zod` to the workspace via `packages/game`
  only. One new script: `"validate:stages": "node tools/validate-stages.ts"`,
  which `MergedPlan.md`'s verification table already names — the *validator
  binary* is M3's, but the schema it validates against is M2's, so the script
  lands here pointing at a tool that starts as a thin schema-check and gains
  solution replay at M3.
- **`content/stages/`** — created with a handful of fixture stages authored by
  hand as JSON (not the editor, which is M3). These are test fixtures that
  double as the first real content, and they are what proves the schema is
  authorable by a human before an editor exists to hide its ergonomics.

## File breakdown — `packages/game/src/`

Everything here is pure and unit-testable — no DOM, no canvas, no clocks. That
is not an aspiration; it is forced by the determinism invariant, since the
whole layer sits between a deterministic engine and a replay test.

- **`schema.ts`** — the Zod stage schema and its inferred TypeScript types.
  Buffer text, entity overlay, `allowedKeys`, `teachesKeys`, `par`, win/lose
  conditions, triggers, story beats, per-stage `:set` options. (This bullet read
  "per-stage difficulty overrides" until Wave E, which **decided against the
  field** — difficulty is session-level only; see Wave E below.) Exports
  `parseStage(unknown): Stage` (throws with a readable path) and
  `safeParseStage`. **This file is the contract M3's editor writes against and
  M5/M6 author against** — it is the highest-consequence file in the
  milestone, and the reason `content/stages/` gets hand-authored fixtures in
  the same wave.
- **`entities.ts`** — the entity overlay: what sits above the text layer
  (spawn, goal, walls, threats, pickups, triggers, beats), and how an entity
  occupies buffer positions. Pure position math over `Pos`, reusing core's own
  type rather than inventing a parallel one.
- **`tick.ts`** — the turn-based clock. **Threats tick only when the player
  acts**, which per finding 2 cannot be `onCommandResolved` alone. Owns the
  definition of "an act": which keystrokes advance the world, whether a
  rejected key does (it must not — otherwise a locked key still kills you,
  which is a punishment for exploring), and whether an insert session is one
  tick or one per character.
- **`rules.ts`** — win/lose evaluation against a stage's conditions, run after
  each tick. Pure `(stage, engineState, entities) => Outcome`.
- **`gating.ts`** — turns a stage's `allowedKeys`/`teachesKeys` into the
  `KeyPolicy` core already accepts, and maps a `KeyRejected` event's
  `InvalidReason` to an in-character line. Core's `InvalidReason` union is
  already 16 members wide and documented as load-bearing for exactly this;
  `gating.ts` is where it earns that, with a total map so a 17th reason added
  later is a type error rather than a silent generic message.
- **`difficulty.ts`** — `verymagic`/`magic`/`nomagic` as pure modifier config.
  **The invariant to not break: difficulty never forks the engine.** This file
  may clamp a motion *before* dispatch or suppress a failure *after*, and may
  never branch inside core. One code path, one test surface — this is what
  keeps "muscle memory transfers to real Vim" true at every level.
- **`hints.ts`** — diffs live state against the golden-solution prefix. Depends
  on a stage carrying a recorded solution, which M3's recorder produces; at M2
  the fixtures carry hand-written ones.
- **`scoring.ts`** — keystrokes vs. par, plus the "clean run" flag (no undo, no
  hints). Consumes the `ResolvedCommand` stream that finding 2 fixes.
- **`gentle.ts`** — Gentle Mode and the separate jump-scare toggle. All
  mechanics and story intact; startle beats and look-away tricks disabled.
  Framed like Celeste's Assist Mode — no penalty, no judgmental copy, which is
  a constraint on the *data* (a beat declares itself startling) rather than a
  switch buried in a renderer.
- **`session.ts`** — the façade, `game`'s `pipeline.ts`-equivalent: owns a
  `VimEngine` plus a stage, feeds keys through gating, ticks entities,
  evaluates rules, tracks score, and emits a typed event stream for M4 to
  render. This is the only stateful file in the package.
- **`index.ts`** — flat re-export, mirroring `vim-core`'s and `render`'s. Per
  M1 Wave E's lesson, `session.ts`'s own tests consume the barrel so it cannot
  go stale unnoticed.

## Build order

1. **Wave A — the `vim-core` debt M2 rests on.** `[x]` **Done 2026-08-17.**
   Findings 1 and 2, in `vim-core`, before any `packages/game/` file exists:
   extend `EngineSnapshot` (undo tree, dot record, marks, jumplist, `pcmark`,
   `lastFind`, macros, `lastMacroReg`, `keyPolicy`, `visualStart`,
   `lastVisual` — 11 fields, not the 7 this plan first listed) and settle
   `CommandResolved`, which became a return-to-REST rule rather than a
   single-key patch. Test-first, since both are behavior changes to a pinned
   package.

   Delivered in `packages/vim-core/src/engine.ts` plus a new 54-case
   `engine.test.ts` that encodes the divergence table as one parameter list and
   the resolve table as another. **1298 tests green** (1244 + 54),
   `pnpm typecheck` clean, `pnpm goldens:verify` clean with **zero golden bytes
   changed**, and `pnpm demo`'s four JSON-round-trip scenes still pass — they
   are the pre-existing consumer of `snapshot()`/`restore()`. One extra
   `vim-core` edit beyond `engine.ts`: `isVisual` exported from `state.ts` and
   reused rather than duplicated, and `marks.ts`/`dot.ts`/`macros.ts` added to
   the barrel, since `EngineSnapshot` now names `Marks`, `JumpList`,
   `DotRecord` and `MacroStore` in its public shape and `packages/game` will
   need them too.

   **Left open, and worth doing before Wave C leans on any of this:** the
   adversarial review that caught the visual-`$` clamp defect hit a session
   limit partway through — its JSON-safety, restore-hazards, resolve-rule and
   test-strength lenses never reported. Only the completeness lens finished (a
   26-case build/snapshot/restore/consume sweep, green on every field it
   covered). Re-run it; the finding it did produce was real and high-severity,
   which is the argument for finishing the other four.

   > **Resolved in Wave C (2026-08-18).** The re-run confirmed the argument:
   > the four missing lenses produced ten real `vim-core` findings on their
   > own. See "What the adversarial review caught" under Wave C below.
2. **Wave B — the schema.** `[x]` **Done 2026-08-17.** `schema.ts` +
   `entities.ts` + hand-authored `content/stages/` fixtures + `validate:stages`.
   Done when a human can author a stage as JSON and get a precise error for
   every way of getting it wrong.

   Delivered as `packages/game/{package.json,tsconfig.json}` plus
   `src/{schema,entities,index}.ts` and their two suites, three fixtures, and
   `tools/validate-stages.ts`. **1344 tests green** (1298 + 46), `pnpm
   typecheck` clean, `pnpm validate:stages` clean. `docs/CHECKLIST.md`'s Wave B
   section carries the full rule inventory; three things worth pulling up here
   because they changed the plan's own assumptions:

   - **"Triggers" and "story beats" are not two overlay items.** They collapse
     into ONE condition vocabulary shared by `win`, `lose` and a beat's `on`,
     because a trigger with no beat attached has nothing to do and a beat needs
     exactly one condition to fire on. Positional conditions name an ENTITY
     rather than carrying coordinates, which kills a whole drift class.
   - **`options` had to parse to a COMPLETE `EditorOptions`, not a partial** —
     `.partial()` types as `number | undefined` and will not spread onto
     `DEFAULT_OPTIONS` at all under `exactOptionalPropertyTypes`. A parsed stage
     now drops straight into `new VimEngine(...)`, which is the seam Wave C's
     `session.ts` wants, and a test really does build one that way.
   - **`allowedKeys` is the one field that must NOT be defaulted.** `[]` and
     absent mean opposite things to a `KeyPolicy`, so a default would silently
     pick one; `[]` is rejected outright and omission is how a stage says
     ungated.

   **Two decisions handed to Wave C**, both found by probing the fixtures
   against a real engine: entity coordinates are static and a buffer edit does
   not re-anchor them, and it is unsettled whether standing in a threat's cells
   loses or the threat must move onto you. Measured — after `di(` the
   `act2-grammar-awakens` cursor sits inside `the-aside`'s rectangle, so the
   first reading loses that stage on the first command of its own solution. The
   condition's name (`threat-reaches-cursor`) is the argument for the second.
3. **Wave C — the loop.** `[x]` **Done 2026-08-18.** `tick.ts`, `rules.ts`,
   `gating.ts`, `session.ts`. Done when a fixture stage is winnable and losable
   head-lessly through `session.feedKeys(...)`, with a locked key rejected in
   character.

   Delivered as the four files plus their suites, **1403 tests green**
   (1344 + 59), `pnpm typecheck`/`validate:stages`/`goldens:verify` (zero
   golden bytes)/`demo` all clean. The done-line holds one notch stronger
   than stated: every shipped fixture WINS through
   `session.feedKeys(stage.solution)`, the honest half of M3's replay gate.
   The two decisions Wave B handed over and the one this plan kept open are
   settled — one resolved command is one tick (insert session included, per
   the rest rule; `CommandResolved` is the tick source, so no second counter
   exists to drift), entity coordinates stay static under buffer edits, and
   standing in a threat is safe because threats chase by closing the gap
   between their own rectangle and the cursor: zero gap means no move, and
   `reached` requires a move. Lose is evaluated before win on tied ticks.
   `docs/CHECKLIST.md`'s Wave C section carries the full rule inventory.

   #### What the adversarial review caught

   The review Wave A left unfinished ran to completion in this wave — its four
   unreported lenses on `engine.ts` plus fresh lenses on the loop code, every
   finding adversarially verified before being acted on: **16 confirmed, 1
   refuted, 2 verifier-orphaned findings re-verified by hand, all 18 real ones
   fixed in the same change.** The ones that overturned this plan's own
   assumptions:

   - **The gating design as planned soft-locked its own fixture.** Translating
     `allowedKeys` verbatim into a `KeyPolicy` leaves `<Esc>` lockable, and
     the policy gate runs before dispatch in EVERY mode — so `act2`'s `i`
     (allowed for the `di(` it teaches, with `<Esc>` unlisted) trapped the
     player in insert mode with no rest, no tick, no win and no lose, forever.
     `<Esc>` is now never lockable (`ALWAYS_ALLOWED`, shared by `gating.ts`
     and the schema's playability checks so the two surfaces cannot disagree).
   - **Wave A's rejected-key rule had a hole its own table could not show.**
     `feed()` classified the fed key as rejected whenever ANY `KeyRejected`
     appeared in the event stream — but `@a`, `.` and `:normal` surface their
     INNER keys' rejections through the same stream, so a macro halted by a
     locked key mutated the buffer and then resolved NOTHING: a free edit, no
     keystroke cost, no tick. Only the fed key's own rejection resolves
     nothing now, and a halted replay resolves as the failed command it is.
   - **The forfeit rule was right only at rest.** A rejection mid-visual kept
     the discarded half-command's keys (`v`, `f`, locked key, `d` resolved a
     three-keystroke `vfd` that never ran), and the mutation test proved the
     mid-insert half ("its keys keep counting") had zero coverage. A rejection
     now forfeits exactly `pending.keyBuffer` — which holds every key of the
     half-typed command, count digits and register prefix included.
   - **A mid-insert snapshot's undo tree pointed at a different buffer.**
     Inside an insert (or `:s ... c`) session the buffer mutates ahead of the
     block's `pushUndo`, so the saved lines belonged to NO node: a restored
     `u` stepped to the wrong buffer and the saved text was unreachable by
     redo. `snapshot()` now mints the missing node — keyed on being MID-BLOCK,
     not on the lines/node mismatch alone, because `injectUndoEntry` creates
     exactly that mismatch at rest on purpose and must round-trip as-is (the
     restore-side first attempt broke that test within minutes).
   - **`injectEdit` had two desyncs of the class its own comment forbids:**
     it shifted marks/jumps/pcmark but not `lastVisual`/`visualStart` (`gv`
     after an injection deleted text the player never selected), and it
     re-clamped the cursor with normal mode's rule, pulling a live `v$`
     selection one character short — the same defect `restore()` had already
     fixed on the snapshot path.
   - **Two pre-existing `vim-core` bugs surfaced by the fresh lenses**, fixed
     with real-Vim verification: `v$<Esc>` left a normal-mode cursor ON the
     end-of-line NUL (measured: real Vim 9.1's `v$<Esc>x` deletes the last
     character; ours no-op'd), and `qa@aq` then `@a` — 7 keystrokes any player
     can type — recursed `step()` into an uncaught RangeError. The macro halt
     added a 17th `InvalidReason` (`recursive-macro`), which proved the
     `REJECTION_LINES` totality guard exactly as designed: `gating.ts` refused
     to compile until the in-fiction line existed.
   - **Six proven-by-mutation test holes** (each mutant ran green against the
     full suite before its killing test was added): per-command instead of
     per-key session keystroke counting, `RuleContext` wired to the authored
     entity array instead of the live one, rectangle threats never reaching
     with their BODY, mid-replace restore, the `v$o` anchor clamp, and a
     mid-walk jumplist idx. Plus `expandKeySpecs` crashing on a spec named
     `toString` (prototype lookup, now `Object.hasOwn`) and `session.feed`
     dropping `BufferSaved`/`QuitRequested` — which `types.ts` documents as
     existing precisely because zero-I/O core delegates `:w`/`:q` to the host,
     and this stream is their only conduit.

   The through-line, same as Wave A's: **on this surface, wrong looks exactly
   like right.** Every confirmed finding produced a working, non-throwing
   engine (bar the one crash) — and the review's verify pass earned its cost
   the other way too, refuting one plausible-sounding test-strength claim that
   a real test already covered.
4. **Wave D — the dials.** `[x]` **Done 2026-08-18.** `difficulty.ts`,
   `hints.ts`, `scoring.ts`, `gentle.ts`. Done when the identical solution
   scores differently across the three difficulties and the clean-run flag
   survives a hint request breaking it.

   Delivered as the four files plus their suites, **1444 tests green**
   (1403 + 41), `pnpm typecheck`/`validate:stages`/`goldens:verify` (zero
   golden bytes)/`demo` all clean, and nothing changed outside
   `packages/game/`. Both halves of the done-line are one test each: the
   IDENTICAL 21-key run on `act1-four-directions` is won-but-never-clean on
   `verymagic`, won-and-clean on `magic`, and LOST to the budget on `nomagic`;
   and the clean flag survives wandering and a failed motion, then breaks on
   the first hint request. `docs/CHECKLIST.md`'s Wave D section carries the
   full rule inventory; four things worth pulling up here because they changed
   this plan's own assumptions:

   - **The default difficulty no longer enforces a keystroke budget.**
     `MergedPlan.md`'s table is explicit — Normal scores the budget "not
     enforced", only Hard hard-fails — so `keystrokes-over` is live on
     `nomagic` alone, and Wave C's two budget-loss tests now name that preset.
     This is the dial that changes an OUTCOME, and it is expressed as a
     FILTERED lose list so `rules.ts` never learns difficulty exists.
   - **"Motions clamp instead of failing" was almost entirely already true**,
     measured before the dial was written: core already clamps every POSITION
     the table names (`w` past the last word lands on the last character and
     reports no failure at all), and `l` at EOL / `h` at column 0 have nowhere
     a clamp could put them. What was left to ease is the failure LINE — so
     Easy's motion dial is cosmetic, the command still resolves, costs and
     ticks, and an aborted operator (`dfz`) is silenced with it. Real
     pre-dispatch clamping would need a second motion implementation in the
     game layer, which is the drift trap `dot.ts` exists to avoid.
   - **Hints are derived from the recorded solution** — the open call this plan
     deferred to Wave D, settled that way so one recording stays
     authoritative — and are matched by STATE rather than typed keys. That is
     what lets a player who reached the same place by another route (`jjj$`
     where the solution says `G$`) still be on the path, and what makes a hint
     say `di(` instead of `d`.
   - **"Hints cost score" is the clean-run flag itself**, not a second point
     economy: on `verymagic` the hint is always on screen, so a `verymagic` run
     is never clean. That is what makes the identical solution score
     differently without difficulty touching keystrokes or par.

   The self-review caught two of its own: **a register prefix reaches undo**
   (`"au` really undoes and resolves as `"au`, so a check stripping only
   `{count}` let a player keep a clean run by typing a register they never
   used), and **a hint requested after the outcome latched changed a finished
   run's score** — `feed` froze a decided session and `hint()` did not.
5. **Wave E — wrap-up.** `[x]` **Done 2026-08-18.** `index.ts`, the
   director-determinism test, repo-wide green — plus the open-item ledger below,
   which is everything Waves A–D found, deferred or left behind. Nothing in it is
   lost, but not all of it is Wave E's: the second list is explicitly out of
   scope, because M2's own done-line forbids changing anything outside
   `packages/game/` and `content/`.

   Delivered as `GameSession.snapshot()`/`restore()` + `SessionSnapshot`, the
   keystone test plus a case per lost field, and both open decisions recorded
   where the code lives. **1467 tests green** (1444 + 23), `pnpm typecheck`/
   `validate:stages`/`goldens:verify` (zero golden bytes)/`demo` all clean.
   `docs/CHECKLIST.md`'s Wave E section carries the full inventory; four things
   worth pulling up here because they changed this plan's own assumptions:

   - **The keystone found a `vim-core` defect on its first run, and it was this
     plan's own Wave A premise that was wrong.** A mid-visual snapshot restored
     the selection perfectly and **refunded the keystrokes it had cost** — a
     restored `v$` then `d` resolved a one-keystroke `d` against the live
     engine's three-keystroke `v$d`. `engine.ts` dropped `#pendingKeys` because
     "a restore lands at rest", which Wave A's own decision to preserve visual
     mode *with its anchor* had already falsified: that IS landing mid-command.
     So the buffer reproduced byte-identically and the score did not, which is
     M2's done-line failing on the half no earlier test compared. Fixed by
     carrying `pendingKeys` — recorded **only in visual mode**, because
     recording it everywhere broke round-trip idempotence and Wave C's existing
     locked-key property caught that within one run.
   - **The nine lost fields resolved into an authored-vs-evolved split**, which
     answered more than it was asked: evolved state is carried, authored state is
     re-read from the `Stage` the host passes to `restore()`, so a stage
     corrected in M3's editor re-gates an old save instead of a stale policy
     persisting in it. `stageId` guards the seam and **throws** — the one loud
     failure on a surface where everything else fails quietly.
   - **All 23 new tests passed on the first run, so they were mutation-tested
     rather than trusted.** 17 mutants on the first sweep, 16 dead; the lone
     survivor was the key-policy re-derive, indistinguishable from copying until
     a test restored a save onto a stage whose `allowedKeys` had been corrected.
     Ended at 19 mutants and zero holes, the extra ones covering the refined
     recording rule the self-review added.
   - **Both open decisions came out "don't build it", with the measurements to
     back it.** No per-stage difficulty override (it is the player's choice, no
     dial would consume it, and "this stage is harder" is already authorable in
     `par`/budget/threats/`allowedKeys`). And a replay can still hide an undo:
     the surface is `@`/`:normal` and NOT `.` (measured — `xxu` then `.` repeats
     the `x`, since an undo never enters the dot record), recording counts its
     own `u` normally, and the tempting `undoState.current` watch was measured
     and rejected for catching a bare-`u` body while missing `xu` outright.

   #### Wave E's own work

   > **All six done 2026-08-18.** The list is left as written — it is the
   > decomposition Wave E was handed — with the two genuine open questions (5
   > and 6) answered inline below and everything the work turned up recorded in
   > the wave entry above and `docs/CHECKLIST.md`'s Wave E section.

   1. **The director-determinism test, one layer up.** The milestone keystone:
      a scripted session mixing player keys with `director.*` injections,
      snapshotted mid-run, restored, replayed and diffed byte-for-byte. Wave A
      wrote the `vim-core` half (`engine.test.ts`); this is the same test
      through `session.feedKeys` with a stage attached. Two assertions Wave A's
      experience says to include, because the engine-level suite needed both:
      **re-snapshot the restored session and compare JSON strings** (the only
      thing that catches a `Map`/`Set` reaching JSON as `{}`) and **exercise a
      `$`-in-visual selection** (the only shape that catches a cursor clamped
      on restore).
   2. **`GameSession` has no `snapshot`/`restore`, and that blocks item 1.**
      Found while assembling this ledger, and it is Wave A's finding one layer
      up: the ENGINE round-trips now, but the session wrapped around it does
      not. Nine pieces of state would silently vanish — `#entities` (the LIVE
      threat positions; the authored array is all that would come back, so
      every threat teleports to where the author drew it), `#keystrokes`,
      `#ticks` (which decides threat cadence parity on `verymagic`'s half
      speed, so a restore at the wrong parity moves threats on the wrong
      turns), `#undos`, `#hintsShown` (a clean flag that lies), `#outcome`,
      `#firedBeats` (every beat armed to fire a second time), and the
      difficulty and comfort settings. Wave A's traps apply verbatim:
      `#firedBeats` is a `Set` and `JSON.stringify` renders it `{}`, so the
      only test that sees the failure is a re-snapshot-and-diff. M4's
      `localStorage` save (`schemaVersion` in payload) is the consumer, and
      Wave D made this worse by adding three of the nine fields.
   3. **Confirm `index.ts` is complete and consumed.** It is flat and every
      suite imports through it (Wave D added `difficulty`/`hints`/`scoring`/
      `gentle`); Wave E's job is only to keep that true and check nothing new
      is missing.
   4. **Sweep the six "M2 done when" criteria explicitly**, including the last
      one — nothing changed outside `packages/game/` and `content/` except the
      Wave A `vim-core` debt. As built through Wave D that still holds: Wave D
      touched only `packages/game/` (`rules.ts`'s `evaluate` now takes its
      `lose` list as a readonly parameter rather than off the stage, which is
      how a filtered list reaches it without `rules.ts` learning that
      difficulty exists).
   5. **Decide the per-stage difficulty override.** This plan's `schema.ts`
      bullet lists "per-stage difficulty overrides" and M3's metadata panel
      names them again — and the schema as built has no such field. Its
      `options` are `:set` options and say so explicitly ("This is NOT
      difficulty"). Wave B was right not to invent it and Wave D did not need
      it, so Wave E decides: add the field, or record that difficulty is a
      session-level setting only and correct the M3 bullet. A plan that names
      a field nobody built is the kind of drift M3's editor would discover the
      expensive way.

      > **Decided in Wave E (2026-08-18): no field.** Difficulty is
      > session-level only, recorded in `schema.ts` beside the `options` block
      > that already said "This is NOT difficulty", and M3's metadata-panel
      > bullet in `docs/CHECKLIST.md` is corrected. Difficulty is the PLAYER's
      > choice about challenge, next to comfort's about tolerance, and a stage
      > that forces `nomagic` takes back a setting the player made for
      > themselves. Nothing would consume it either: all four of
      > `difficulty.ts`'s dials are session-level, so an override would have to
      > COMPOSE with the player's, and composing means ruling on who wins with
      > no consumer to justify either answer. What an author actually wants —
      > *this stage is harder* — is already authorable in `par`, a
      > `keystrokes-over` budget, threat placement and `allowedKeys`.
   6. **Decide whether a replay can hide an undo.** `scoring.ts`'s
      `isUndoCommand` reads the command SHAPE, so an undo inside `@a`, `.` or
      `:normal` is invisible to the clean-run flag — `@a` resolves as `@a`,
      whatever its body did. Narrow (a stage must permit `q`/`@` or
      `:normal`), and the fix is not a parser in the game layer: core would
      have to surface a replay's inner resolved commands. Wave E's call is
      whether that is worth doing now or stays the marked `ponytail:` ceiling
      it is today.

      > **Decided in Wave E (2026-08-18): it stays the ceiling** — with the
      > surface measured rather than assumed, which shrank it twice and killed
      > the obvious shortcut. **`.` cannot hide an undo**: `xxu` then `.`
      > repeats the `x`, because an undo is not a change and never enters the
      > dot record, so this item's own list of three is really two (`@` and
      > `:normal`). **Recording cannot hide one either**: `qauq` resolves as
      > three commands (`qa`, `u`, `q`) and that `u` counts like any other, so
      > the hole opens on the second `@a` onward. And the cheap in-layer fix —
      > watching `undoState.current` move to a node that already existed — was
      > measured and **rejected**: it catches a macro body of a bare `u` and
      > misses `xu` entirely, because the pointer returns to the very node it
      > started from while the buffer really was edited and really undone. A
      > detector that silently covers half its cases is worse than a named
      > ceiling, and the real fix is the core change this item already names.

   #### Carried forward, explicitly NOT Wave E

   Listed here so nothing is lost, with where each one actually belongs. Wave E
   must not absorb them: every item below changes a file M2's done-line puts
   out of bounds, or belongs to a milestone that has not started.

   - **`vim-core`, from M0's own handoff:** triage the remaining fuzz
     candidates (`pnpm test:fuzz` still exits non-zero over a full 10k run —
     expected live state, not a regression; the two repeat offenders are visual
     blockwise register TYPE and `iw`/`aw` counted across consecutive blank
     lines); `H`/`M`/`L`, unblocked since M1 Wave A locked `Camera`'s
     `{topline, height}` and still unwritten; `[[ ]]` section motions; `o`/`O`
     with `autoindent`; the blockwise register's WIDTH, which the golden
     comparator ignores outright.
   - **Harness, from M0:** `curswant` is captured in every golden and compared
     in none (needs virtual-column plus MAXCOL handling); mode goldens are
     unreachable without a pty oracle; undo-block goldens still depend on
     author-declared `keys:` boundaries.
   - **Mechanics deliberately left inert at Wave C:** walls and pickups are
     overlay data and `cursor-on` targets and nothing more — a wall blocks no
     motion today, which is a content-milestone decision rather than a bug, and
     `act1-four-directions` ships one that its solution never touches. The
     real-time threat opt-in ("a handful of late stages") is future work in the
     same place.
   - **Undo budgets** — `MergedPlan.md`'s difficulty table has "unlimited" /
     "limited per stage" / `'undolevels'=-1`, and Wave D modelled none of it
     because core has no undo limit and the schema has no field to carry one.
     It wants both, not a modifier that lies about them.
   - **Docs still unwritten since M0:** `docs/curriculum.md` (which owns the
     single reconciled act/skill/beat table), `docs/story-bible.md`,
     `docs/stage-schema.md`.
   - **Marked `ponytail:` ceilings, all deliberate, none urgent:** the hint path
     is replayed per request (memoize per stage if a long recorded solution
     makes it measurable); the undo tree stores a whole buffer per node, so a
     long session's save grows with edits × buffer size; `verymagic`'s motion
     dial silences the failure line rather than clamping before dispatch, which
     would need a second motion implementation in the game layer.

## Testing

Real vitest suites, co-located `src/*.test.ts`, matching both existing
packages' convention. No new test infrastructure — every module is pure.

**The director determinism test is the milestone's keystone**, and per finding
1 it was unwritable until Wave A. Its shape: a scripted session mixing player
keys with `director.*` injections, snapshotted mid-run, restored, replayed, and
diffed byte-for-byte — including the undo tree, marks and macros the restore
now carries. The divergence table above becomes its parameter list.

Wave A wrote the `vim-core`-level half of it (`engine.test.ts`: a script mixing
`feedKeys` with `injectEdit`/`injectUndoEntry`/`rewriteRegister`, round-tripped
through real JSON and then fed ``u<C-r>.@cd`a"zp`` to consume every kind of
history it built). Wave E's version is the same test one layer up, through
`session.feedKeys` with a stage attached. Two assertions Wave A's experience
says to include in that one, because the engine-level suite needed both:
**re-snapshot the restored session and compare JSON strings** (the only thing
that catches a `Map`/`Set` reaching JSON as `{}`), and **exercise a `$`-in-
visual selection** (the only shape that catches a cursor clamped on restore).

Property tests (fast-check is already wired) for the invariants a fixture
corpus cannot enumerate: a stage winnable with `allowedKeys` stays winnable at
every difficulty; Gentle Mode never changes the buffer, only which beats fire;
a rejected key never advances the tick.

## "M2 done when"

1. `pnpm typecheck`/`pnpm test` green repo-wide, including the new suites.
2. The **director determinism test passes** — a replay containing injected
   edits reproduces byte-identically from its snapshot, with undo tree, marks,
   macros and key policy surviving the round trip.
3. A hand-authored fixture stage in `content/stages/` validates, plays,
   wins, loses, gates keys in character, and scores against par — head-lessly,
   with no renderer and no app.
4. Difficulty is provably modifier-only: the same stage runs on all three
   presets with **zero branches inside `vim-core`**.
5. Gentle Mode and the jump-scare toggle disable startle beats with all
   mechanics and story intact.
6. Nothing changed outside `packages/game/` and `content/` except the Wave A
   `vim-core` debt (findings 1 and 2), which this plan states as owned. As
   built, that is exactly **four** files — this criterion said three until Wave E
   swept it and found its own accounting had forgotten the test: `engine.ts` (the
   work), `engine.test.ts` (its pins, created by Wave A and extended by Wave E,
   and named in the critical-files list below all along), `state.ts` (one
   `export` keyword on `isVisual`, reused rather than duplicated) and `index.ts`
   (barrel re-exports for the types `EngineSnapshot` now names).

**Explicitly NOT in M2:** the stage editor and solution recorder (M3); the
title screen, comfort-settings UI, save system, audio, Playwright E2E (M4);
story or curriculum content beyond test fixtures (M5/M6); React; Zustand; any
rendering.

## Open judgment calls

- **What counts as one "act" for the tick** (finding 2) — per keystroke, per
  resolved command, or per buffer change. Wave C decides it against a real
  fixture stage rather than in the abstract; it is the one choice here that
  changes how the game *feels*, and it is cheap to change in one pure file.
  Wave A narrowed it without settling it: `CommandResolved` is now a viable
  tick source on its own, since it fires for `hjkl` and for a whole visual or
  insert command alike, which it did not before. The live question is whether
  "one insert session = one tick" feels right, since that is one tick for
  arbitrarily many keystrokes — the one place the rest rule and a
  per-keystroke tick genuinely disagree. Two constraints Wave A already fixed
  in place: a **rejected** key never resolves and so can never tick, and a
  **failed** command does resolve and therefore does tick.

  > **Settled in Wave C (2026-08-18):** one resolved command is one tick, the
  > insert session included. A world that advances per typed character makes
  > `i` lethal near a threat — punishing the exact mode beginners live in —
  > and the rest rule keeps the tick on core's own resolution unit, so no
  > second keystroke counter exists to drift. Cheap to revisit: the tick
  > source is one subscription point in `session.ts`.
- Whether hints live in the stage data or are derived entirely from the
  recorded solution. Deferred to Wave D, when M3's recorder shape is closer.

  > **Settled in Wave D (2026-08-18):** derived, entirely. A second hint field
  > in the schema is a second thing to drift from the route the stage actually
  > ships, and deriving keeps M3's one recording authoritative — it yields par,
  > the hint data and a regression test from a single action, exactly as
  > planned. The derivation is a replay of `stage.solution` through a real
  > engine, matched against live state; `hints.ts` explains the two tiers.

## Critical files

- `packages/game/package.json`, `packages/game/tsconfig.json`
- `packages/game/src/schema.ts`, `entities.ts`, `tick.ts`, `rules.ts`,
  `gating.ts`, `difficulty.ts`, `hints.ts`, `scoring.ts`, `gentle.ts`,
  `session.ts`, `index.ts`
- `packages/vim-core/src/engine.ts` (Wave A — `EngineSnapshot`,
  `CommandResolved`) and its `engine.test.ts`, plus `state.ts` (`isVisual`
  exported) and `index.ts` (barrel) — the state modules it must now serialize
- `content/stages/*.json`, `tools/validate-stages.ts`
- Root `package.json` (`validate:stages` script)
