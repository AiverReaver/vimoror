/**
 * The document model — what the editor holds while you author, and the two
 * conversions at its edges.
 *
 * The model is `StageInput`, the schema's **INPUT** type, and that one choice is
 * why this file exists instead of the editor simply carrying a `Stage`. A
 * `Stage` has every `.default()` already resolved, so an editor built on it
 * would bake all seven `options`, `cursor`, and four empty arrays into every
 * exported stage — freezing core's *current* defaults into content that never
 * asked for them — and it could not represent `allowedKeys` at all, since the
 * parse has collapsed "omitted" (ungated) into the same `undefined` as
 * everything else while `[]` is rejected outright. `schema.ts` exports the input
 * type for exactly this; see its `StageInput` comment.
 *
 * The editor invents no validation rules. `parseDraft` is a wrapper over
 * `safeParseStage` + `formatIssues` and nothing more — every message an author
 * reads comes from `schema.ts`, which stays the single authority. Re-parsing on
 * every keystroke is affordable because a stage is about a kilobyte of JSON, so
 * there is no cache here to go stale.
 */

import type { Pos } from '@vimorror/core';
import { formatIssues, safeParseStage, type EntityKind, type Stage, type StageInput } from '@vimorror/game';

/** The authored shape, defaults unmaterialized. */
export type StageDraft = StageInput;

/**
 * A draft's parse: either the resolved `Stage` (which the grid and, at Wave D,
 * play both want) or the schema's own report, one `path: message` per line.
 * Discriminated rather than two optional fields, so a caller cannot read
 * `stage` without having checked.
 */
export type DraftParse =
  | { readonly ok: true; readonly stage: Stage }
  | { readonly ok: false; readonly issues: string };

export function parseDraft(draft: StageDraft): DraftParse {
  const result = safeParseStage(draft);
  return result.success ? { ok: true, stage: result.data } : { ok: false, issues: formatIssues(result.error) };
}

/**
 * The goal sits on the LAST CHARACTER, not at `line.length`. Both are inside
 * the buffer as far as the schema's `inBuffer` is concerned — the end-of-line
 * position is real — but a normal-mode cursor can never rest there, so a
 * `cursor-on` win naming a goal drawn at `line.length` could never fire, and
 * nothing in the schema would say so.
 */
const BLANK_LINE = 'the buffer starts here';

/**
 * A minimal *valid* template, so every panel opens onto a working state instead
 * of a wall of errors.
 *
 * Only the seven required fields plus the one goal entity are written: no
 * `cursor`, no `options`, no `allowedKeys`. That is the defaults-unmaterialized
 * property being practised rather than merely permitted — a blank stage exports
 * as fourteen lines of JSON, and the `allowedKeys` it never wrote leaves it
 * ungated.
 *
 * `solution`/`par` are placeholders the recorder replaces at Wave D, and they
 * are deliberately a route that does NOT win: `l` moves one column and the goal
 * is at the far end of the line. An exported stage whose solution was never
 * recorded therefore fails `validate:stages` loudly ("never won — the stage is
 * still playing when the solution runs out"), which is the pipeline working. A
 * placeholder that happened to win would ship a stage nobody had playtested.
 */
export function blankStage(): StageDraft {
  return {
    id: 'new-stage',
    act: 1,
    title: 'Untitled',
    buffer: [BLANK_LINE],
    entities: [
      { id: 'exit', kind: 'goal', at: { line: 0, col: BLANK_LINE.length - 1 }, glyph: 'X', label: 'the exit' },
    ],
    par: 1,
    solution: 'l',
    win: [{ kind: 'cursor-on', entity: 'exit' }],
  };
}

/**
 * Schema declaration order, so an exported stage diffs against
 * `content/stages/` the way the hand-authored fixtures already read.
 */
const FIELD_ORDER = [
  'id',
  'act',
  'title',
  'buffer',
  'cursor',
  'entities',
  'allowedKeys',
  'teachesKeys',
  'par',
  'solution',
  'win',
  'lose',
  'beats',
  'options',
] as const;

/**
 * The drift guard: add a field to `stageShape` and this line stops compiling
 * until `FIELD_ORDER` names it. Without it a new field would be dropped from
 * every export silently, the draft still holding the value the saved file lost.
 * Same intent as `schema.ts`'s `satisfies Record<keyof EditorOptions, ...>`,
 * which `satisfies` cannot express for an ordered list. Verified to fail on
 * purpose, not merely to pass.
 */
const _everyFieldIsOrdered: Exclude<keyof StageDraft, (typeof FIELD_ORDER)[number]> extends never ? true : never =
  true;

/**
 * Serialization. Fields in schema order, and **absent stays absent** — the one
 * rule that makes the whole input-type decision pay off, since `undefined` is
 * how the draft spells "the author never wrote this".
 *
 * `JSON.stringify` drops `undefined`-valued keys on its own, so the guard below
 * is a statement of that contract rather than the thing achieving it — measured,
 * removing it changes no output today. It stays because the contract is the
 * point: the moment this returns the object instead of the text, the guard is the
 * only thing standing between an author's omitted `allowedKeys` and an explicit
 * `allowedKeys: undefined` that no longer means ungated.
 */
export function exportStage(draft: StageDraft): string {
  const ordered: Record<string, unknown> = {};
  for (const field of FIELD_ORDER) {
    const value = draft[field];
    if (value !== undefined) ordered[field] = value;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * The same bytes, or the reason there are none — for a caller that renders
 * instead of catching.
 *
 * `exportStage` is safe to throw from `save()`, which wraps it in a `try` and
 * turns the message into a notice. It is NOT safe to throw from a RENDER, and
 * Wave E put it in one: a pane that throws unmounts the React tree and takes the
 * issues pane down with it, which is the blank-page failure `drawableEntities`
 * and `listOf` already exist to prevent one and two doors further in.
 *
 * Reachable, not hypothetical, and measured before this existed: **`JSON.parse`
 * is iterative in V8 while `JSON.stringify` recurses per level**, so the editor's
 * untrusted-input door admits structures the serializer cannot walk.
 * `{"buffer":["x"],"beats":[[[…10,000 deep…]]]}` passes `readDraft` (which checks
 * only `buffer`), passes `stageFileName`, and gets a perfectly ordinary issue list
 * out of `safeParseStage` — and then `exportStage` throws `RangeError: Maximum
 * call stack size exceeded`.
 *
 * **The size bound is the other half of the same door, and catching alone does not
 * cover it.** Below the throwing band the same shape SUCCEEDS and returns
 * something no textarea should hold: measured, a 1,425-byte file exports at
 * 983KB, a 2KB file at 2MB, and an 8KB file at 32MB — and a 32MB string measured
 * in the browser costs about a second of synchronous main-thread work per
 * assignment, which happens on every keystroke. The tab stops responding, so the
 * issues pane survives the React tree and is unreachable anyway, which is the
 * failure this function exists to prevent wearing a different coat. `MAX_FRAME_COLS`
 * in `stage-cells.ts` is the same ceiling in the same spirit, with the same
 * justification for the number: a stage is about a KILOBYTE (`app.tsx` and this
 * file's own header both say so), so a megabyte is a thousandfold past anything a
 * human authors and cannot cut off real content.
 *
 * The bound lives here rather than in the pane because this function exists only
 * for the render caller. `save()` keeps calling `exportStage` directly: an author
 * who picked a save target asked for the bytes, whatever they weigh, and a file
 * on disk costs no frames.
 *
 * Named for `schema.ts`'s `safeParseStage`, whose shape and job this mirrors.
 */
export type DraftExport =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

const MAX_SHOWN_BYTES = 1_000_000;

export function safeExportStage(draft: StageDraft): DraftExport {
  let text: string;
  try {
    text = exportStage(draft);
  } catch (e) {
    return { ok: false, error: `this draft cannot be written out: ${(e as Error).message}` };
  }
  return text.length > MAX_SHOWN_BYTES
    ? { ok: false, error: `this draft is too large to show: ${text.length} bytes` }
    : { ok: true, text };
}

/**
 * `validate-stages.ts`'s own rule — "a stage file is named after the stage it
 * holds" — applied before the file exists, so the editor cannot offer a name that
 * would fail the gate.
 *
 * The fallback is load-bearing rather than paranoid: `id` is required in
 * `StageInput` at the TYPE level and absent at RUNTIME for anything `readDraft`
 * admits. Measured before it existed, a file opened as `{"buffer": ["hi"]}`
 * offered — and wrote — literally `undefined.json`, and a non-string id gave
 * `[object Object].json`. Both are exactly the names the rule exists to prevent,
 * so the derivation has to hold for a draft that does not parse yet.
 */
export function stageFileName(draft: StageDraft): string {
  const id: unknown = draft.id;
  return `${typeof id === 'string' && id.length > 0 ? id : 'untitled-stage'}.json`;
}

/**
 * `exportStage`'s inverse, and the editor's one untrusted-input boundary: a
 * stage file is arbitrary text off disk.
 *
 * It checks the `buffer` and asserts the whole draft type, which is a narrower
 * claim than it looks. Every other field is re-validated by `safeParseStage` on
 * the very next render and the author reads the result in the issues pane;
 * `buffer` is singled out because it is the one field the panes cannot *render*
 * without, and a pane that throws shows no issues at all. `entities` is a
 * structural risk too, and is filtered by `stage-cells.ts`'s own `drawable`
 * check at the point of drawing rather than rejected here, because an entity the
 * renderer skips is still an entity the schema can helpfully complain about.
 *
 * A draft edited in the editor can never reach a bad shape — the panes only
 * produce well-shaped values — so this door is the only way structural junk
 * gets in, which is why the check lives here and not in the reducer.
 *
 * **The newline clause is a data-loss guard, not a duplicate of `lineSchema`.**
 * A textarea normalises its own value's line breaks to `\n`, so a file holding
 * `["a\rb"]` loads, reports the schema's error correctly — and then the author's
 * very first keystroke splits that one line into two behind their back, moving
 * every `cursor` and `entities[].at.line` below it onto different content. That
 * is exactly the renumbering `lineSchema` refuses to do for the author, so a
 * file the editor cannot hold without silently rewriting is refused at the door
 * instead.
 */
export function readDraft(text: string): StageDraft {
  const raw: unknown = JSON.parse(text);
  if (!hasBufferLines(raw)) {
    throw new Error('not a stage file: expected a JSON object whose "buffer" is an array of strings');
  }
  if (raw.buffer.some((line) => /[\n\r]/.test(line))) {
    throw new Error(
      'this stage has a line break inside a buffer line — use another array entry, since the editor cannot show it without renumbering the lines below it',
    );
  }
  return raw;
}

function hasBufferLines(raw: unknown): raw is StageDraft & { buffer: string[] } {
  const buffer = (raw as { buffer?: unknown } | null | undefined)?.buffer;
  return Array.isArray(buffer) && buffer.every((line) => typeof line === 'string');
}

// ---------------------------------------------------------------------------
// Wave C — the shapes the panels edit, derived rather than restated
// ---------------------------------------------------------------------------

/**
 * Every collection the panels edit, named off `StageDraft` instead of off
 * `Stage`. The distinction is not cosmetic: `Stage`'s `entities` is
 * `Entity[]` while the draft's is `Entity[] | undefined`, and a panel typed on
 * the output shape would quietly promise the author wrote a field they did not.
 * `NonNullable` unwraps the default's absence exactly once, here.
 */
export type DraftEntity = NonNullable<StageDraft['entities']>[number];
export type DraftCondition = StageDraft['win'][number];
export type DraftBeat = NonNullable<StageDraft['beats']>[number];
export type DraftOptions = NonNullable<StageDraft['options']>;
export type ConditionKind = DraftCondition['kind'];

/**
 * The condition vocabulary, for the kind picker.
 *
 * Hand-listed because `conditionSchema` is a `discriminatedUnion` and exports no
 * runtime list of its members, and M3 may not add one (its done-list holds
 * `schema.ts` to the single `StageInput` line Wave A added). The guard below is
 * what makes the copy safe: add a fifth condition kind to the union and this
 * file stops compiling until the picker offers it, which is the same trick
 * `FIELD_ORDER` uses above and the same drift `schema.ts`'s own
 * `satisfies Record<keyof EditorOptions, ...>` prevents.
 */
export const CONDITION_KINDS = [
  'cursor-on',
  'buffer-equals',
  'keystrokes-over',
  'threat-reaches-cursor',
] as const;

const _everyConditionKindIsOffered: Exclude<ConditionKind, (typeof CONDITION_KINDS)[number]> extends never
  ? true
  : never = true;

/**
 * A list field off a hand-edited FILE need not be a list at all.
 *
 * `readDraft` admits `{"win": 3}` on purpose — the schema is the authority and
 * says `win: Expected array, received number` on the very next render — so every
 * panel that maps over one of these must survive it. Same door, one room further
 * in, as `stage-cells.ts`'s `drawable`: a `.map` on a number throws out of
 * render, React unmounts the tree, and the issues pane about to explain the
 * problem goes with it.
 *
 * It substitutes and never FILTERS. The panels write back by index
 * (`replaceAt(win, i, …)`), so dropping a malformed member would renumber the
 * survivors and send an edit to the wrong one.
 */
export function listOf<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

export function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((existing, i) => (i === index ? item : existing));
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/**
 * Set one top-level field, where `undefined` means **remove it** rather than
 * store an explicit `undefined`.
 *
 * That is the whole input-type decision applied to editing: `exportStage` drops
 * an `undefined`-valued key either way, so the two spellings ship identical JSON
 * — but they are not identical in the draft, and `allowedKeys` is the field that
 * proves it. An author who un-gates a stage must leave the draft with no
 * `allowedKeys` at all, because `[]` is rejected and a present-but-undefined
 * value is what a later `Object.hasOwn`-style check would read as "gated".
 * Clearing a REQUIRED field takes the same route on purpose: the field goes
 * absent and the schema says `par: Required`, which is a true statement about
 * what the author has written.
 */
export function withField(draft: StageDraft, field: keyof StageDraft, value: unknown): StageDraft {
  const next: Record<string, unknown> = { ...draft };
  if (value === undefined) delete next[field];
  else next[field] = value;
  return next as StageDraft;
}

/**
 * The same rule one level down, plus the part that keeps `options` honest: an
 * options object with nothing overridden comes back `undefined`, so the field
 * itself goes absent.
 *
 * Without that, clearing the last override would leave `"options": {}` in the
 * export — which parses to the same seven values today and freezes NOTHING, but
 * it is a field the author is not writing, and the import→export identity test is
 * the thing that would catch it drifting.
 */
export function withOption(
  options: DraftOptions | undefined,
  key: keyof DraftOptions,
  value: number | boolean | undefined,
): DraftOptions | undefined {
  const next: Record<string, unknown> = { ...options };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length === 0 ? undefined : (next as DraftOptions);
}

/**
 * An empty key-spec textarea means the field is ABSENT.
 *
 * For `allowedKeys` that is the difference between an ungated stage and one the
 * schema rejects outright: `[]` "permits no keys at all" and is an error, while
 * omission is how core spells `KeyPolicy.allowed === undefined`. So the editor
 * cannot emit `[]` at all — the one value of this field that is never right — and
 * the rule lives here rather than in the panel because it is a fact about the
 * document, testable without a DOM.
 *
 * A single empty line is what an empty `<textarea>` splits to (`''.split('\n')`
 * is `['']`), so this is that one shape and no other: two blank lines really are
 * two empty specs, and the schema says so.
 */
export function specsOrAbsent(lines: readonly string[]): string[] | undefined {
  return lines.length === 1 && lines[0] === '' ? undefined : [...lines];
}

/**
 * A free id derived from a prefix — `wall`, then `wall-2`, `wall-3`.
 *
 * Shared by entities and beats because `stageSchema` rejects a duplicate in
 * either ("a condition naming it would be ambiguous"), and an editor that hands
 * out `wall` twice makes the author fix a problem the editor caused.
 */
export function nextId(prefix: string, taken: readonly string[]): string {
  if (!taken.includes(prefix)) return prefix;
  for (let n = 2; ; n += 1) {
    const candidate = `${prefix}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * Two grid cells to an entity's corners.
 *
 * `at` is the minimum on EACH AXIS independently and `to` the maximum, which is
 * what `schema.ts` demands ("must be at or after `at` on both axes — a
 * rectangle's far corner, not an arbitrary second point") and what `occupies`
 * means by a `<C-v>`-shaped block. Dragging up-and-left is the ordinary way to
 * paint a rectangle, so normalising here is what stops the editor from emitting
 * the one shape the schema rejects.
 *
 * A single cell yields **no `to` at all**, not a degenerate `to === at`. Both
 * occupy the same one cell, so this is a statement about the exported JSON: a
 * one-cell goal reads as `at` alone, the way every hand-authored fixture writes
 * it.
 */
export function rectFrom(a: Pos, b: Pos): { readonly at: Pos; readonly to?: Pos } {
  const at = { line: Math.min(a.line, b.line), col: Math.min(a.col, b.col) };
  const to = { line: Math.max(a.line, b.line), col: Math.max(a.col, b.col) };
  return at.line === to.line && at.col === to.col ? { at } : { at, to };
}

/**
 * The glyph a freshly painted entity starts with — the "never colour alone"
 * invariant pre-satisfied, since `glyph` is required and an author dropped into a
 * form with an empty one reads a schema error they did nothing to earn.
 *
 * These are authoring defaults, so they live here rather than beside
 * `ENTITY_SKIN`: that table is the SKIN (what the preview paints), this is
 * content (what gets written to the file and can be changed per entity).
 */
export const DEFAULT_GLYPH: Record<EntityKind, string> = {
  goal: 'X',
  wall: '#',
  threat: '?',
  pickup: '*',
};

export function blankEntity(
  kind: EntityKind,
  rect: { readonly at: Pos; readonly to?: Pos },
  taken: readonly string[],
): DraftEntity {
  return { id: nextId(kind, taken), kind, ...rect, glyph: DEFAULT_GLYPH[kind] };
}

/**
 * A condition of the picked kind, valid on arrival wherever that is possible.
 *
 * `entity` is passed in rather than defaulted to `''` because a `cursor-on` with
 * no entity can never fire and the schema says so twice (`min(1)` on the string,
 * then `no entity with id ""`). The caller hands over the selected entity, or the
 * first one drawn — so adding a win condition to a stage that already has a goal
 * is one click and zero errors.
 */
export function blankCondition(kind: ConditionKind, entity = ''): DraftCondition {
  switch (kind) {
    case 'cursor-on':
      return { kind, entity };
    case 'buffer-equals':
      return { kind, lines: [''] };
    case 'keystrokes-over':
      // The schema's floor is `positive()`, so 1 is the smallest legal budget.
      return { kind, max: 1 };
    case 'threat-reaches-cursor':
      return { kind };
  }
}

/**
 * `startling` is written explicitly rather than left out, because the schema
 * REQUIRES it and says why: a default of `false` would let an author ship a
 * startle beat to a player who asked for none. The editor is not the place to
 * re-introduce the default the schema refused.
 */
export function blankBeat(taken: readonly string[], entity?: string): DraftBeat {
  return {
    id: nextId('beat', taken),
    text: 'something moves in the buffer',
    startling: false,
    on: blankCondition('cursor-on', entity),
  };
}
