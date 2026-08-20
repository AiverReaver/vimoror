# M4 — `apps/web` build plan

`MergedPlan.md` and `docs/CHECKLIST.md` leave M4 as an undecomposed bullet list
and say every milestone after M0 "needs its own plan before it starts." This
doc is that decomposition, the same way `docs/M1-PLAN.md`, `M2-PLAN.md` and
`M3-PLAN.md` were for theirs.

M4 delivers `apps/web` — the game shell: a title screen with **diegetic
difficulty selection from the game's own command line**, comfort settings
surfaced before first play, the skippable content note with a persistent
resources link, the **stage runner** (the CRT-dressed play surface), saves in
`localStorage` with an in-payload `schemaVersion`, procedural WebAudio, and
the Playwright E2E suite `MergedPlan.md`'s verification table has named since
day one. It also closes the one clause M3's definition of done deferred:
`content/stages/act1-word-power.json` "loads and is completable **in the
game**" now runs literally, in the app, not through the editor's playtest.

Nothing here adds a Vim command, a schema field, a difficulty dial, or a
renderer feature. The shell is a **consumer** of M0–M3, and the design rule
that shapes every file below is the same one M3 stated: **the shell invents no
rules of its own.** `GameSession` stays the single play loop (the runner feeds
it keys and renders its events — win, lose, beats, scoring and gating all
already live there), `createRenderer` stays the single way cells reach pixels,
`schema.ts` stays the single stage authority, and — the new one this milestone
adds — **the engine's own command line stays the single command line.** The
title screen does not simulate a `:` prompt; it runs a real `VimEngine` and
watches what resolves.

## Five facts verified against source, not trusted from the plan docs

Each one changes what M4 has to build. Two remove work a naive reading of the
bullets would add; one forces the repo's fourth package.

### 1. Diegetic `:set magic` needs zero core changes — and unknown ex commands resolve too

The checklist bullet says difficulty selection is "diegetic, from the game's
own command line," and the trap is that core's `:set` does **not** know the
magic options: `applyOneSetArg` (`packages/vim-core/src/excmd.ts:225`) matches
`shiftwidth`/`expandtab`/`ignorecase`/… and **silently returns the options
unchanged for anything else** — no error, no event. So a shell that waited for
an `OptionSet` event, or fed `:set verymagic` and read the engine's options
back, would wait forever.

What actually works was measured on a live engine rather than reasoned out:

- `:set verymagic<CR>` resolves cleanly — `CommandResolved` fires with
  `keys: ':set verymagic<CR>'`, the full typed text, and core treats the
  unknown arg as a no-op exactly as real Vim ignores nothing (it would error;
  ours is documented as lenient here, which is the useful half).
- **An unknown command still resolves.** `:help<CR>` emits `InvalidCommand
  (unknown-command)` *and* `CommandResolved` with `keys: ':help<CR>'` — the
  established "a failed command still resolves" rule (M3 Wave D) applying to
  ex commands.

Consequence: the title screen is a **real buffer with a real engine**. The
player moves around it with `hjkl` for free, the `:` prompt is core's own
`pending.keyBuffer` rendered in the status line, and the shell's entire
command vocabulary is one interceptor over `CommandResolved.keys`: `:set
verymagic|magic|nomagic` picks difficulty, and shell-level verbs the engine
does not know (`:play`, `:stages`, `:settings`) resolve as unknown-commands
whose keys the shell reads and acts on. No new core surface, no parallel
command-line implementation to drift. The same interceptor runs during play,
which is what lets a mid-stage `:set nomagic` be acknowledged ("takes effect
on your next stage") instead of silently ignored — a mid-stage `:set` still
costs a tick and a keystroke, because it really resolved, which is the honest
price of typing at the world.

### 2. The lift has no legal home in any existing package — M4 creates the fourth

`stage-cells.ts` and `keyboard.ts` both carry headers saying M4 lifts them,
and `docs/HANDOFF.md` repeats it. The part nobody wrote down is **where**.
Checked against the dependency rules rather than assumed: `stage-cells.ts`
imports from `@vimorror/game` (`occupies`, `Entity`) *and* `@vimorror/render`
(`linesToCells`, `CellBuffer`) — and game must not depend on render (M2: "the
rules layer must not know how anything is drawn") while render must not depend
on game (it renders cells, not stages). Neither package can hold the file, an
app-to-app source import is an undeclared dependency between two things that
are not libraries, and copying the files is two copies to drift.

So Wave A creates **`packages/stage-view`** (`@vimorror/stage-view`) — the
browser-shared, stage-aware presentation kit both apps consume, depending on
all three packages the way `apps/editor` already legally does. It holds
exactly three files, all lifted verbatim rather than rewritten:

- `stage-cells.ts` + its test (211 lines — the stage→`CellBuffer` skin, the
  entity palette, `drawable`, `MAX_FRAME_COLS`)
- `keyboard.ts` + its test (93 lines — the trust-boundary `KeyboardEvent` →
  `KeyToken` translator, `shift-Tab` escape included)
- `font.ts` — the module-scope memoised `bakeFontAtlas` currently inlined in
  the editor's `grid-pane.tsx` (`atlasOnce`), the third piece both apps need
  byte-identically and the one whose failure mode (a `FontFace` leaked per
  call, a cached rejection making one missing woff2 permanent) was hard-won
  enough at M3 Wave B that a second copy is a second place to re-learn it.

The editor's three import sites (`app.tsx:44`, `play-pane.tsx:58`,
`grid-pane.tsx:35`) move to the package; behavior changes zero. `pnpm test`
green with the moved suites and an unchanged editor is Wave A's whole
done-line. Everything else in the editor — panes, draft model, recorder —
stays put: the game needs none of it, and the rule from M3 holds, the seam
moves when the second consumer exists and not a file sooner.

### 3. The save is an envelope, and everything inside it already exists

`SessionSnapshot` (`packages/game/src/session.ts:107`) already carries every
piece of evolved play state — engine snapshot, live entity positions, the
four tallies, outcome, fired beats, difficulty and comfort — and its own
doc comment assigns the rest to this milestone verbatim: *"M4's `localStorage`
save is the consumer and owns the envelope around this — its own
`schemaVersion` included; nothing here is versioned."* Three consequences,
each read off the source:

- **M4 writes a codec, not a serializer.** `save.ts` is a Zod-validated
  envelope `{ schemaVersion, settings, progress, current? }` where `current`
  wraps a `SessionSnapshot` untouched. The session layer already solved the
  hard half (the `Set`-JSONs-to-`{}` trap, authored-vs-evolved, the mid-visual
  `pendingKeys` refund) — re-solving any of it here would be the drift M2
  Wave E's keystone exists to catch.
- **The load path must catch, because `restore()` throws.**
  `GameSession.restore(stage, snap)` refuses a `stageId` mismatch loudly
  (`session.ts:256`) — the one deliberate loud failure on that surface. A
  save written against a stage that was since renamed or removed must land as
  "fresh session, snapshot dropped," never as a crash on the loading screen.
- **Authored state is re-read on load by design**, so the shell passes the
  *current* parsed stage into `restore()` and gets stage-correction-on-reload
  for free — the editor fixing a stage re-gates old saves with no migration.

The one decision the codec owns: a stored payload whose `schemaVersion` (or
shape) doesn't match is **renamed aside** (`vimorror.orphan.v<N>`), not
deleted and not migrated — one line that keeps "start clean" from meaning
"silently destroy a player's history," with a migration framework explicitly
not built until a second schema version exists to migrate from.

### 4. The renderer facade is finished; what remains is exactly the three jobs it named for M4

Enumerated against `packages/render/src/pipeline.ts` rather than assumed:
`createRenderer(canvas, {atlas})` → `{draw, resize, dispose}` exists, picks
WebGL2-vs-fallback itself, and maps the cursor through
`camera.ts`/`cursor-shape.ts` internally — the runner passes a buffer-space
cursor and never touches screen coordinates. What it deliberately left open,
each tagged "M4" at the definition site:

- **The intensity value.** `effectsIntensity` is a required, never-defaulted
  0–1 on every `draw()` call. M4's comfort layer owns the number: the
  first-launch slider sets it, `prefers-reduced-motion: reduce` picks the
  *default* of 0 (else 0.6 — a judgment call, surfaced on a slider the player
  is looking at), and the setting persists.
- **DPR.** The checklist files device-pixel-ratio under M4 twice. The runner
  sizes the canvas at `cells × cellSize × devicePixelRatio`, calls
  `renderer.resize()`, and `GlyphGrid.invalidate()` exists for exactly the
  same-size-resize case where `diffCells` sees nothing — plus a
  `matchMedia('(resolution: …)')` listener so a window dragged between
  monitors re-renders instead of blurring.

  > **CORRECTED AT WAVE B — do not implement the paragraph above as written.**
  > It is the one fact in this document that was reasoned rather than measured,
  > and it does not work. `GlyphGrid.#drawCell` blits every cell at
  > `atlas.cellW` × `atlas.cellH` and nothing else, so sizing the canvas at
  > `cells × cellSize × dpr` against a 1× atlas draws a 1× frame into a 2×
  > buffer and leaves three quarters of the canvas blank — `resize()` cannot
  > help, because there is no scale factor anywhere in the blit for it to
  > change. **The scale has to reach the ATLAS.** `getFontAtlas(scale)`
  > (`packages/stage-view/src/font.ts`) is memoised per INTEGER scale 1–3 — a
  > fractional cell size puts every glyph blit on a fractional pixel boundary,
  > which is the blur the exercise exists to remove — the backing store is
  > `cells × atlas.cellW`, and the CSS box stays `cells × CELL_W`. Verified by
  > forcing scale 2 on a 1× display: 1152×288 behind a 576×144 box, frame
  > filling it, layout identical to 1×. The `matchMedia` listener is right and
  > is in, keyed on the raw ratio rather than the integer scale, since a query
  > pinned at `2dppx` stops firing once the ratio has moved off it.
- **The viewport clip.** `DrawArgs.cells` is documented "already clipped to
  the viewport by the caller — one row per `camera` row," and `Camera` is
  `{topline, height, width}` with `followCursor` already written. The runner
  builds the full stage frame through `stageCells` (stages are bounded by
  `MAX_FRAME_COLS` and a few dozen rows — full-frame is cheap), slices rows
  `[topline, topline+height)`, and follows vertically only. No horizontal
  camera: no shipped stage needs one, and the editor authors inside the same
  frame bound.

  > **AMENDED AT WAVE B — this bullet is missing the half that has a bug in
  > it.** Slicing rows is not the whole clip: `stageCells` indexes entities
  > against the LINES ARRAY it is handed, not against the buffer, so
  > **entities must be shifted by `topline` too** or an entity on buffer line 5
  > draws on frame row 5 instead of the row the player is looking at. Worse,
  > `stage-cells.ts`'s `drawable` filter refuses a negative `at.line` (its
  > `isIndex` requires `n >= 0`), so the naive shift makes a rectangle
  > straddling the top edge **vanish** rather than clip — an invisible wall the
  > cursor cannot pass. The anchor is therefore clamped to row 0 when the far
  > corner is still visible (which moves the glyph to the topmost visible row,
  > keeping "never colour alone" true for a wall continuing off-screen) and
  > deliberately NOT clamped for a single cell, which must vanish rather than
  > stick to the top row.
  >
  > Two other departures, both cheaper than the text above: the frame is sized
  > ONCE per stage and each visible row is **sliced as well as padded** to that
  > width, because padding alone lets a line the player has grown past the
  > frame widen `stageCells`'s own longest-line measurement and resize the
  > canvas mid-play; and only the visible rows are built, not the full stage
  > frame, which falls out of the same sizing for free.
  >
  > All of it lives in `apps/web/src/frame.ts`, pure, with `frame.test.ts`.
  > That split matters: a shipped stage CAN scroll once play has grown its
  > buffer (`act2-grammar-awakens` permits `y`/`p`; `yy` + `p`×8 reaches
  > `topline: 1` on `verymagic`), but every rectangle in all four stages is a
  > single row, so the straddle case is unreachable by hand and only a test
  > finds it.

The draw loop is `requestAnimationFrame`, not per-keystroke — glitch and
phosphor are time-varying, which is why the M1 demo already draws that way.
Cells recompute only when a session event said something changed; the pass
itself runs every frame with `timeSec`.

And the runner never implements a hint, a score, a gate or an outcome:
`session.hint()` already encodes the whole per-difficulty policy (`always`
free, `on-request` counts against the clean run, `none` returns `undefined`),
`session.score` already compares keystrokes to par, and `KeyRejected` events
already carry the in-character `line` to print. M4 owns **presentation only**
— the ceiling M3 recorded as "M4 owns hint presentation" closes by rendering
what `hint()` returns, nothing more.

### 5. Scaffolding is almost nothing, Zustand is decided (not taken), and Playwright is the one new root dependency

Verified against current files: root `tsconfig.json` and `vitest.config.ts`
already glob `apps/**` (M3 did it), `pnpm-workspace.yaml` already globs both
`apps/*` and `packages/*`, and CI picks new tests up with no edit. What
actually changes at the root:

- `package.json` — two scripts: `"dev": "vite apps/web --port 5173"` (the
  port `MergedPlan.md`'s verification table has named since day one) and
  `"test:e2e": "playwright test"`; one devDependency, `@playwright/test`.
- `playwright.config.ts` — chromium only, `testDir: 'apps/web/e2e'`,
  `webServer` pointing at `pnpm dev` so the suite is one command.
- `.claude/launch.json` — a `dev` entry at 5173, M1 Wave B's precedent.
- `.github/workflows/ci.yml` — an `e2e` job (install chromium, run the
  suite), separate from the unit job so `pnpm test` stays fast. Unlike the
  Vim-dependent scripts CI deliberately omits, Playwright is hermetic — it
  brings its own browser — so this is the first E2E that *can* run in CI.

> **CORRECTED AT WAVE E — this list is two files short.** It also takes
> `tsconfig.json` and `.gitignore`, and the claim above that "CI picks new tests
> up with no edit" is true of the specs and false of the config that runs them.
> `apps/**/*.ts` already covers `apps/web/e2e/`, but `playwright.config.ts` sits
> at the repo root and matches no glob in `tsconfig.json`'s `include`, so without
> an entry there the one genuinely new root file is never typechecked — measured,
> it had two real type errors on its first run (`reducedMotion` is not a
> top-level test option in Playwright 1.62; it goes in `contextOptions`, and
> `deviceScaleFactor` is the other way round because `devices['Desktop Chrome']`
> sets it top-level and top-level wins). `.gitignore` takes `test-results/`,
> which is where `trace: 'retain-on-failure'` writes and where the CI job's
> failure-artifact upload looks. Done-when 7 is amended to match.

**Zustand is not taken, and the decision M3 explicitly left to M4 is hereby
made.** Its justification in the technology table was "works outside React
for the game loop" — measured against what the shell actually holds, that
loop is a rAF callback reading a ref, exactly the shape the editor already
runs (`PlayView` in `useState`, session in the view, "the presence of the
view IS the mode"). The shell's remaining state is one settings object, one
screen union and one save envelope; `useState`/`useReducer` cover it with
zero dependencies, and a store would be a second source of truth for state
that already lives in `GameSession` and `localStorage`. If a real consumer
appears (M6's free-play rooms, a stats overlay), it can take the dependency
then — later can scaffold for itself.

`apps/web` therefore depends on: the three packages plus `@vimorror/stage-view`,
`react`/`react-dom` ^19 (chrome only — menus, dialogs, HUD text; **never the
game grid**, per the technology table), and `zod` (the save and campaign
codecs; same major as `@vimorror/game`'s).

## Package scaffolding

- **`packages/stage-view/package.json`** — `private`, `type: module`, name
  `@vimorror/stage-view`, `exports: { ".": "./src/index.ts" }` (source-shipped,
  mirroring render/game), deps `@vimorror/core|game|render: workspace:*`, the
  same `typecheck` script the other packages carry.
- **`apps/web/package.json`** — `private`, `type: module`, name
  `@vimorror/web`. Deps: the four workspace packages, `react`, `react-dom`,
  `zod`. Dev: `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`
  (`^5.2.0` — M3 measured that `latest` peer-requires vite 8 and fails
  confusingly against this repo's vite 6).
- **`apps/web/index.html`**, **`apps/web/vite.config.ts`** (react plugin; no
  `server.fs.allow` — M3 confirmed the workspace-root default already covers
  `packages/**` and `content/**`, which is how the font and the stage JSON
  load).
- **No `apps/web/tsconfig.json`** — the root project compiles it, same as
  every other package.
- The root edits from fact 5.

## File breakdown

Split by testability — M1's split, kept by M2 and M3: **pure modules that
vitest can hold, thin React components the browser and Playwright verify.**

### `packages/stage-view/src/` (Wave A — lifted, not written)

- `stage-cells.ts`, `keyboard.ts` — verbatim from `apps/editor/src/`, tests
  included. Header lines saying "the seam M4 lifts" are updated to say it
  happened.
- `font.ts` — `getFontAtlas(): Promise<FontAtlas>`: the memoised
  `bakeFontAtlas` from `grid-pane.tsx`, memo cleared on rejection, exactly the
  hard-won M3 Wave B semantics. The editor's `grid-pane.tsx` becomes its first
  caller; the runner its second.
- `index.ts` — flat barrel, the render/game pattern.

### `apps/web/src/`

Pure modules:

- **`campaign.ts`** — the stage catalogue. `content/campaign.json` (new, in
  `content/` because ordering is content) is an ordered list of stage ids;
  this module loads every `content/stages/*.json` through `parseStage` via
  `import.meta.glob` (raw text through the same door a file would use —
  `fixtures.ts`'s precedent), zips it with the manifest, and exposes
  `stages: readonly Stage[]` in curriculum order. A vitest suite asserts the
  bijection both ways — every manifest id resolves to a file, every stage
  file appears in the manifest — the same both-directions drift guard the
  repo already uses for `EDITS`/`FIELD_ORDER` and the comparator's registers.
- **`frame.ts`** (added at Wave B, not in the original breakdown) — the
  viewport clip: `frameGeometry`, `viewportLines`, `shiftEntities`,
  `frameCells`. Pure, so the one case a playtest cannot reach is still checked.
  See the amendment under fact 4's viewport-clip bullet for why it exists as a
  module rather than as three helpers inside `runner.tsx`.
- **`save.ts`** — fact 3's codec. `SCHEMA_VERSION = 1`; Zod schema over the
  envelope; `loadSave(): Save | undefined` (parse failure, version mismatch,
  storage unavailable → `undefined`, mismatched payloads renamed aside);
  `storeSave(save)` (quota errors swallowed to a warning — a full disk must
  not crash a keystroke). `progress` is per-stage `{completed,
  bestKeystrokes, cleanRun}`; `settings` is `{difficulty, comfort,
  effectsIntensity, audio: {muted, volume}}`; `current` is
  `{ snapshot: SessionSnapshot }` for the one resumable in-flight stage,
  cleared the moment an outcome latches.
- **`progression.ts`** — `unlockedStages(campaign, progress)`: linear —
  stage n+1 unlocks when stage n is completed at any difficulty, first stage
  always open. Three functions and a test; M6's placement skill-check
  replaces the *policy*, not the seam.
- **`shell-commands.ts`** — fact 1's interceptor: `ResolvedCommand.keys` →
  `{ kind: 'set-difficulty', d } | { kind: 'play' } | { kind: 'stages' } |
  { kind: 'settings' } | undefined`. A dozen lines and a table-driven test;
  pure so the title screen and the runner share one vocabulary.
- **`audio.ts`** — raw WebAudio, one module. An `AudioContext` created
  lazily on the **first user gesture** (autoplay policy: a context created
  earlier starts suspended and the drone silently never sounds — the classic
  trap, so `ensureAudio()` is called from the same keydown/click handlers
  that already exist). One ambient drone — two detuned oscillators through a
  slow-LFO'd lowpass into a master gain — with a per-act base-frequency
  table, plus short win/lose stingers. Volume and mute from settings; every
  entry point tolerates `AudioContext` being absent. The frequency/routing
  tables are pure and tested; the sounding half is browser-verified. No
  per-beat or threat-proximity scoring — that is content-driven and lands
  with the acts that author it.

React components (free to merge or split; the list is a decomposition, not a
contract):

- **`main.tsx`**, **`app.tsx`** — the screen union in `useState`
  (`note | title | select | settings | run`), settings state, save
  write-through. First launch (no save) lands on `note`.
- **`note-screen.tsx`** — the content note: themes listed plainly (self-doubt,
  intrusive thoughts, compulsion; explicitly *no self-harm imagery*), the
  resources link, and the comfort controls **on the same screen** — Effects
  Intensity (never labelled "epilepsy safe"), Gentle Mode (Celeste-style copy,
  no penalty), the separate jump-scare toggle — so comfort is genuinely
  "surfaced before first play" rather than findable before first play. One
  continue button makes it skippable; the note never renders again once a
  save exists, and the resources link stays reachable from settings and the
  title footer permanently.
- **`title-screen.tsx`** — a `GridPane`-style canvas over a real `VimEngine`
  on an authored title buffer (ASCII title, and lines that *teach the way
  in*: "type  :play  and press Enter"). The status line renders the live `:`
  prompt from `pending`; `shell-commands.ts` consumes what resolves. Buttons
  for the same actions exist beside it — a Vim-teaching game cannot demand
  `:`-fluency as its first gate — and both paths call the same handlers.
  Current difficulty shown in `:set magic` terms.
- **`select-screen.tsx`** — the campaign list with lock state, per-stage best
  score/clean flag, act grouping, a resume banner when `current` exists.
- **`settings-screen.tsx`** — the note screen's comfort controls plus audio
  volume/mute and effects intensity, editable any time; the resources link
  again.
- **`runner.tsx`** — the milestone's center. Owns: a canvas handed to
  `createRenderer` (never queried for a second context type — the M1/M3
  one-context rule), the rAF loop, the camera (`followCursor`, DPR sizing,
  `resize` on change), a document-level keydown → `keyTokenFor` →
  `session.feed` (preventDefault only when a token was produced, so
  `shift-Tab` and browser chords survive — the keyboard-trap rule arrives
  with `keyboard.ts` for free), and the event fold: `Tick` updates the HUD,
  `ThreatMoved` marks cells dirty, `BeatFired` renders `beat.text` as the
  dialogue overlay (comfort filtering already happened inside the session),
  `KeyRejected`/`CommandRefused` print their in-character `line` on the
  status line, `BufferSaved` acknowledges ("written" — its real meaning is
  Act VI content), `QuitRequested` leaves to select — `:q` keeps the resume
  snapshot, `:q!` discards it, which is Vim's own distinction landing as UI
  for free. `OutcomeDecided` swaps in the win/lose overlay: keystrokes vs
  par, the clean flag, retry / next-stage; wins clear `current` and update
  `progress`. A hint button renders `session.hint()` per its policy (absent
  on `nomagic`, free on `verymagic`, costing the clean flag on `magic` — all
  already decided inside `hint()`).
- **HUD/status line** — inside `runner.tsx` or split out: mode, the pending
  ghost ("you typed: d2" — `engine.pending` is public API precisely for
  this), keystrokes/par, difficulty.

### `apps/web/e2e/`

Playwright specs, each in a fresh browser context (clean `localStorage`):

1. **First run to first win** — content note appears, continue, `:play` typed
   at the title, stage select, open `act1-two-worlds`, type
   `ihello, <Esc>`, assert the win overlay and the par readout.
2. **The difficulty asymmetry** — `MergedPlan.md`'s own named test, now
   runnable against real content: on `act1-word-power`, a character-crawling
   route past 20 keystrokes **loses on `:set nomagic`** (`keystrokes-over`
   enforced) and the **identical keys win on `:set verymagic`** (budget
   dropped, threat at half cadence) — M3 Wave E measured exactly this stage
   behaving exactly this way in the editor; the E2E pins it in the shipped
   shell.
3. **Save round-trip** — play a few keys, reload the page, assert the buffer,
   keystroke count and difficulty came back (the visible projection of
   `SessionSnapshot` equality; byte-level equality is already pinned by M2's
   keystone at the unit layer), and that the content note did *not* reappear.

## Build order — five waves

1. **Wave A — the lift, and the walls of the app.** `packages/stage-view`
   (fact 2): move `stage-cells.ts`, `keyboard.ts` and their tests verbatim,
   extract `font.ts` from `grid-pane.tsx`, point the editor's three import
   sites (`app.tsx`, `play-pane.tsx`, `grid-pane.tsx`) at the package.
   `apps/web` scaffolding plus the root edits (fact 5), and a walking
   skeleton: `pnpm dev` serves a page that bakes the atlas and draws a static
   buffer through `createRenderer` at intensity 0. Done when: `pnpm
   typecheck`/`pnpm test` green repo-wide with the moved suites, the editor
   verified unchanged in the browser (open a fixture, paint, playtest — its
   own Wave B/D checks), `goldens:verify` zero changed bytes, and the
   skeleton renders at 5173.
2. **Wave B — the stage runner.** `campaign.ts` + `content/campaign.json`,
   `runner.tsx` end to end: real keyboard through `keyTokenFor`, session
   events folded into HUD/status/dialogue, camera + DPR, hints, win/lose
   overlays, retry/next, `:q`/`:q!` out. Difficulty and comfort arrive as
   props with in-memory defaults (Wave C gives them a home; Wave D makes them
   persist). Done when: **all four shipped stages are completable in the app
   with real keystrokes** — the M3 definition-of-done clause re-run literally
   — and `act1-word-power` visibly loses over budget on `nomagic` while the
   same route wins on `verymagic`, checked by hand in the browser before E2E
   pins it.

   **Both met**, by hand in the browser: all four stages completed at par
   (`act1-two-worlds` 9/9, `act1-four-directions` 2 against par 3,
   `act1-word-power` 8/8, `act2-grammar-awakens` 4/4, each `[*] clean run`) —
   the third of which closes M3's deferred clause literally — and on
   `act1-word-power` the route `jj` + `l`×43 **loses on `nomagic`** at keystroke
   21 while the **identical keys win on `verymagic`** at 45, marked `[ ]
   assisted` rather than clean because always-on hints are a hint used
   (`scoring.ts`'s rule, not the runner's). 1656 tests from 1630;
   `goldens:verify` zero changed bytes.

   **Two corrections to the plan as written**, both under fact 4 above: the DPR
   recipe does not work (the scale must reach the atlas, not the canvas) and the
   viewport-clip bullet omits the entity shift, which is where the one real bug
   of this wave lived. A third, smaller: `frame.ts` was added to the file
   breakdown so the clip is testable, and `app.tsx` is a stage list plus a
   difficulty radio — scaffolding Wave C deletes, not a screen.

   Left for later waves rather than forgotten: `effectsIntensity` stays 0 (Wave
   C owns the value and the `prefers-reduced-motion` policy); `onExit(force)`
   carries `:q` vs `:q!` — the `force` flag measured `false` and `true`
   respectively — with nothing consuming it until Wave D has a snapshot to keep
   or discard; the runner's engine-throw freeze path and the `matchMedia` DPR
   listener are both written and neither is exercised. No root edits were
   needed, Wave A having already landed the `dev` script and the launch entry.
3. **Wave C — the front door.** `shell-commands.ts`, `title-screen.tsx` over
   a real engine (fact 1), `note-screen.tsx` (content note + comfort before
   first play), `select-screen.tsx`, `settings-screen.tsx`,
   `prefers-reduced-motion` deciding the intensity default. All in-game text
   written original (the licensing invariant binds copy, not just stages).
   Done when: a fresh profile walks note → title → `:set nomagic` → `:play`
   → select → stage → win entirely without code, the note never returns on a
   second visit (in-memory for now), and every screen's colour-coded element
   carries its redundant glyph or label ("never colour alone" — the shell's
   first UI is where that invariant starts being checkable).

   **Met**, from a fresh load and with real trusted keys: note → continue →
   title → `:set nomagic` typed at the prompt → `:play` typed → select → Four
   Directions → `G$` → **won, 2 keys against par 3, 1 under, `[*] clean run`**,
   no hint button at all. `:stages`, `:settings` and an unknown `:zzz` (answered
   by `rejectionLine('unknown-command')`, not new copy) all verified the same
   way; `shift-Tab` leaves the capture surface and `<Esc>` returns to it. Fact 1
   itself was re-measured before implementation and holds exactly. 1693 tests
   from 1656; `goldens:verify` zero changed bytes; nothing changed outside
   `apps/web/`.

   **One correction to fact 1**, found by writing its copy and then measuring
   it: a mid-stage `:set nomagic` cannot "take effect on your next stage"
   without state in `app.tsx` and a fourth entry point, because the runner has
   no channel to the shell and giving it one restarts the session under the
   player. The interception stays — core's `:set` reports *nothing* for an
   option it does not know, so without it the player pays for the command and
   hears silence — but it answers with the truth: difficulty is chosen between
   stages, not inside one.

   **Two things the plan did not anticipate**, both measured: a key policy
   cannot protect the title buffer (it gates the letters typed inside a pending
   `:` line too, so denying `a`/`i`/`c` makes `:set magic` untypeable), so the
   title is left editable — it is a real buffer and `u` undoes it; and the title
   uses `GlyphGrid` rather than `createRenderer`, because `dispose()` frees
   textures and the program but not the **WebGL2 context**, and the title is the
   most-remounted screen in the app.

   Left for later waves rather than forgotten: the select screen shows no lock
   state, best score or resume banner (all four are projections of Wave D's
   `progress` and `current`); `:play` and `:stages` are two spellings of one
   door until `:play` gets its resume meaning; audio controls are absent because
   `audio.ts` does not exist yet.
4. **Wave D — persistence + audio.** `save.ts` (fact 3), `progression.ts`
   wired into select, settings write-through, mid-stage snapshot after each
   fed batch + on `visibilitychange`, resume flow through
   `GameSession.restore` with the catch-and-discard path, orphan-on-mismatch.
   `audio.ts` behind the first-gesture unlock, drone + stingers, volume/mute
   persisted. Done when: mid-stage reload resumes (buffer, tally, entity
   positions, difficulty — and a re-snapshot equals the stored snapshot),
   a corrupted/mismatched payload starts clean without crashing and without
   deleting the old data, locked stages stay locked across reloads, and the
   drone demonstrably starts only after a gesture (the suspended-context
   trap checked, not assumed).

   **All met**, each in the browser: `act1-two-worlds` left at 5/9 keys with the
   buffer `helworld`, reloaded, `:play` typed at the title, and the stage came
   back at 5/9 — with the RESTORED session's `JSON.stringify(snapshot)`
   string-identical to what was stored. A hand-poisoned `schemaVersion: 99`
   started a clean profile and left `vimorror.save.orphan.v99` holding the
   original bytes. After winning Two Worlds the select screen showed `[*] best 20
   clean` with Word Power and The Grammar Awakens still `[-] locked`, unchanged
   across a reload. `audioStatus()` read `state: 'none'` before any gesture and
   `running`, act 1, gain 0.16 after the note's continue click; muting set the
   master gain to 0 and survived a reload. `:q!` discarded the resume snapshot and
   `:q`/leave kept it, which is the `force` flag Wave B carried finally consumed.
   1728 tests from 1693; `goldens:verify` zero changed bytes; nothing changed
   outside `apps/web/`.

   **Two things this wave did not build, and one it built differently.** The
   `visibilitychange` listener is deliberately absent: the runner snapshots on
   session start and after every fed key, every change to a `GameSession` goes
   through `feed`, so there is no state a visibility change could catch that the
   last feed has not already written. `progress` carries no difficulty, because
   unlocking on `nomagic` only would make difficulty a second curriculum rather
   than a dial. And the runner now reads `session.difficulty` rather than its
   prop for the header and the hint policy — `GameSession.restore` takes
   difficulty from the snapshot by design, so a resumed run enforces the
   difficulty it was played at and the header must agree with what is enforced.

   **A correction to fact 3's testing note.** "Round-trip identity" is not a
   guard against `snapshotSchema` stripping a field it does not list — measured,
   swapping `.passthrough()` for `.strict()` survives, because today the schema
   and `SessionSnapshot` agree exactly. The test now round-trips a field the
   schema has never heard of, which is the failure the passthrough exists for.
5. **Wave E — E2E + wrap-up.** The three Playwright specs, the CI `e2e` job,
   `pnpm test:e2e` green locally and in CI, the done-list swept explicitly,
   `docs/CHECKLIST.md` boxes and `docs/HANDOFF.md` updated, and anything that
   passed on its first run mutation-tested rather than trusted (M2 Wave E's
   discipline, kept because it has caught the lone survivor every milestone
   since).

   **All met.** Six tests in the three named spec files — the plan's three flows
   plus three variants that are the same flows under one changed machine fact
   (`prefers-reduced-motion`, `deviceScaleFactor: 2`, and a resume of a
   non-first stage). `pnpm test:e2e` runs the lot in **2.8s**, three consecutive
   runs clean, `retries: 0` on purpose. The asymmetry spec pins the milestone's
   named test in the shipped shell: the same 45 keys lose on `nomagic` at
   keystroke 21 and win on `verymagic` at 45. `pnpm test` is **unchanged at
   1728** and that is the right number — Playwright specs are not vitest tests;
   `goldens:verify` zero changed bytes.

   **The discipline paid for itself again: 22 mutations, two survivors, and a
   real bug the suite found on its own.**

   - The bug: the outcome overlay's `retry`, `next stage` and `leave` did not
     blur themselves, against the rule `runner.tsx`'s own header states. The
     overlay unmounts on a *later* commit, so the clicked button holds focus
     across a whole round trip and the runner stands down for any target that is
     not the body — click `next stage`, type immediately, lose the keystroke.
     Fixed at all three, and pinned with a **single-shot** `page.evaluate`:
     `expect(body).toBeFocused()` retries until the overlay unmounts and passes
     either way, which the mutation proved by surviving it.
   - Survivor one was a tautology in this wave's own strongest assertion. "A
     re-snapshot equals the stored snapshot" passed with the runner's
     session-start `onSnapshot` deleted, because the stored bytes were simply
     still there. The spec now poisons the stored snapshot with a field the game
     cannot produce and `.passthrough()` carries through `restore`, so equality
     holds only if something really re-wrote it.
   - Survivor two was coverage in the right layer: `GameSession.feed`'s
     decided-session freeze is unreachable from the UI because the runner stands
     down first, and it is killed by three tests in `session.test.ts`.

   **Two corrections to fact 5, and therefore to done-when 7.** Its root-edit
   enumeration is one short in each direction of caution: `tsconfig.json` needs
   `playwright.config.ts` added to `include` — the specs are already covered by
   `apps/**/*.ts`, but the config sits at the root and matches no existing glob,
   and it caught two real type errors on its first run — and `.gitignore` needs
   `test-results/`, which is where `trace: 'retain-on-failure'` writes and where
   the CI job looks for artifacts. Both are necessary, both are recorded, and
   done-when 7 below is amended to name them.

   **Two ceilings this suite deliberately does not reach**, stated so green is
   not mistaken for total: **nothing reads a pixel** (the canvas is proved sized
   and the renderer proved to have picked a path, and the win conditions prove
   the ENGINE's buffer — but a frame frozen on the authored buffer would keep
   every HUD assertion correct, and a WebGL2 backing store is unreadable after
   the frame without `preserveDrawingBuffer`, so this stays the in-browser check
   it has been at every wave, `effectsIntensity` at the uniform with it); and
   **no comfort filter fires anywhere in the suite**, because
   `act1-two-worlds` authors no beats and `act1-word-power`'s two are both
   `startling: false`. The controls are proved to write; `gentle.test.ts` proves
   what writing them means. A startling beat arrives with M5.

## Testing

Same split as M1–M3: pure modules get vitest suites (`apps/**` is already in
the include glob), canvas/audio/DOM surfaces are verified in-browser through
`pnpm dev` (the launch.json entry exists for exactly this), Playwright covers
the flows a human would otherwise re-click every milestone, and first-run
passes get mutation-tested.

- **`save.ts`:** round-trip identity; version mismatch → `undefined` + the
  orphan key present; garbage JSON → `undefined`; quota throw → warning, not
  crash; `current` cleared on a decided outcome.
- **`campaign.ts` / `progression.ts`:** the manifest↔files bijection both
  ways; order preserved; unlock policy including "completed on any
  difficulty".
- **`shell-commands.ts`:** the vocabulary table, including keys that must
  return `undefined` (`:set sw=4`, a bare `:w`).
- **`audio.ts`:** the pure tables (per-act frequencies, envelope params);
  the sounding half in-browser.
- **`stage-view`:** the lifted suites, moved not rewritten — plus one new
  test pinning `font.ts`'s cleared-on-rejection memo, the semantics that
  used to live un-pinned inside a React file.
- **In-browser:** each wave's done-line above — screenshots and pixel/DOM
  checks through the preview tool, the way M1 verified the demo and M3 the
  editor (with M3's recorded trap in mind: `computer{action:"type"}` cannot
  drive the key capture, and `shift+g` synthesises wrong — send real
  per-key events, prefer bare `"G"`).
- **Playwright:** the three specs above — the flows, the difficulty
  asymmetry, and persistence, each from a fresh context.

## "M4 done when"

1. `pnpm dev` serves the game at 5173; **all four `content/stages/` files are
   selectable and completable in the app** — including
   `act1-word-power.json`, which closes M3's deferred "loads and is
   completable in the game" clause literally.
2. Difficulty is selected diegetically (`:set verymagic|magic|nomagic` at a
   real engine's command line, buttons beside it) and consumed: the
   Playwright asymmetry spec is green — an over-budget run fails on
   `nomagic` and the identical run passes on `verymagic`.
3. Comfort is surfaced before first play on the content-note screen (Effects
   Intensity reaching the shader uniform, Gentle Mode, the jump-scare
   toggle); the note is skippable, appears only on first launch, and the
   resources link is reachable permanently.
4. The save round-trips: mid-stage reload resumes through
   `GameSession.restore` and a re-snapshot equals what was stored; a
   corrupted or version-mismatched payload starts clean **without crashing
   and without destroying the stored data**; settings and progress persist.
5. Audio sounds only after a user gesture; volume and mute persist.
6. `pnpm typecheck` / `pnpm test` green repo-wide, `pnpm validate:stages`
   green, `pnpm demo` 4/4, `pnpm goldens:verify` **zero changed bytes**, and
   `pnpm test:e2e` green locally and in CI.
7. Nothing changed outside `apps/web/`, `packages/stage-view/` (the named
   lift, moves not rewrites), `apps/editor`'s **four** import lines (the plan
   counted three; `recorder.test.ts` is the fourth) + `grid-pane.tsx`'s atlas
   extraction, `content/campaign.json`, and the root edits fact 5 enumerates
   **plus the three it does not** — `tsconfig.json`'s `include` and
   `.gitignore`'s `test-results/`, both added at Wave E and both explained in the
   correction note under fact 5, and `.gitignore`'s `graphify-out/`, added when
   the waves were committed and the only one of the three that is not M4 work at
   all (a local tool's output, loose at the repo root; see `docs/HANDOFF.md`).
   `vim-core`, `render` and `game` sources are untouched.

**Explicitly NOT in M4:** `H`/`M`/`L` — the camera now exists in front of the
engine, but nothing *teaches* them until M6 authors a stage that does, the
semantics are already measured and waiting in `docs/HANDOFF.md`, and they are
ungoldenable (pty-transcript route), so they land with their first consumer;
undo budgets (wants a schema field and a core limit, per the M2 ledger — a
content-facing feature for the milestone that authors stages using it);
director-driven horror (phantom cursors, look-away reverts — the schema has
no trigger to author them with; they arrive with the acts that write them,
M5/M6, and the director API sits ready); real-time stage opt-in; wall/pickup
mechanics (still deliberately inert); the fuzz-triage campaign and the rest
of the carried `vim-core` ledger; `docs/curriculum.md`/`story-bible.md`/
`stage-schema.md` (still tracked, still unwritten, still not gated on a
milestone); any new schema field beyond nothing (the campaign manifest is
content, not schema); placement skill-check and free-play rooms (M6);
Zustand (decided against, fact 5); save migrations (one version exists);
mobile/touch input; and any Act-specific story copy beyond the title screen
and content note — stages speak through their authored beats, which is
M5/M6's work.

## Open judgment calls

- **The title buffer's copy and verb set.** `:play`/`:stages`/`:settings` are
  the proposed vocabulary; whether the title also lets Enter-on-a-line
  navigate is cosmetic. Cheap to change — one interceptor table and one
  authored buffer.
- **`:hint` as a diegetic command.** Tempting (it's free via fact 1), but a
  resolved command ticks the world — a hint that moves the threats charges a
  second, unstated price on top of the clean-run flag. Recommendation:
  button-only at M4; revisit if playtesting says the button breaks the
  fiction.
- **The resources link target.** One canonical, international,
  non-diagnostic destination (findahelpline.com is the working candidate),
  kept in exactly one exported constant so changing it is one line. Decided
  at Wave C when the note's copy is written.
- **Effects-intensity default of 0.6** for non-reduced-motion profiles —
  picked by eye at Wave C on the real CRT pass, on the slider screen where
  the player is already looking at it. The reduced-motion default of 0 is
  not a judgment call.
- **CI runtime for the e2e job.** Chromium-only keeps it near a minute; if
  it grows past that, demote to PR-only. Start included — a shell with no
  automated gate is the thing M0–M3 never allowed anywhere else.

## Critical files

- `packages/stage-view/` — `package.json`, `src/{stage-cells,keyboard,font,index}.ts`
  + the two moved test files and `font.test.ts` (Wave A)
- `apps/editor/src/{app,play-pane,grid-pane}.tsx` — imports repointed at the
  package; `grid-pane.tsx` loses its inline atlas memo (Wave A)
- `apps/web/package.json`, `index.html`, `vite.config.ts`
- `apps/web/src/{campaign,save,progression,shell-commands,audio}.ts` and
  their tests
- `apps/web/src/{main,app,note-screen,title-screen,select-screen,settings-screen,runner}.tsx`
- `apps/web/e2e/*.spec.ts`, root `playwright.config.ts`
- `content/campaign.json` — the ordered stage manifest
- Root `package.json` (`dev`, `test:e2e`, `@playwright/test`),
  `.claude/launch.json` (the 5173 entry), `.github/workflows/ci.yml` (the
  `e2e` job)
