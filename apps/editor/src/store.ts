/**
 * The reducer. Pure by construction, so the parts that carry real logic are
 * vitest-testable without a DOM — the textarea's text becoming buffer lines, and
 * at Wave C a grid drag becoming an entity.
 *
 * `useReducer` rather than a store library. Zustand's own justification in the
 * technology table is that it "works outside React **for the game loop**", which
 * is M4's stage runner; the editor's whole state is one draft, a selection and an
 * armed tool.
 *
 * **Wave C added one action, not fifteen.** Every panel field goes through
 * `field-set`, and the arrays (`entities`, `win`, `lose`, `beats`) are rebuilt by
 * the panel and set whole — so `replaceAt`/`removeAt` live in `draft.ts` next to
 * the shapes rather than becoming a per-collection action apiece. The one edit
 * that carries real logic instead of a value is `entity-painted`, because two
 * grid cells become a normalised rectangle and a fresh unique id.
 */

import type { Pos } from '@vimorror/core';
import type { EntityKind } from '@vimorror/game';

import { blankEntity, blankStage, listOf, rectFrom, withField, type DraftEntity, type StageDraft } from './draft.ts';

export type EditorState = {
  readonly draft: StageDraft;
  /** The entity the panels act on, by id. `undefined` is a legal, common state. */
  readonly selection: string | undefined;
  /**
   * The armed paint tool, or `undefined` for the ordinary click-to-select grid.
   *
   * A tool disarms itself the moment it paints, which is a decision rather than
   * an oversight: the grid's other job is selecting, and a tool left armed turns
   * every click meant to pick an existing entity into a new one-cell entity
   * stacked on top of it. One pick, one entity.
   */
  readonly tool: EntityKind | undefined;
};

/**
 * `field-set` is one action for all fourteen top-level fields, mapped off
 * `StageDraft` so the pair is checked: `{ field: 'act', value: 'x' }` does not
 * compile. Fourteen hand-written actions would be the same reducer with thirteen
 * more places for a typo to hide, and a fifteenth field would need a fifteenth
 * action instead of nothing at all.
 *
 * `| undefined` on the value is what lets a field be CLEARED — see
 * `withField`, which removes the key rather than storing an explicit undefined.
 */
export type FieldSet = {
  [K in keyof StageDraft]-?: { readonly kind: 'field-set'; readonly field: K; readonly value: StageDraft[K] | undefined };
}[keyof StageDraft];

export type EditorAction =
  | { readonly kind: 'buffer-typed'; readonly text: string }
  | { readonly kind: 'draft-opened'; readonly draft: StageDraft }
  | { readonly kind: 'entity-selected'; readonly id: string | undefined }
  | { readonly kind: 'tool-picked'; readonly tool: EntityKind | undefined }
  | { readonly kind: 'entity-painted'; readonly from: Pos; readonly to: Pos }
  | FieldSet;

export function initialState(): EditorState {
  return { draft: blankStage(), selection: undefined, tool: undefined };
}

/**
 * A textarea's value is one string; the schema's buffer is one entry per line.
 *
 * `split('\n')` is exact against `join('\n')` in both directions and lands
 * Vim's own floor for free: `''.split('\n')` is `['']`, a buffer of one empty
 * line, which is what `min(1, 'a buffer has at least one line')` asks for. No
 * `\r` handling, deliberately — HTML normalises a textarea's API value to `\n`,
 * so a carriage return can only arrive inside an opened FILE, and there the
 * schema's own `lineSchema` is the thing that should report it rather than the
 * editor silently rewriting content off disk.
 */
export function bufferFromText(text: string): string[] {
  return text.split('\n');
}

/** The inverse, for the textarea. */
export function textFromBuffer(buffer: readonly string[]): string {
  return buffer.join('\n');
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.kind) {
    case 'buffer-typed':
      return { ...state, draft: { ...state.draft, buffer: bufferFromText(action.text) } };
    case 'draft-opened':
      // The selection is dropped, not kept: it names an entity id, and the
      // incoming draft is a different stage whose ids have nothing to do with
      // the outgoing one's. A stale id would leave the panels acting on nothing.
      // The tool goes with it for the same reason a half-typed command dies on a
      // rejected key — it was armed against the stage that just closed.
      return { draft: action.draft, selection: undefined, tool: undefined };
    case 'entity-selected':
      return { ...state, selection: action.id };
    case 'tool-picked':
      return { ...state, tool: action.tool };
    case 'field-set':
      return { ...state, draft: withField(state.draft, action.field, action.value) };
    case 'entity-painted': {
      // Not reachable from the UI (the grid selects when nothing is armed), and
      // returning the state unchanged rather than throwing keeps that a UI fact
      // instead of a crash waiting for a second caller.
      if (state.tool === undefined) return state;
      const entities = listOf<DraftEntity>(state.draft.entities);
      const painted = blankEntity(state.tool, rectFrom(action.from, action.to), entities.map((e) => e.id));
      return {
        draft: withField(state.draft, 'entities', [...entities, painted]),
        // Selected, so the entity's own fields are already in front of the
        // author — a painted rectangle almost always wants a label or a glyph
        // next, and hunting for the row it just created is the alternative.
        selection: painted.id,
        tool: undefined,
      };
    }
  }
}
