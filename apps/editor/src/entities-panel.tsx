/**
 * The overlay: the palette that arms a paint tool, and the entity list.
 *
 * The palette does not create anything on its own — it ARMS a kind, and the next
 * click or drag on the preview places it. That is the plan's "palette click
 * places `at`, drag sweeps a rectangle to `to`", and the reason placement lives
 * on the grid rather than in a coordinate form is that a rectangle is a shape an
 * author draws, not four numbers they compute. The numbers are here too, for the
 * nudge afterwards.
 *
 * Only the SELECTED entity shows its fields. A stage's walls run to a dozen
 * entities and thirty always-open inputs is a wall of its own — and the grid
 * already selects by click, so the row and the picture stay in step. Clicking a
 * row selects it, which is the same action from the other side.
 *
 * Every read of a nested field is guarded (`entity.at?.line`, never
 * `entity.at.line`) for Wave B's reason, one door further in: `readDraft` admits
 * a hand-edited file whose entity has no `at`, the schema is already reporting
 * it, and a throw from this panel would unmount the tree and take the report with
 * it. The type says the field is there; the file is what actually arrives.
 */

import { ENTITY_KINDS, type EntityKind } from '@vimorror/game';
import type { Dispatch } from 'react';

import { blankEntity, listOf, removeAt, replaceAt, type DraftEntity, type StageDraft } from './draft.ts';
import { ChoiceField, PosField, TextField } from './fields.tsx';
import type { EditorAction } from './store.ts';

export const EDITS = ['entities'] as const satisfies readonly (keyof StageDraft)[];

export function EntitiesPanel({
  draft,
  selection,
  tool,
  dispatch,
}: {
  readonly draft: StageDraft;
  readonly selection: string | undefined;
  readonly tool: EntityKind | undefined;
  readonly dispatch: Dispatch<EditorAction>;
}) {
  const entities = listOf<DraftEntity>(draft.entities);
  const set = (next: readonly DraftEntity[]): void => {
    dispatch({ kind: 'field-set', field: 'entities', value: [...next] });
  };
  const edit = (index: number, patch: Partial<DraftEntity>): void => {
    const current = entities[index];
    if (current === undefined) return;
    set(replaceAt(entities, index, { ...current, ...patch }));
  };

  return (
    <div className="pane">
      <h2>entities</h2>

      <div className="palette">
        {ENTITY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={tool === kind ? `armed ${kind}` : kind}
            aria-pressed={tool === kind}
            // Picking the armed kind again disarms it, so an author who changed
            // their mind gets the plain click-to-select grid back without having
            // to place an entity they do not want.
            onClick={() => dispatch({ kind: 'tool-picked', tool: tool === kind ? undefined : kind })}
          >
            {kind}
          </button>
        ))}
      </div>
      <p className="note">
        {tool === undefined
          ? 'pick a kind, then click or drag on the preview to place it.'
          : `click or drag on the preview to place the ${tool}.`}
      </p>

      {entities.length === 0 ? <p className="note">no entities yet.</p> : null}
      {entities.map((entity, index) => {
        const id = typeof entity?.id === 'string' ? entity.id : '';
        const selected = id !== '' && id === selection;
        return (
          <div key={index} className={selected ? 'row selected' : 'row'}>
            <div className="row-head">
              <button
                type="button"
                className="link"
                aria-current={selected}
                onClick={() => dispatch({ kind: 'entity-selected', id: selected ? undefined : id })}
              >
                {entity?.glyph ?? '?'} {id === '' ? '(no id)' : id} — {entity?.kind ?? '(no kind)'} at{' '}
                {entity?.at?.line ?? '?'}:{entity?.at?.col ?? '?'}
                {entity?.to === undefined ? '' : ` … ${entity.to.line}:${entity.to.col}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  set(removeAt(entities, index));
                  // The selection is an id, and the entity holding it is gone —
                  // leaving it set would highlight nothing while still reading as
                  // a selection to every panel that asks.
                  if (selected) dispatch({ kind: 'entity-selected', id: undefined });
                }}
              >
                delete
              </button>
            </div>

            {selected ? (
              <div className="row-body">
                <TextField label="id" value={entity?.id} onChange={(value) => {
                  edit(index, { id: value as DraftEntity['id'] });
                  // The selection follows the rename. Without this the panel
                  // collapses the row mid-edit, because `selected` is an id match
                  // and the id just changed under it.
                  dispatch({ kind: 'entity-selected', id: value });
                }} />
                <ChoiceField
                  label="kind"
                  value={entity?.kind}
                  options={ENTITY_KINDS}
                  onChange={(value) => edit(index, { kind: value as EntityKind })}
                />
                <TextField
                  label="glyph"
                  value={entity?.glyph}
                  hint="exactly one character — the never-colour-alone invariant"
                  onChange={(value) => edit(index, { glyph: value as DraftEntity['glyph'] })}
                />
                <TextField
                  label="label"
                  value={entity?.label}
                  hint="optional; the redundant wording beside the colour"
                  onChange={(value) => edit(index, { label: value })}
                />
                <PosField label="at" value={entity?.at} onChange={(value) => edit(index, { at: value as DraftEntity['at'] })} />
                <PosField
                  label="to"
                  value={entity?.to}
                  hint="the rectangle's far corner; clear both to make it one cell"
                  onChange={(value) => edit(index, { to: value })}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      <button
        type="button"
        // The keyboard route to the same thing the grid drag does: a one-cell
        // entity at the origin, which the author then drags or types into place.
        // It exists because painting needs a pointer and this panel should not be
        // the one surface in the editor that requires one.
        onClick={() => {
          const painted = blankEntity('goal', { at: { line: 0, col: 0 } }, entities.map((e) => e?.id ?? ''));
          set([...entities, painted]);
          dispatch({ kind: 'entity-selected', id: painted.id });
        }}
      >
        add at 0:0
      </button>
    </div>
  );
}
