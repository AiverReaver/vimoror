/**
 * The stage schema — `@vimorror/game`'s contract with everything downstream.
 *
 * Stages are data, and stage JSON is UNTRUSTED input: authored by hand today,
 * by M3's editor tomorrow, and loaded at runtime either way. That is the whole
 * reason Zod is this package's one runtime dependency (`vim-core` stays at
 * zero). Wave B's done-line is not "a stage parses" but "a human gets a precise
 * error for every way of getting it wrong", so nearly every rule below exists
 * because it catches something that would otherwise fail silently and late.
 *
 * Wave A's lesson, carried forward verbatim: **on this surface, wrong looks
 * exactly like right.** A stage whose spawn sits past the end of its line still
 * loads — `VimEngine` clamps it — and the player just starts somewhere the
 * author did not mean. A stage whose `allowedKeys` says `{printabl}` still
 * parses as eleven ordinary keys. Neither throws. Both are caught here.
 *
 * Three conventions, all load-bearing:
 *
 * - **Positions are core's `Pos`: 0-based line, 0-based CHARACTER column.** Not
 *   Vim's 1-based byte columns, and not the golden harness's 1-based YAML. The
 *   game layer never converts, so content must already be in the engine's own
 *   coordinates.
 * - **Every object is `.strict()`.** An unrecognised field is an error, not
 *   ignored — a typo'd key silently dropping a whole beat is precisely the
 *   failure this file exists to prevent.
 * - **The parsed type is the OUTPUT type**, so every `.default()` is resolved by
 *   the time a consumer sees it. Authors write less; `rules.ts`/`tick.ts` read
 *   fewer `undefined`s. The one deliberate exception is `allowedKeys` — see it.
 */

import { z } from 'zod';
import { DEFAULT_OPTIONS, tokenize, type EditorOptions, type KeyToken, type Pos } from '@vimorror/core';
// `entities.ts` imports only TYPES back from this file, and `verbatimModuleSyntax`
// erases those entirely — so this is a one-way runtime dependency, not a cycle.
import { entityById, occupies } from './entities.ts';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** 0-based line and 0-based character column, exactly as `vim-core` means them. */
const posSchema = z
  .object({
    line: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
  })
  .strict();

/**
 * A buffer line. A line containing a newline is the classic authoring trap: it
 * renders as two lines in a text editor's preview and reaches `vim-core` as ONE
 * line holding a literal `\n`, which every motion, every operator and every
 * golden-verified rule then disagrees with. Rejected outright rather than split
 * for the author, since splitting would quietly change their line numbering.
 */
const lineSchema = z
  .string()
  .refine((s) => !/[\n\r]/.test(s), 'a buffer line may not contain a newline — use another array entry');

/**
 * A key SPEC: authoring notation that expands to one or more canonical
 * `KeyToken`s. `"hjkl"` is four keys, `"gg"` is one key twice, `"<Esc>"` is one.
 * This works because `KeyPolicy` is checked per KEYSTROKE (`state.ts`'s
 * `isPolicyAllowed`), so a stage lists the keystrokes it permits, not the
 * commands — and writing them as notation means `"0123456789"` covers counts in
 * one entry with no special syntax.
 *
 * `{printable}` is the one macro, and it earns its place: an insert-mode stage
 * genuinely needs all 95 printable characters permitted, and the policy check
 * sees every typed character individually.
 */
const PRINTABLE: readonly KeyToken[] = Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i));

const KEY_MACROS: Readonly<Record<string, readonly KeyToken[]>> = {
  '{printable}': PRINTABLE,
};

const MACRO_NAMES = Object.keys(KEY_MACROS).join(', ');

/**
 * Keys a `KeyPolicy` must never lock, whatever `allowedKeys` says: `<Esc>` is
 * the universal cancel, and a stage that permits an insert-entering key (or
 * `:`, `/`, `q`) without it soft-locks the player in a state the tick cannot
 * see — no rest, no resolve, unwinnable AND unlosable. `gating.ts` adds these
 * to every policy it builds; the playability checks below count them as
 * allowed for the same reason, so the two surfaces cannot disagree.
 */
export const ALWAYS_ALLOWED: readonly KeyToken[] = ['<Esc>'];

const keySpecSchema = z
  .string()
  .min(1, 'a key spec may not be empty')
  .superRefine((spec, ctx) => {
    // A misspelled macro is the silent one: `tokenize('{printabl}')` throws
    // nothing and yields ten ordinary keys plus two braces, so the stage gates
    // on `{`, `p`, `r`, ... and the author never finds out. Anything shaped
    // like a macro must BE one.
    if (/^\{.*\}$/.test(spec)) {
      if (!Object.hasOwn(KEY_MACROS, spec)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown key macro ${spec} — known macros: ${MACRO_NAMES}` });
      }
      return;
    }
    try {
      tokenize(spec);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not valid key notation: ${(e as Error).message}` });
    }
  });

/** Expand key specs to the canonical tokens a `KeyPolicy` is actually checked against. */
export function expandKeySpecs(specs: readonly string[]): Set<KeyToken> {
  const out = new Set<KeyToken>();
  for (const spec of specs) {
    // `Object.hasOwn`, not a bare index: a spec named after an
    // `Object.prototype` member ('toString', 'valueOf', ...) must fall through
    // to `tokenize` as ordinary notation, not pick up an inherited function
    // and crash the `for..of` — a crash the schema's own error path swallows,
    // so it would surface only at stage load.
    const macro = Object.hasOwn(KEY_MACROS, spec) ? KEY_MACROS[spec] : undefined;
    for (const token of macro ?? tokenize(spec)) out.add(token);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entities — the overlay above the text layer
// ---------------------------------------------------------------------------

export const ENTITY_KINDS = ['goal', 'wall', 'threat', 'pickup'] as const;

const entitySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(ENTITY_KINDS),
    /** Top-left cell. With no `to`, the entity occupies exactly this one cell. */
    at: posSchema,
    /**
     * Inclusive far corner of a RECTANGLE — `<C-v>`-shaped, not a charwise span
     * that flows around line ends. One wall entity therefore covers a whole run
     * of cells instead of needing one entity per cell, which is what makes a
     * hand-authored stage readable and what M3's overlay-painting palette will
     * emit.
     */
    to: posSchema.optional(),
    /**
     * The invariant is "never colour alone": every colour-coded element carries
     * a redundant glyph or label. Required rather than defaulted per kind, so
     * the author states it and the invariant stays visible in the content.
     */
    glyph: z.string().length(1, 'a glyph is exactly one character — it occupies one grid cell'),
    label: z.string().min(1).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Conditions — ONE vocabulary, three consumers
// ---------------------------------------------------------------------------

/**
 * Win, lose and a story beat's trigger all speak the same language. The plan
 * lists "triggers" and "story beats" as separate overlay items; they collapse
 * here because a trigger with no beat attached has nothing to do, and a beat
 * needs exactly one condition to fire on. One union, evaluated by `rules.ts`.
 *
 * Positional conditions name an ENTITY rather than carrying coordinates, which
 * kills a whole bug class: a goal the player must reach has to be drawn
 * somewhere, and a second copy of its coordinates is a second thing to drift.
 */
const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cursor-on'), entity: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('buffer-equals'), lines: z.array(lineSchema) }).strict(),
  /** The keystroke budget. Hard-fails only on `nomagic`; Wave D owns that dial. */
  z.object({ kind: z.literal('keystrokes-over'), max: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('threat-reaches-cursor') }).strict(),
]);

// ---------------------------------------------------------------------------
// Story beats
// ---------------------------------------------------------------------------

const beatSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    /**
     * Gentle Mode is a constraint on the DATA, not a switch buried in a
     * renderer: a beat declares itself startling and `gentle.ts` filters on it.
     *
     * REQUIRED, deliberately. A default of `false` is the dangerous direction —
     * an author who forgets the flag ships a startle beat that fires for a
     * player who asked for none, and comfort settings are not somewhere a
     * silent default belongs.
     */
    startling: z.boolean(),
    on: conditionSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Per-stage `:set` overrides
// ---------------------------------------------------------------------------

/**
 * `satisfies Record<keyof EditorOptions, ...>` is a compile-time drift guard:
 * add an option to `vim-core` and this file stops compiling until it is
 * represented, rather than silently becoming un-authorable.
 *
 * This is NOT difficulty. Difficulty is modifier config the game layer applies
 * around the engine and never a fork inside it; these are the same `:set`
 * options a player could type themselves.
 *
 * **And there is no per-stage difficulty override, by decision.** `M2-PLAN.md`'s
 * own `schema.ts` bullet listed one and M3's metadata panel named it again;
 * Wave E resolved the drift by recording that difficulty is a SESSION-level
 * setting only, for three reasons that all point the same way:
 *
 * - It is the player's choice about challenge, next to comfort's choice about
 *   tolerance. A stage that forces `nomagic` takes back a setting the player
 *   made for themselves, which is the one thing "no penalty, no judgmental
 *   copy" cannot survive.
 * - Nothing would consume it. All four of `difficulty.ts`'s dials are
 *   session-level, so an override would have to COMPOSE with the player's — and
 *   composing means ruling on whether stage or player wins, with no consumer to
 *   justify either answer.
 * - What an author actually wants — *this stage is harder* — is already
 *   authorable, in `par`, a `keystrokes-over` budget, threat placement and
 *   `allowedKeys`. Those are content, and they are what content should say it in.
 *
 * Every option carries core's own default, so an author overrides only what the
 * stage needs while a consumer receives a COMPLETE `EditorOptions` it can hand
 * straight to `new VimEngine(...)`. A `.partial()` here would have typed as
 * `number | undefined` and failed to spread onto `DEFAULT_OPTIONS` at all under
 * `exactOptionalPropertyTypes` — the seam is checked by a test that really does
 * build an engine from a parsed stage.
 */
const optionShapes = {
  shiftwidth: z.number().int().nonnegative().default(DEFAULT_OPTIONS.shiftwidth),
  tabstop: z.number().int().positive().default(DEFAULT_OPTIONS.tabstop),
  expandtab: z.boolean().default(DEFAULT_OPTIONS.expandtab),
  autoindent: z.boolean().default(DEFAULT_OPTIONS.autoindent),
  ignorecase: z.boolean().default(DEFAULT_OPTIONS.ignorecase),
  smartcase: z.boolean().default(DEFAULT_OPTIONS.smartcase),
  wrapscan: z.boolean().default(DEFAULT_OPTIONS.wrapscan),
} satisfies Record<keyof EditorOptions, z.ZodTypeAny>;

const optionsSchema = z.object(optionShapes).strict();

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

const stageShape = z
  .object({
    /** Unique across `content/stages/`; `validate-stages.ts` enforces that half. */
    id: z.string().min(1),
    /** Acts I–VI of the curriculum. */
    act: z.number().int().min(1).max(6),
    title: z.string().min(1),

    /** The starting buffer, as `vim-core`'s `Lines`. Never zero lines — Vim's floor is one empty line. */
    buffer: z.array(lineSchema).min(1, 'a buffer has at least one line (an empty buffer is [""])'),
    /** Spawn. Named `cursor` because that is what it becomes. */
    cursor: posSchema.default({ line: 0, col: 0 }),

    entities: z.array(entitySchema).default([]),

    /**
     * The keys this stage permits, as specs. **Omitted means ungated**, exactly
     * as `KeyPolicy.allowed === undefined` does in core — an explicitly empty
     * array would mean "no key is permitted", which is an unplayable stage, so
     * it is rejected below rather than silently treated as "no gating". This is
     * the one field left un-defaulted, because the two readings of `[]` differ
     * and a default would pick one silently.
     */
    allowedKeys: z.array(keySpecSchema).optional(),
    /** Pedagogy metadata: what this stage is FOR. Must be a subset of `allowedKeys`. */
    teachesKeys: z.array(keySpecSchema).default([]),

    /** Target keystroke count. `scoring.ts` reports "you did that in 7, par is 3". */
    par: z.number().int().positive(),
    /**
     * The golden solution as key notation, the same currency `feedKeys` takes.
     * Hand-written at M2; M3's recorder produces it from real play, which is
     * what makes one action yield par, the hint data and a regression test.
     */
    solution: z.string().min(1),

    /** ALL must hold to win. */
    win: z.array(conditionSchema).min(1, 'a stage needs at least one win condition or it cannot be completed'),
    /** ANY fires to lose. */
    lose: z.array(conditionSchema).default([]),

    beats: z.array(beatSchema).default([]),
    options: optionsSchema.default({}),
  })
  .strict();

// ---------------------------------------------------------------------------
// Cross-field rules — everything the shape alone cannot see
// ---------------------------------------------------------------------------

type StageShape = z.infer<typeof stageShape>;

/** A cell that exists. `col === length` is the end-of-line position, which is real. */
function inBuffer(buffer: readonly string[], pos: Pos): boolean {
  const line = buffer[pos.line];
  return line !== undefined && pos.col <= line.length;
}

/** Where the engine will actually park a normal-mode cursor: never past the last character. */
function isRestingCursor(buffer: readonly string[], pos: Pos): boolean {
  const line = buffer[pos.line];
  return line !== undefined && pos.col <= Math.max(0, line.length - 1);
}

function conditionsOf(stage: StageShape) {
  return [
    ...stage.win.map((c, i) => ({ c, path: ['win', i] as (string | number)[] })),
    ...stage.lose.map((c, i) => ({ c, path: ['lose', i] as (string | number)[] })),
    ...stage.beats.map((b, i) => ({ c: b.on, path: ['beats', i, 'on'] as (string | number)[] })),
  ];
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export const stageSchema = stageShape.superRefine((stage, ctx) => {
  const issue = (path: (string | number)[], message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };

  // Spawn. `VimEngine` clamps a bad cursor rather than rejecting it, so without
  // this the player silently starts somewhere the author did not choose.
  if (!isRestingCursor(stage.buffer, stage.cursor)) {
    issue(['cursor'], `spawn ${stage.cursor.line}:${stage.cursor.col} is outside the buffer — the engine would silently clamp it`);
  }

  // Entities: in bounds, and a rectangle that is actually a rectangle.
  for (const [i, e] of stage.entities.entries()) {
    if (!inBuffer(stage.buffer, e.at)) issue(['entities', i, 'at'], `${e.at.line}:${e.at.col} is outside the buffer`);
    if (e.to !== undefined) {
      if (!inBuffer(stage.buffer, e.to)) issue(['entities', i, 'to'], `${e.to.line}:${e.to.col} is outside the buffer`);
      if (e.to.line < e.at.line || e.to.col < e.at.col) {
        issue(['entities', i, 'to'], `must be at or after "at" on both axes — a rectangle's far corner, not an arbitrary second point`);
      }
    }
  }

  for (const id of duplicates(stage.entities.map((e) => e.id))) {
    issue(['entities'], `duplicate entity id "${id}" — a condition naming it would be ambiguous`);
  }
  for (const id of duplicates(stage.beats.map((b) => b.id))) {
    issue(['beats'], `duplicate beat id "${id}"`);
  }

  // A condition naming an entity that does not exist can never fire, which for
  // a WIN condition means an unwinnable stage that parses perfectly.
  const entityIds = new Set(stage.entities.map((e) => e.id));
  const hasThreat = stage.entities.some((e) => e.kind === 'threat');
  for (const { c, path } of conditionsOf(stage)) {
    if (c.kind === 'cursor-on' && !entityIds.has(c.entity)) {
      issue([...path, 'entity'], `no entity with id "${c.entity}" — this condition can never fire`);
    }
    // The condition is named for the threat doing the reaching, so with no
    // threat drawn there is nothing to do the reaching: dead config in `lose`,
    // and an unwinnable stage in `win`. Same never-fires class as the line above.
    if (c.kind === 'threat-reaches-cursor' && !hasThreat) {
      issue([...path], 'the stage has no threat entity — this condition can never fire');
    }
  }

  // A stage whose win conditions ALL hold at spawn parses perfectly, renders
  // fine, and is over before the player presses anything. Only the statically
  // decidable kinds are judged and every other kind counts as "not yet", so a
  // stage carrying one runtime condition can never be false-flagged here.
  if (
    stage.win.every((c) => {
      if (c.kind === 'buffer-equals') return sameLines(c.lines, stage.buffer);
      if (c.kind === 'cursor-on') {
        const target = entityById(stage.entities, c.entity);
        return target !== undefined && occupies(target, stage.cursor);
      }
      return false;
    })
  ) {
    issue(['win'], 'every win condition already holds at spawn — the stage is won before the player presses a key');
  }

  // Key gating.
  if (stage.allowedKeys !== undefined && stage.allowedKeys.length === 0) {
    issue(['allowedKeys'], 'an empty list permits no keys at all; omit the field entirely to leave the stage ungated');
  }

  // Every spec below is already known to tokenize — `keySpecSchema` ran first —
  // but a spec-level failure aborts only its own entry, so guard the expansion.
  // ALWAYS_ALLOWED joins the set because `gating.ts` will grant those keys
  // regardless: a solution ending in `<Esc>` must not be rejected here for
  // using a key the policy can never actually lock.
  const allowed =
    stage.allowedKeys === undefined ? undefined : safeExpand([...stage.allowedKeys, ...ALWAYS_ALLOWED]);

  if (allowed !== undefined) {
    for (const [i, spec] of stage.teachesKeys.entries()) {
      const taught = safeExpand([spec]);
      const locked = [...taught].filter((t) => !allowed.has(t));
      if (locked.length > 0) {
        issue(['teachesKeys', i], `teaches ${locked.map((k) => JSON.stringify(k)).join(', ')}, which allowedKeys locks — the stage cannot teach a key it rejects`);
      }
    }
  }

  // The solution has to be playable under the stage's own rules. This is the
  // cheap half of M3's validator: the schema proves the keys are permitted, the
  // validator will later prove they actually win.
  let solutionKeys: readonly KeyToken[] | undefined;
  try {
    solutionKeys = tokenize(stage.solution);
  } catch (e) {
    issue(['solution'], `not valid key notation: ${(e as Error).message}`);
  }

  if (solutionKeys !== undefined) {
    if (allowed !== undefined) {
      const denied = [...new Set(solutionKeys.filter((k) => !allowed.has(k)))];
      if (denied.length > 0) {
        issue(['solution'], `uses ${denied.map((k) => JSON.stringify(k)).join(', ')}, which allowedKeys locks — the stage would reject its own solution`);
      }
    }
    if (solutionKeys.length > stage.par) {
      issue(['par'], `par is ${stage.par} but the solution takes ${solutionKeys.length} keystrokes — par is unreachable by the route the stage ships`);
    }
    // The same check one step further out: par is the target, but a keystroke
    // budget in `lose` is a HARD floor, so a budget under the shipped solution's
    // own length loses the stage before that solution can finish winning it.
    for (const [i, c] of stage.lose.entries()) {
      if (c.kind === 'keystrokes-over' && solutionKeys.length > c.max) {
        issue(['lose', i, 'max'], `the budget is ${c.max} but the solution takes ${solutionKeys.length} keystrokes — the stage is lost before its own solution wins it`);
      }
    }
  }
});

/** Never throws: a spec that failed `keySpecSchema` is simply skipped here. */
function safeExpand(specs: readonly string[]): Set<KeyToken> {
  const out = new Set<KeyToken>();
  for (const spec of specs) {
    try {
      for (const token of expandKeySpecs([spec])) out.add(token);
    } catch {
      // already reported by keySpecSchema
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type Stage = z.infer<typeof stageSchema>;

/**
 * The AUTHORED shape — every `.default()` still unmaterialized, `allowedKeys`
 * still able to be absent. `Stage` is this schema's OUTPUT, and M3's editor
 * needs its INPUT: a document model built on `Stage` would bake all seven
 * `options`, `cursor`, and four empty arrays into every exported stage, freezing
 * core's *current* defaults into content that never asked for them — and it
 * could not represent `allowedKeys` at all, since the parse has already
 * collapsed "omitted" (ungated) into the same `undefined` as everything else,
 * while `[]` is rejected outright.
 */
export type StageInput = z.input<typeof stageSchema>;
export type Entity = Stage['entities'][number];
export type EntityKind = (typeof ENTITY_KINDS)[number];
export type Condition = Stage['win'][number];
export type Beat = Stage['beats'][number];

/** `path: message` per line — Zod's own `message` is a JSON blob nobody reads. */
export function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

export function safeParseStage(input: unknown): z.SafeParseReturnType<unknown, Stage> {
  return stageSchema.safeParse(input);
}

export function parseStage(input: unknown): Stage {
  const result = safeParseStage(input);
  if (result.success) return result.data;
  throw new Error(`invalid stage:\n${formatIssues(result.error)}`);
}
