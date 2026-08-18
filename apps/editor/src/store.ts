/**
 * The reducer. Pure by construction, so the parts that carry real logic are
 * vitest-testable without a DOM — which at Wave B is one thing: turning the
 * textarea's text back into buffer lines.
 *
 * `useReducer` rather than a store library. Zustand's own justification in the
 * technology table is that it "works outside React **for the game loop**", which
 * is M4's stage runner; the editor's whole state is one draft plus a selection.
 */

import { blankStage, type StageDraft } from './draft.ts';

export type EditorState = {
  readonly draft: StageDraft;
  /** The entity the panels act on, by id. `undefined` is a legal, common state. */
  readonly selection: string | undefined;
};

export type EditorAction =
  | { readonly kind: 'buffer-typed'; readonly text: string }
  | { readonly kind: 'draft-opened'; readonly draft: StageDraft }
  | { readonly kind: 'entity-selected'; readonly id: string | undefined };

export function initialState(): EditorState {
  return { draft: blankStage(), selection: undefined };
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
      return { draft: action.draft, selection: undefined };
    case 'entity-selected':
      return { ...state, selection: action.id };
  }
}
