/**
 * The textual half of the dual pane: the stage's buffer as one editable string.
 *
 * A plain `<textarea>` on purpose. The thing being edited is raw buffer text —
 * no syntax, no completion, no gutter — and the grid beside it is the preview,
 * so a code-editor component would add a dependency, a second set of keybindings
 * to fight with the vim engine at Wave D, and nothing an author asked for.
 *
 * `wrap="off"` is load-bearing rather than cosmetic: a soft-wrapped line reads on
 * screen as two lines and reaches the schema as one, which is the same confusion
 * `lineSchema` rejects a literal `\n` to prevent. An author must be able to see
 * that a long line IS one line.
 */

import type { ChangeEvent } from 'react';

import type { StageDraft } from './draft.ts';

/**
 * The one field this pane authors. `app.tsx` asserts the four panes' lists cover
 * `keyof StageDraft` between them, so a field added to `stageShape` fails the
 * build until a pane claims it.
 */
export const EDITS = ['buffer'] as const satisfies readonly (keyof StageDraft)[];

export type BufferPaneProps = {
  readonly text: string;
  readonly onChange: (text: string) => void;
};

export function BufferPane({ text, onChange }: BufferPaneProps) {
  return (
    <div className="pane">
      <h2>buffer</h2>
      <textarea
        className="buffer"
        value={text}
        wrap="off"
        spellCheck={false}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
      />
    </div>
  );
}
