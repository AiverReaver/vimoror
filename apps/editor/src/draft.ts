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

import { formatIssues, safeParseStage, type Stage, type StageInput } from '@vimorror/game';

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
