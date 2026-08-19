/**
 * The export, on screen.
 *
 * `exportStage` already produced the exact bytes a save writes; until this pane
 * existed there was no way to READ them. That is a gap rather than a nicety:
 * `HAS_FILE_PICKERS` is false in Firefox and Safari, where both file buttons are
 * disabled and a finished stage could not leave the editor at all. A textarea is
 * the whole fix — the same text, selectable, with no second serializer to drift
 * from the one the save uses.
 *
 * Read-only on purpose. Editing JSON here would be a second authoring surface
 * competing with the panels, and `readDraft` (the file door) is where text
 * becomes a draft — this direction is one-way by design.
 *
 * Select-on-focus because the copy gesture is the point: one click, one
 * `cmd-C`.
 *
 * **`safeExportStage`, not `exportStage`**, and that is not defensive habit: this
 * is the first caller to serialize in a RENDER rather than inside `save()`'s
 * `try`, and a throw here unmounts the React tree and destroys the issues pane —
 * the same blank-page failure `drawableEntities` and `listOf` guard one and two
 * doors further in. `draft.ts` carries the measurement of the file that does it.
 */

import { safeExportStage, stageFileName, type StageDraft } from './draft.ts';

export type ExportPaneProps = {
  readonly draft: StageDraft;
};

export function ExportPane({ draft }: ExportPaneProps) {
  const result = safeExportStage(draft);
  return (
    <div className="pane export">
      <h2>export — {stageFileName(draft)}</h2>
      {result.ok ? (
        <textarea
          className="lines export-text"
          readOnly
          spellCheck={false}
          aria-label="the stage as it would be saved"
          value={result.text}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : (
        <p className="bad">{result.error}</p>
      )}
    </div>
  );
}
