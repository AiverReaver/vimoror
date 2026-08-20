/**
 * The save: a versioned envelope in `localStorage`, and nothing that re-solves
 * a problem `session.ts` already solved.
 *
 * **This is a codec, not a serializer**, and the distinction is M4-PLAN.md's
 * fact 3. `SessionSnapshot` already carries every piece of evolved play state —
 * engine snapshot, live entity positions, the four tallies, outcome, fired
 * beats, difficulty and comfort — and its own doc comment assigns the envelope
 * to this file verbatim: *"M4's `localStorage` save is the consumer and owns
 * the envelope around this — its own `schemaVersion` included; nothing here is
 * versioned."* So `current.snapshot` goes in and comes out untouched. The hard
 * half is already done there (the `Set`-JSONs-to-`{}` trap, authored-vs-evolved,
 * the mid-visual clamp on restore), and re-solving any of it here would be
 * exactly the drift M2 Wave E's keystone exists to catch.
 *
 * Three decisions, each of which the plan states and one of which it states
 * twice because it is the one that protects a player:
 *
 * - **A payload we cannot read is RENAMED ASIDE, never deleted.**
 *   `vimorror.orphan.v<N>` — one line that keeps "start clean" from meaning
 *   "silently destroy a player's history". No migration framework is built,
 *   because there is exactly one schema version and nothing to migrate from;
 *   the orphan key is what makes writing one later possible at all.
 * - **The snapshot is validated shallowly and restored inside a `try`.**
 *   Everything the shell itself reads or renders is checked here; `engine` is
 *   left opaque, because a Zod mirror of `EngineSnapshot` would be a second
 *   authority on core's own save format and would go stale the first time core
 *   grows a field. `GameSession.restore` throws on a stage mismatch — the one
 *   deliberate loud failure on that surface — and `VimEngine.restore` throws on
 *   a garbage engine, so the caller's `catch` covers both. `save.test.ts`
 *   round-trips a REAL snapshot through the schema, which is what keeps the
 *   shallow half honest as `SessionSnapshot` grows.
 * - **Every entry point tolerates having no storage at all.** Safari's private
 *   mode throws on `localStorage` *access*, not just on write; vitest's `node`
 *   environment has none; and a full disk throws on `setItem`. None of those
 *   may be the reason a keystroke fails, so reads answer `undefined` and writes
 *   warn.
 *
 * The store is a parameter with a default rather than a module-level constant,
 * which is the whole of this file's testability: the suite passes a `Map`-backed
 * fake and needs no jsdom, no mocks and no global patching.
 */

import type { SessionSnapshot } from '@vimorror/game';
import { z } from 'zod';

import type { Settings } from './settings-screen.tsx';

/**
 * Bumped when the envelope's shape changes in a way an older payload cannot
 * satisfy. A mismatch is not an error — it is an orphan (see `loadSave`).
 */
export const SCHEMA_VERSION = 1;

/** The one key the game owns. Orphans are `${SAVE_KEY}.orphan.v<N>`. */
export const SAVE_KEY = 'vimorror.save';

/** What a stage remembers about the best run through it. */
export type StageProgress = {
  readonly completed: boolean;
  /** The fewest keystrokes a winning run took. Absent until one does. */
  readonly bestKeystrokes: number;
  /** True once ANY winning run was clean — a later assisted win does not undo it. */
  readonly cleanRun: boolean;
};

export type Progress = Readonly<Record<string, StageProgress>>;

export type Save = {
  readonly schemaVersion: number;
  readonly settings: Settings;
  readonly progress: Progress;
  /** The one resumable stage in flight. Cleared the moment an outcome latches. */
  readonly current: { readonly snapshot: SessionSnapshot } | undefined;
};

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

const comfortSchema = z.object({ gentle: z.boolean(), jumpScares: z.boolean() }).strict();

/**
 * Mirrors `Settings` (`settings-screen.tsx`), which is the shape React renders
 * and `draw()` consumes. `effectsIntensity` is bounded here rather than clamped
 * because a stored 47 is not a preference to honour, it is a payload to reject —
 * and rejecting the envelope drops the player back on `defaultSettings()`, which
 * is a working game.
 */
const settingsSchema = z
  .object({
    difficulty: z.enum(['verymagic', 'magic', 'nomagic']),
    comfort: comfortSchema,
    effectsIntensity: z.number().min(0).max(1),
    audio: z.object({ muted: z.boolean(), volume: z.number().min(0).max(1) }).strict(),
  })
  .strict();

const stageProgressSchema = z
  .object({
    completed: z.boolean(),
    bestKeystrokes: z.number().int().nonnegative(),
    cleanRun: z.boolean(),
  })
  .strict();

/**
 * Shallow on purpose, and `.passthrough()` on purpose.
 *
 * Checked are exactly the fields `GameSession.restore` assigns without looking
 * at them and the shell then renders — a `keystrokes` of `"soon"` would reach
 * the HUD as `soon/9 keys` and the scorer as `NaN`. Not checked is `engine`,
 * which belongs to core's own snapshot format; `VimEngine.restore` throwing on
 * garbage is the guard, and the caller must catch it anyway for the stage-id
 * mismatch that `GameSession.restore` raises by design.
 *
 * `entities` is `unknown[]` rather than a mirror of `entitySchema` because
 * `stage-view`'s `drawableEntities` already filters what cannot be drawn — the
 * trust boundary is stated there and adding a second one here would be two
 * places to keep agreeing.
 *
 * `.passthrough()` so a field added to `SessionSnapshot` survives a round trip
 * instead of being silently stripped, which is the failure a `.strip()` default
 * would produce: a save that parses, loads, and has quietly lost state.
 */
const snapshotSchema = z
  .object({
    stageId: z.string().min(1),
    engine: z.unknown(),
    entities: z.array(z.unknown()),
    keystrokes: z.number().int().nonnegative(),
    ticks: z.number().int().nonnegative(),
    undos: z.number().int().nonnegative(),
    hintsShown: z.number().int().nonnegative(),
    outcome: z.object({ status: z.enum(['playing', 'won', 'lost']) }).passthrough(),
    firedBeats: z.array(z.string()),
    difficulty: z.enum(['verymagic', 'magic', 'nomagic']),
    comfort: comfortSchema,
  })
  .passthrough();

const saveSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    settings: settingsSchema,
    progress: z.record(z.string(), stageProgressSchema),
    current: z.object({ snapshot: snapshotSchema }).strict().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * `localStorage` if this environment has one and lets us touch it.
 *
 * The access itself is inside the `try` deliberately: Safari with cookies
 * blocked throws a `SecurityError` on the *property read*, not on `getItem`, so
 * a guard that only wrapped the call would still take the page down.
 */
function defaultStore(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The stored save, or `undefined` for every way of not having one: no storage,
 * no key, unparseable JSON, a shape that fails the schema, a version we do not
 * know.
 *
 * **The last two rename rather than drop.** A payload that is real data we
 * cannot read is a player's history, and "start clean" must never mean "start
 * clean and destroy what was there". The orphan key carries the version it
 * claimed to be, so a migration written later has something to find.
 */
export function loadSave(store: Storage | undefined = defaultStore()): Save | undefined {
  if (store === undefined) return undefined;

  let raw: string | null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Not data at all — nothing a migration could ever recover, so it is not
    // worth an orphan key that would then never be cleaned up.
    return undefined;
  }

  const parsed = saveSchema.safeParse(json);
  if (!parsed.success) {
    orphan(store, raw, json);
    return undefined;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    settings: parsed.data.settings,
    progress: parsed.data.progress,
    // Shallow-validated and passed through — see `snapshotSchema`. The cast is
    // where this file stops pretending to know core's save format.
    current: parsed.data.current as { snapshot: SessionSnapshot } | undefined,
  };
}

/** Move an unreadable payload aside under the version it claimed. */
function orphan(store: Storage, raw: string, json: unknown): void {
  const claimed = (json as { schemaVersion?: unknown } | null)?.schemaVersion;
  const version = typeof claimed === 'number' ? claimed : 'unknown';
  try {
    store.setItem(`${SAVE_KEY}.orphan.v${version}`, raw);
    store.removeItem(SAVE_KEY);
  } catch {
    // A full disk here means the orphan could not be written — so the original
    // is LEFT WHERE IT IS rather than removed. Failing to preserve it is not a
    // reason to destroy it.
  }
  console.warn(`vimorror: a save was set aside as ${SAVE_KEY}.orphan.v${version} — starting clean`);
}

/**
 * Write the envelope. A failure is a warning and nothing else: this is called
 * after every keystroke, and a full disk must not be the thing that ends a run.
 */
export function storeSave(save: Save, store: Storage | undefined = defaultStore()): void {
  if (store === undefined) return;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) {
    console.warn(`vimorror: the save could not be written (${String(e)})`);
  }
}
