# M3 — `apps/editor` build plan

`MergedPlan.md` and `docs/CHECKLIST.md` leave M3 as an undecomposed bullet list
and say every milestone after M0 "needs its own plan before it starts." This doc
is that decomposition, the same way `docs/M1-PLAN.md` was for M1 and
`docs/M2-PLAN.md` for M2.

M3 delivers `apps/editor` — the stage editor: dual-pane authoring (raw buffer
text left, visual grid right, live-synced), overlay painting for entities,
a metadata panel, **the solution recorder** (the highest-leverage feature in
the whole plan: one recording yields par, the hint data and a regression test),
playtest in place, and JSON import/export via the File System Access API. It
lands *before* any content is hand-authored — factory before product, which is
Plan A's argument preserved by the merge.

Nothing here adds a game mechanic, a schema rule, a difficulty dial, or a
renderer feature. The editor is a **consumer** of M0–M2, and the one design
rule that shapes every file below is: **the editor invents no rules of its
own.** `schema.ts` stays the single validation authority (the editor renders
`formatIssues` output, never re-implements a check), `GameSession` stays the
single play loop (playtest and recording run the same session the game will),
and `GlyphGrid` stays the single way cells reach pixels. Everywhere M2 said
"a second copy is a second thing to drift," this plan routes through the first
copy instead.

## Five facts verified against source, not trusted from the plan docs

Each one changes what M3 has to build. Two remove work the plan docs still
list; one adds a `vim-core` debt nothing in the bullets mentions.

### 1. The validator — M3's CI gate — is already built and running

`MergedPlan.md`'s M3 section and its verification table both name the
validator ("replays every golden solution headlessly through core and asserts
a win using only `allowedKeys`; runs in CI over `content/stages/`") as M3
work. **It shipped on 2026-08-18**, in M2's wake: `tools/validate-stages.ts`
behind `pnpm validate:stages`, running in `.github/workflows/ci.yml` between
`typecheck` and `test`, and replaying every solution **at all three
difficulties** — which was verified worth doing rather than assumed, with a
stage that wins on `verymagic` and loses on `magic`/`nomagic` because half
threat cadence gives the threat one step where full cadence gives three.
`docs/CHECKLIST.md`'s M3 section already carries the full writeup and marks
the box.

Consequence: **M3 is the editor app and one small `vim-core` debt (fact 2),
nothing else.** No validation logic gets written in this milestone — the
editor's export gains a "worth shipping" check by *calling* the same public
`GameSession` API the validator calls, not by growing a second validator.

### 2. `render()` is not an inverse of `tokenize()`, and the recorder is what makes that a bug

The recorder's whole job is: capture the `KeyToken[]` the author played,
render them to the notation string that becomes `stage.solution`, and have
`feedKeys(solution)` replay **exactly** what was played. That render step
exists — `render(tokens)` in `packages/vim-core/src/keys.ts:145` — and it is a
naive `tokens.join('')`, while `tokenize()` treats any `<...>` of two or more
inner characters as a named key (`keys.ts:71-81`). The round trip breaks on a
literal `<` the moment enough text follows it:

- **The loud failure:** an author types `i<div><Esc>` into an HTML-flavored
  stage. The keyboard delivers seven tokens (`i` `<` `d` `i` `v` `>` `<Esc>`);
  `render` yields the string `i<div><Esc>`; `tokenize` of that string hits
  `<div>`, finds no such named key, and **throws** — so the recorded stage
  fails its own schema check ("not valid key notation") for a recording that
  was perfectly legal play.
- **The silent one, which is worse:** the four keystrokes `<` `c` `r` `>`
  render as `<cr>`, which `tokenize` canonicalizes to **one `<CR>`** — four
  printable characters silently become a press of Enter. The replayed solution
  types different text than the author did, and nothing throws anywhere.

`tokenize` already accepts `<lt>` notation — but measured (2026-08-18) it
yields the four-character token `'<lt>'`, **not** the plain `'<'` a keyboard
press produces (`CANONICAL_ALIASES` maps `<lt>` to itself, `keys.ts:59`). So
`<lt>` is currently a second, broken spelling of the same key: `isPrintable`
is false for it, a `{printable}` key policy would lock it, and normal mode
does not know it as the un-indent operator. The fix is therefore **both
directions, both inside `keys.ts`**: canonicalize `<lt>` to the char token
`'<'` so notation and keyboard agree on what the key *is*, and escape a bare
`'<'` token as `<lt>` in `render`, making `render` a true inverse of
`tokenize`.

`<Space>`/`<Bar>`/`<Bslash>` share the two-tokens-for-one-key shape but are
NOT the same fix, measured before assuming: the engine consumes the **named**
`'<Space>'` token at three real call sites (`state.ts:360,408` — the space
motion — and `insert.ts:162`), so space sits on the *opposite* side of the
split from `<lt>`: hand-written notation works and a raw typed `' '` is the
odd one out. None of the three blocks the recorder (a typed space is
`isPrintable`, inserts fine, and `render(' ')` already round-trips), so Wave A
aligns them only as far as the inverse property forces, with those call sites
in hand — `<lt>` is the load-bearing fix, the aliases are the consistency
sweep behind it.

The render half goes in `render` itself rather than in a new editor-side
function because `render` has exactly one caller today — `engine.ts:206`,
producing `ResolvedCommand.keys` — and that string feeds the ghost HUD, hints
(`Hint.keys`), and anything M4 ever replays. One guard in the shared funnel
fixes every consumer at once; a recorder-local escape would leave
`ResolvedCommand.keys` un-round-trippable for the next caller to trip over.
The cosmetic cost is that a command containing a literal `<` displays as
`<lt>` — which is Vim's own notation for it.

**So M3 owns one `vim-core` change**, exactly as M2 owned `EngineSnapshot` and
M1 owned the root `lib` addition. It is small, test-first (a fast-check
property: `tokenize(render(tokens))` deep-equals `tokens` over sequences drawn
from the canonical alphabet — fast-check is already wired), and touches zero
goldens: the comparator never sees `ResolvedCommand.keys`, so
`goldens:verify` must report zero changed bytes, and the plan treats any
nonzero as a stop-the-line signal.

### 3. `Stage` is the schema's OUTPUT type; an editor must author the INPUT type

`schema.ts` resolves every `.default()` at parse time — deliberately, so
`rules.ts`/`tick.ts` read no `undefined`s. An editor whose document model is
the parsed `Stage` would therefore **bake every default into the exported
JSON**: all seven `options` (freezing core's *current* defaults into content,
so a stage whose author never touched an option stops tracking core when a
default changes), `cursor`, `entities: []`, `lose: []`, `beats: []`,
`teachesKeys: []` — and, the one that changes *meaning* rather than just
verbosity, it cannot represent `allowedKeys` at all: omitted means ungated,
`[]` is rejected, and the parsed type has already collapsed "omitted" into
`undefined` alongside everything else the author never wrote.

So the editor's document model is **`z.input<typeof stageSchema>`** — the
authored shape, defaults unmaterialized — parsed to `Stage` only for the
preview grid and for play. Zod provides the type for free; the one change is
exporting it from `schema.ts` as `StageInput` (a one-line, type-only edit to
`packages/game`, the second and last thing M3 touches outside `apps/`). The
test that pins the whole concern: import a fixture, export it unedited, and
deep-equal the JSON — a fixture that comes back with seven `options` it never
wrote fails it.

### 4. The playtest and recorder need zero new surface on `GameSession` or `VimEngine`

Enumerated against source rather than assumed:

| the editor needs | already exists |
|---|---|
| feed one keystroke, get typed events back | `GameSession.feed(key: KeyToken): SessionEvent[]` — token-level, exactly what a `KeyboardEvent` translator produces |
| know a key was gated vs merely failed | `KeyRejected` (with the in-character `line`) vs `CommandRefused`, distinct event types |
| the running cost for par | `Tick.keystrokes` / `session.keystrokes` — resolved commands only, forfeited keys excluded |
| live threat positions for the grid | `session.entities` (the LIVE array; the authored one never moves) |
| buffer, cursor, mode for the grid + cursor shape | `engine.lines`, `engine.cursor`, `engine.mode` getters |
| the mid-command ghost readout | `engine.pending` (`PendingView`) |
| win/loss to stop recording on | `OutcomeDecided` in the stream; `session.outcome` latches and freezes the session |
| beats and `:w`/`:q` during playtest | `BeatFired`, `BufferSaved`, `QuitRequested` pass through `feed` |
| render cells | `GlyphGrid` + `linesToCells` + `bakeFontAtlas`, all standalone (M1 Wave E blessed grid-without-post-FX explicitly) |

The one number the recorder computes — the default `par` — is the recorded
token count, which at a clean win equals `session.keystrokes` (every fed token
belongs to a resolved command once no key was rejected and the win landed at
rest), and which is the quantity the schema's own check compares
(`solutionKeys.length > stage.par` is the rejection). Recording ends armed
with `par = tokens.length`, editable upward for generosity, never below.

### 5. Scaffolding is five root-config edits; React 19 is the plan of record, Zustand is not taken

`pnpm-workspace.yaml` already globs `apps/*`, so the workspace needs no edit.
What does need touching, verified against current files:

- root `tsconfig.json` — `include` covers only `packages/**` and `tools/**`;
  it gains `apps/**/*.ts` + `apps/**/*.tsx`, and `compilerOptions` gains
  `"jsx": "react-jsx"` (harmless to the packages: none contain `.tsx`).
- `vitest.config.ts` — `include` gains `apps/**/*.test.ts` (and `.tsx`), so
  the editor's pure modules are in the same `pnpm test` run as everything else.
- root `package.json` — one script, `"dev:editor": "vite apps/editor --port
  5174"`, the port `MergedPlan.md`'s verification table has named since day
  one (`dev:render` holds 5175).
- `.claude/launch.json` — a `dev:editor` entry, M1 Wave B's precedent, so the
  editor is previewable through the browser tool.
- `.github/workflows/ci.yml` — **no change.** `typecheck` and `test` pick the
  editor up through the two config edits above, and the validator is already
  there.

**React 19 is taken; Zustand is not.** The technology table picked React for
"menus, dialogue, editor panels only — never the game grid," and the editor is
the most form-heavy surface in the project (entity CRUD, a discriminated-union
condition editor, beats with per-beat flags — the places imperative DOM wiring
turns into soup). React 19 + `react-dom` + `@vitejs/plugin-react` are the
repo's first UI dependencies, confined to `apps/editor/package.json`. Zustand's
own row in that table justifies it as "works outside React **for the game
loop**" — that is M4's stage runner, not this app; the editor's entire state is
one draft object plus a little UI state, which `useReducer` covers with zero
dependencies. M4 decides Zustand for itself.

One TypeScript wart, noted so it doesn't cost an afternoon: `showOpenFilePicker`
/ `showSaveFilePicker` are WICG, **not in `lib.dom`** — the editor carries a
~10-line ambient declaration (`fsa.d.ts`) rather than a `@types` package.

## Package scaffolding

- **`apps/editor/package.json`** — `private`, `type: module`, name
  `@vimorror/editor`. Dependencies: `react` ^19, `react-dom` ^19,
  `"@vimorror/core": "workspace:*"`, `"@vimorror/game": "workspace:*"`,
  `"@vimorror/render": "workspace:*"`. Dev: `@types/react`, `@types/react-dom`,
  `@vitejs/plugin-react`. This is the first package that may depend on all
  three — the game/render independence M2 preserved ("the rules layer must not
  know how anything is drawn") is exactly what lets the editor be the one to
  compose them.
- **`apps/editor/index.html`**, **`apps/editor/vite.config.ts`** (the react
  plugin; Vite resolves the config from the root dir the script names).
- **No `apps/editor/tsconfig.json`** — the root project compiles it, same as
  both packages; package-scoped configs arrive if someone needs one, not
  before.
- The five root edits from fact 5.

## File breakdown — `apps/editor/src/`

Split by testability, which in this app means: **pure modules that vitest can
hold, thin React components that the browser verifies** — M1's testing split,
restated for a UI package. The React half stays free to merge or split
components; the pure half is the contract.

- **`draft.ts`** — the document model: `StageDraft = StageInput` plus the
  helpers around it. `parseDraft(draft)` → `{ stage?: Stage; issues?: string }`
  (a thin wrapper over `safeParseStage` + `formatIssues`, re-run on every
  edit — a stage is ~1KB of JSON, so parse-per-keystroke costs nothing worth
  caching). `blankStage()` — a minimal *valid* template (a one-line buffer, a
  goal entity, a placeholder `solution`/`par` pair the recorder will replace),
  so every panel starts from a working state instead of a wall of errors.
  `exportStage(draft)` — serialization with fields in schema order, so
  `content/stages/` diffs read the way the fixtures already do. The
  placeholder solution is honest scaffolding: an exported stage whose solution
  was never recorded fails `validate:stages` loudly ("never won"), which is
  the pipeline working, not a gap.
- **`stage-cells.ts`** — the one pure render module: `(lines, entities,
  selection?) → CellBuffer`. Text via render's own `linesToCells` (reused, not
  reimplemented), entity rectangles as a background tint per `EntityKind` plus
  the entity's **required glyph** at its anchor cell — the "never colour
  alone" invariant landing in pixels — and a highlight for the
  currently-selected entity. **This file is the seam M4 lifts** when the game
  needs the same stage-to-cells skin; it stays in the editor until that second
  consumer exists, per the same later-can-scaffold rule that kept walls inert
  at M2.
- **`keyboard.ts`** — `KeyboardEvent`-shaped input → `KeyToken | undefined`:
  ctrl+letter to `<C-x>`, the named keys core knows (`Escape`, `Enter`,
  `Backspace`, `Tab`, ...), single-character keys passed through, everything
  else `undefined` so browser defaults survive. M1's demo translator was
  "deliberately not real input handling, that's M4's job" — this is that job
  arriving one milestone early because playtest and the recorder are
  trust-boundary consumers (a mistranslated key becomes a wrong golden
  solution). Written over a structural event type so vitest drives it without
  a DOM; **M4 lifts it** alongside `stage-cells.ts`.
- **`recorder.ts`** — the pure core of the milestone's headline feature. A
  small state machine consuming `(token, SessionEvent[])` pairs from a live
  recording session and accumulating: the token list, the keystroke tally,
  whether any `KeyRejected` occurred, and whether `OutcomeDecided: won`
  arrived. `arm()` yields `{ solution: render(tokens), par: tokens.length }` —
  or a refusal with the reason. **A recording containing a rejected key
  refuses to arm**: the schema would reject the stage anyway ("the stage would
  reject its own solution"), and stripping the key is not an option because a
  rejection forfeits the whole half-typed command with it (M2 Wave A's rule) —
  the surviving token list would splice a dangling operator onto whatever came
  next. A *failed* command stays armable: the validator's own header says a
  human route may legitimately contain a failed motion. After arming, the
  editor immediately replays the armed solution through fresh `GameSession`s
  at all three difficulties — the validator's public-API loop, six lines, run
  at record time so the author learns "wins on `verymagic`, loses on
  `nomagic`" in the editor instead of in CI.
- **`files.ts`** + **`fsa.d.ts`** — File System Access open/save: one stage
  per file, filename = `<id>.json` (the validator's own rule, suggested at
  save time). Per-file pickers only; a directory-handle stage browser is a
  ceiling, noted below.
- **`store.ts`** — the `useReducer` reducer over `{ draft, selection, tool,
  mode }` where `mode` is `editing | playing | recording`. Pure by
  construction, so reducer actions are vitest-testable where they carry logic
  (entity placement from a grid drag, for instance).
- **React components** — `main.tsx`, `app.tsx` (layout + mode switch),
  `buffer-pane.tsx` (the left textarea over `draft.buffer`),
  `grid-pane.tsx` (a canvas ref owning a `GlyphGrid` imperatively — React
  never touches the grid, per the technology table's "never the game grid";
  paint interactions live here: palette click places `at`, drag sweeps a
  rectangle to `to`), `issues-pane.tsx` (the parse issues, path-prefixed),
  `metadata-panel.tsx` (id, act, title, par, cursor, `allowedKeys`,
  `teachesKeys`, `options` — **no difficulty override field exists to offer**,
  per M2 Wave E's decision, already corrected in the checklist),
  `entities-panel.tsx` (the palette, the entity list, win/lose condition
  editors over the four-kind discriminated union, beats with their required
  `startling` flag), `play-pane.tsx` (playtest + record: a difficulty picker
  defaulting to `nomagic` — the strictest preset, so a recording that
  survives it has faced full threat cadence and the enforced budget — the
  key-capture surface wired through `keyboard.ts`, the event log rendering
  beats, rejection lines and the outcome). Components merge or split freely;
  the pane list is a decomposition, not a contract.

**Deliberately absent:** the CRT pipeline. The editor renders through
`GlyphGrid` alone — authoring wants clarity, and the shared-surface claim
("what you author is exactly what ships") is about the glyph grid, atlas and
cell geometry, which *are* shared; curvature and phosphor are M4's runtime
dress. Also absent: any `Camera` scrolling — the grid pads the buffer into a
fixed frame exactly as the M1 demo does, and a stage that outgrows the frame
is a ceiling for the milestone that authors big stages.

## Build order — five waves

1. **Wave A — the debts M3 rests on. DONE 2026-08-18.** Fact 2 and fact 3, before any
   `apps/editor` file exists: the round-trip fix in
   `packages/vim-core/src/keys.ts` (canonicalize `<lt>` to `'<'`, escape a
   bare `'<'` as `<lt>` in `render`; test-first — the fast-check inverse
   property plus the named cases from fact 2), the alias alignment only as
   far as that property forces (fact 2's caveat: `'<Space>'` has three real
   engine consumers, already located — `state.ts:360,408`, `insert.ts:162` —
   and zero uses in tests or case YAMLs, pre-grepped while writing this
   plan), and `schema.ts` exports `StageInput`. Done when: `pnpm test` green
   with the new property, `pnpm goldens:verify` reports **zero changed
   bytes**, `pnpm demo` still 4/4.

   **All three met** (1483 tests, from 1473; 1159 goldens, zero bytes changed;
   demo 4/4; `validate:stages` green). One correction to the plan as written:
   the alias sweep was **not** optional trailing work, because the inverse
   property is structurally blind to it — `'<Space>'` and `' '` each round-trip
   to *themselves*, so the property passes while the two spellings mean
   different things to the engine. Measured: the space motion fired only for
   the NAMED token, so a real spacebar press did nothing at all, which Wave D's
   `keyboard.ts` would have inherited as a silent divergence from real Vim. All
   four aliases — plus `<gt>`, which threw here while `keynotation.ts` accepted
   it — now resolve to the plain character a keyboard delivers, and the three
   located call sites moved with them. The `<` escape also ended up
   **conditional** rather than unconditional, because `render`'s one caller
   feeds `Hint.keys` and the ghost HUD and `<<` would otherwise have displayed
   as `<lt><lt>`. `docs/CHECKLIST.md`'s M3 Wave A section carries the full
   writeup, including why folding the other direction (`' '` up to `'<Space>'`)
   would have soft-locked every insert-mode stage via `{printable}`.
2. **Wave B — scaffolding + the dual pane, read-only. DONE 2026-08-18.** The
   package, the five root edits, `draft.ts`, `stage-cells.ts`, `files.ts`, and
   the two panes with live sync: open a fixture through the file picker, see its
   buffer with entity tints/glyphs and spawn cursor on the grid, edit buffer text
   in the textarea, watch the grid and the issues pane update per keystroke. Done
   when: `act2-grammar-awakens.json` round-trips (fact 3's identity test),
   renders recognizably, and a deliberately-broken edit (a `\n` pasted into a
   line, a spawn moved off the buffer) surfaces the schema's own message
   live.

   **All met, with two corrections to the done-line as written and one unplanned
   file.** `docs/CHECKLIST.md`'s M3 Wave B section carries the full writeup —
   1544 tests (from 1483), zero golden bytes changed, demo 4/4 — and the parts
   that change how a reader should take this plan are:

   - **"A `\n` pasted into a line" is unreachable from the textarea**, by
     construction: a textarea normalises its own value's line breaks and
     `bufferFromText` splits on `\n`, so an editor-made edit produces one array
     entry per line always. It is reachable only from a FILE, and chasing it
     there found a real data-loss bug — such a file loaded, reported the schema's
     error correctly, and then had that line split behind the author's back on
     their first keystroke, renumbering every `cursor` and `entities[].at.line`
     below it. `readDraft` refuses it at the door now.
   - **"A spawn moved off the buffer" needs Wave C's metadata panel**, since
     Wave B's UI edits the buffer and nothing else. The reachable member of that
     class — an ENTITY pushed out of bounds by shortening the buffer — is what
     was verified instead.
   - **`fixtures.ts` is the one unplanned file**, and it exists because the rest
     of the done-line could not otherwise be verified at all:
     `showOpenFilePicker` opens a native dialog no automation can drive. It globs
     `content/stages/*.json` as raw TEXT so a bundled fixture enters through
     `readDraft`, the same door a picked file uses, rather than adding a second
     loading path. Its `import.meta.glob` is declared with a file-scoped
     `/// <reference types="vite/client" />` rather than by widening the root
     tsconfig's `types`, so fact 5's five-edit ledger stays exact.
   - **The five root edits are exactly fact 5's list**, plus `pnpm-lock.yaml`,
     which is the unavoidable consequence of the first `apps/*` package existing.
     `.github/workflows/ci.yml` is untouched, as specified.
   - `stageFileName` ended up in `draft.ts` rather than `files.ts`: it is a fact
     about the document, and `files.ts` reads `window` at module load, so nothing
     left in that file is reachable from vitest's node environment.
   - **Six bugs came out of the adversarial review, every one reproduced before
     being fixed**, the headline being that a single malformed entity blanked the
     whole page — `kind: "walls"` threw out of a React effect and unmounted the
     tree, destroying the issues pane that was about to name the typo. The
     checklist lists all six plus the mutation-sweep test gaps.
3. **Wave C — structured editing, the whole schema authorable.** Metadata
   panel, palette + paint-on-grid for entities, condition and beat editors.
   Done when: **every field `schema.ts` accepts is reachable from the UI**
   (the drift guard is the schema itself: a field added to `stageShape` later
   should force an editor change, which is why the panels build off the
   `StageInput` type rather than hand-listed field names), every
   `formatIssues` path renders next to something an author can find, and a
   stage goes from `blankStage()` to exported-and-valid without hand-editing
   JSON.
4. **Wave D — playtest + the recorder.** `keyboard.ts`, `recorder.ts`,
   `play-pane.tsx`. Playtest constructs a fresh `GameSession` from the parsed
   draft at the picked difficulty and feeds real keystrokes; recording is the
   same session with the token stream captured; a win offers to arm, arming
   writes `solution` + `par` into the draft and reports the all-three-presets
   replay. Done when: recording `di(G` on the act2 fixture arms a draft whose
   parse is clean and whose armed solution wins a fresh session with the same
   keystroke count — and a recording that trips a locked key refuses to arm
   with the reason shown.
5. **Wave E — the round trip, and wrap-up.** Export polish, then the
   milestone's definition of done executed for real: **author a brand-new
   stage start to finish in the editor** — a real curriculum candidate (Act I
   "Word Power" is the natural pick: `w b e f t ; ,` territory, no stage
   fixture covers it yet), record its solution, export it into
   `content/stages/`, and watch `pnpm validate:stages` pass **without touching
   code**. The new stage ships as the fourth fixture — the M5 pipeline proven
   one milestone early, on one stage. Sweep the done-list, update
   `docs/CHECKLIST.md` boxes and `docs/HANDOFF.md`.

`MergedPlan.md` phrases the definition of done as "confirm it loads and is
completable **in the game**" — and the game app is M4, so that sentence cannot
run literally yet. The honest M3 reading, stated here so nobody re-litigates
it: the game's *rules layer* is `GameSession`, the editor's playtest runs it,
and `validate:stages` replays the exported stage to a win through it at all
three difficulties in CI. That is "loads and is completable" in every sense
that exists before M4; the in-app confirmation re-runs at M4 as part of its
own stage-runner done-line.

## Testing

Same split M1 drew and M2 kept: pure modules get real vitest suites
(`apps/**` joins the include glob), DOM/canvas/FSA surfaces are verified
in-browser through `pnpm dev:editor` (the launch.json entry exists for exactly
this), and anything that passes on the first run gets mutation-tested rather
than trusted — M2 Wave E's discipline, kept because it caught the one
surviving mutant last time.

- **`vim-core`:** the `tokenize ∘ render = id` property over generated
  canonical-token sequences, plus fact 2's named cases — all measured, not
  assumed: `i<div><Esc>` throws today, `<` `c` `r` `>` silently becomes
  `<CR>` today, and `tokenize('<lt>')` yields the alien token `'<lt>'` today.
  All must round-trip to the keyboard's own tokens after.
- **The keystone, `recorder.ts` end to end:** drive a real `GameSession` with
  a token stream, arm, `parseStage` the armed draft, replay the armed solution
  through a *fresh* session, and assert the same win and the same keystroke
  count. This is the milestone's own claim — one action yields par, the hint
  data and a regression test — made checkable: par comes back as the count,
  `hintFor` derives from the armed solution with no further authoring, and
  the armed stage IS the regression test once exported.
- **`draft.ts`:** the import→export identity on all four fixtures (defaults
  stay unmaterialized; `allowedKeys` omission survives), `blankStage()`
  parses.
- **`stage-cells.ts`:** entity cells carry their tint AND a glyph reaches the
  anchor (the never-colour-alone invariant as an assertion), selection
  highlight, text unchanged where no entity sits.
- **`keyboard.ts`:** the translation table over synthetic events, including
  the keys that must return `undefined`.
- **In-browser:** the Wave B/C/D done-lines above, each an observable
  behavior, verified through the preview tool the way M1 verified the demo —
  screenshots and pixel/DOM checks, not eyeballing.

## "M3 done when"

1. `pnpm typecheck` / `pnpm test` green repo-wide, editor suites included.
2. **Every schema field is authorable and every schema error is surfaced in
   the editor, and the editor contains zero validation rules of its own** —
   `schema.ts` stays the single authority; the greppable form is that
   `apps/editor` imports `safeParseStage`/`formatIssues` and never adds a
   rule beside them.
3. **The recorder round-trips real play:** record → arm → the armed draft
   parses clean → the armed solution wins a fresh session at the recorded
   keystroke count; a recording containing a rejected key cannot arm.
4. `pnpm validate:stages` still green in CI over the grown corpus — the
   already-shipped validator is the standing gate this milestone feeds.
5. **The manual round-trip:** a brand-new stage authored entirely in the
   editor, exported to `content/stages/`, passing `validate:stages` and
   winnable through the editor's own playtest, with no code touched — the
   fourth fixture is the proof, committed.
6. Nothing changed outside `apps/editor/` and the five root-config edits
   (fact 5's list) except the named Wave A debt: `keys.ts` + its test file,
   and `schema.ts`'s one-line `StageInput` export. `pnpm goldens:verify`
   reports zero changed bytes at every wave.

**Explicitly NOT in M3:** the CRT pipeline in the editor (GlyphGrid only);
`Camera` scrolling for buffers bigger than the frame; a directory-handle stage
browser (per-file open/save only); Zustand; any new schema field, condition
kind, entity kind or difficulty dial; wall-blocking or pickup mechanics (still
deliberately inert from M2); the game shell, save system, audio, Playwright
(M4); authored story/curriculum content beyond the one round-trip stage
(M5/M6); and `vim-core` work beyond Wave A — the fuzz-triage backlog,
`H`/`M`/`L`, `[[ ]]` and the rest of the carried-forward ledger stay where
M2's Wave E filed them.

## Open judgment calls

- ~~**The entity skin in preview**~~ — **decided at Wave B: background tint plus
  the glyph on the anchor, with selection spelt as an inversion of the same two
  colours.** Both halves were compared on the real fixtures on screen. The
  repeated glyph reads a painted rectangle beautifully and a ONE-cell entity not
  at all — and most goals and pickups are one cell — which also settled why
  selection could not be a second glyph either. Two things the comparison
  produced that the question did not anticipate: every background has to be dark,
  because `GlyphGrid`'s cursor is an exact inversion and goes invisible on a
  mid-grey cell (band roughly 112..143 per channel, and a spawn very often sits
  on a painted cell); and the anchor glyph *replaces* the buffer character under
  it, which is the accepted cost of "never colour alone" reaching pixels. M4
  still owns the *shipped* look when it lifts the file. Cheap to change: one
  pure function.
- **Where issues render** — one issues pane keyed by path (as specced) vs
  inline per-field messages. Wave C decides; the requirement is only that
  every issue is visible with enough path to find its field. Inline-per-field
  is strictly more wiring for the same information, so it must earn itself.
- **How much the playtest surfaces** — beats, rejection lines and outcome in
  an event log (as specced) vs a fuller in-fiction presentation. The log is
  enough for an authoring tool; anything richer is M4's presentation arriving
  early and should be resisted unless authoring genuinely needs it.

## Critical files

- `packages/vim-core/src/keys.ts` (Wave A — `render` becomes `tokenize`'s
  inverse) and the test file that pins it
- `packages/game/src/schema.ts` (Wave A — the `StageInput` export, one line)
- `apps/editor/package.json`, `index.html`, `vite.config.ts`
- `apps/editor/src/draft.ts`, `stage-cells.ts`, `keyboard.ts`, `recorder.ts`,
  `files.ts` + `fsa.d.ts`, `store.ts`, and the React panes (`main.tsx`,
  `app.tsx`, `buffer-pane.tsx`, `grid-pane.tsx`, `issues-pane.tsx`,
  `metadata-panel.tsx`, `entities-panel.tsx`, `play-pane.tsx`)
- Root `package.json` (`dev:editor`), `tsconfig.json` (include + `jsx`),
  `vitest.config.ts` (include), `.claude/launch.json` (the 5174 entry)
- `content/stages/` — the fourth fixture, authored in the editor at Wave E
