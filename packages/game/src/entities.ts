/**
 * The entity overlay's position math.
 *
 * `schema.ts` owns the shapes and their validation; this file owns the one
 * question the shapes cannot answer on their own — **which buffer cells does an
 * entity actually occupy?** That is a real question rather than a trivial one
 * because an entity is either a single cell (`at`) or an inclusive RECTANGLE
 * (`at`..`to`), which is what lets a wall be one authored entity instead of
 * twenty.
 *
 * Everything here is pure and reuses core's `Pos` rather than inventing a
 * parallel coordinate type. What looks like a cycle is not one: this file takes
 * only TYPES from `schema.ts`, which `verbatimModuleSyntax` erases outright, so
 * the only runtime edge runs schema → entities. That is what lets the schema's
 * own refinements reuse `occupies` instead of carrying a second copy of the
 * rectangle math that could drift from this one.
 */

import type { Pos } from '@vimorror/core';
import type { Entity, EntityKind } from './schema.ts';

/**
 * Does `entity` cover `pos`?
 *
 * The rectangle is `<C-v>`-shaped: every cell between the two corners on both
 * axes, NOT a charwise span that flows around line ends. A wall drawn from
 * `0:2` to `3:5` blocks columns 2–5 on lines 0–3 and nothing else — which is
 * what an author painting a block on a grid means, and what M3's overlay
 * palette will emit.
 */
export function occupies(entity: Entity, pos: Pos): boolean {
  const { at, to } = entity;
  if (to === undefined) return pos.line === at.line && pos.col === at.col;
  return pos.line >= at.line && pos.line <= to.line && pos.col >= at.col && pos.col <= to.col;
}

/**
 * Resolve a condition's entity reference. Returns `undefined` for an unknown
 * id, which `stageSchema` has already rejected — a validated stage cannot get
 * here, and an unvalidated one should not crash the loop.
 */
export function entityById(entities: readonly Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

/** All entities of one kind — `tick.ts` moving threats, `rules.ts` testing them. */
export function entitiesOfKind(entities: readonly Entity[], kind: EntityKind): Entity[] {
  return entities.filter((e) => e.kind === kind);
}
