/**
 * Win, lose and story beats — the three collections that speak `schema.ts`'s one
 * condition vocabulary.
 *
 * They share a panel because they share that vocabulary: `conditionSchema` is a
 * single discriminated union with three consumers, and the file's own header says
 * why ("a trigger with no beat attached has nothing to do"). One
 * `ConditionEditor` therefore serves all three, and a fifth condition kind
 * becomes authorable in every one of them at once — with `CONDITION_KINDS`'s
 * compile-time guard in `draft.ts` making sure it cannot be added to the schema
 * and forgotten here.
 *
 * The asymmetry between the two lists is the schema's, not this panel's: ALL win
 * conditions must hold, ANY lose condition fires. It is stated in the copy
 * because an author reading two identical-looking lists has no other way to know.
 */

import type { Dispatch } from 'react';

import {
  blankBeat,
  blankCondition,
  CONDITION_KINDS,
  listOf,
  removeAt,
  replaceAt,
  type ConditionKind,
  type DraftBeat,
  type DraftCondition,
  type DraftEntity,
  type StageDraft,
} from './draft.ts';
import { CheckField, ChoiceField, LinesField, NumberField, TextField } from './fields.tsx';
import type { EditorAction } from './store.ts';

export const EDITS = ['win', 'lose', 'beats'] as const satisfies readonly (keyof StageDraft)[];

/**
 * One condition, kind picker plus whatever that kind carries.
 *
 * Switching kind REPLACES the condition rather than merging into it — the union
 * is discriminated and `.strict()`, so a `cursor-on` that kept a leftover `max`
 * would be rejected as an unrecognised key, which is the schema catching the
 * editor rather than the author.
 */
function ConditionEditor({
  condition,
  entityIds,
  onChange,
}: {
  readonly condition: DraftCondition | undefined;
  readonly entityIds: readonly string[];
  readonly onChange: (next: DraftCondition) => void;
}) {
  // Read defensively: a hand-edited file can put anything in this slot, and the
  // schema is already reporting on it.
  const kind = (condition as { kind?: unknown } | undefined)?.kind;
  const known = CONDITION_KINDS.find((k) => k === kind);

  return (
    <div className="condition">
      <ChoiceField
        label="when"
        value={kind}
        options={CONDITION_KINDS}
        onChange={(next) => onChange(blankCondition(next as ConditionKind, entityIds[0] ?? ''))}
      />
      {known === 'cursor-on' ? (
        <ChoiceField
          label="entity"
          value={(condition as { entity?: unknown }).entity}
          options={entityIds}
          empty="pick an entity"
          hint="the cursor resting anywhere the entity covers"
          onChange={(entity) => onChange({ kind: 'cursor-on', entity })}
        />
      ) : null}
      {known === 'buffer-equals' ? (
        <LinesField
          label="lines"
          value={listOf<string>((condition as { lines?: unknown }).lines)}
          hint="the buffer the player has to produce, one line per row"
          onChange={(lines) => onChange({ kind: 'buffer-equals', lines })}
        />
      ) : null}
      {known === 'keystrokes-over' ? (
        <NumberField
          label="max"
          value={(condition as { max?: unknown }).max}
          hint="a hard budget — enforced on nomagic only"
          onChange={(max) => onChange({ kind: 'keystrokes-over', max: max as number })}
        />
      ) : null}
      {known === 'threat-reaches-cursor' ? (
        <p className="note">fires when a threat steps onto the cursor. needs a threat entity drawn.</p>
      ) : null}
    </div>
  );
}

function ConditionList({
  title,
  note,
  conditions,
  entityIds,
  onChange,
}: {
  readonly title: string;
  readonly note: string;
  readonly conditions: readonly DraftCondition[];
  readonly entityIds: readonly string[];
  readonly onChange: (next: DraftCondition[]) => void;
}) {
  return (
    <>
      <h3>{title}</h3>
      <p className="note">{note}</p>
      {conditions.map((condition, index) => (
        <div key={index} className="row">
          <ConditionEditor
            condition={condition}
            entityIds={entityIds}
            onChange={(next) => onChange(replaceAt(conditions, index, next))}
          />
          <button type="button" onClick={() => onChange(removeAt(conditions, index))}>
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...conditions, blankCondition('cursor-on', entityIds[0] ?? '')])}
      >
        add {title} condition
      </button>
    </>
  );
}

export function ConditionsPanel({
  draft,
  dispatch,
}: {
  readonly draft: StageDraft;
  readonly dispatch: Dispatch<EditorAction>;
}) {
  const entityIds = listOf<DraftEntity>(draft.entities).map((e) => (typeof e?.id === 'string' ? e.id : ''));
  const win = listOf<DraftCondition>(draft.win);
  const lose = listOf<DraftCondition>(draft.lose);
  const beats = listOf<DraftBeat>(draft.beats);

  const setBeats = (next: readonly DraftBeat[]): void => {
    dispatch({ kind: 'field-set', field: 'beats', value: [...next] });
  };

  return (
    <div className="pane">
      <h2>win, lose, beats</h2>

      <ConditionList
        title="win"
        note="ALL of these must hold."
        conditions={win}
        entityIds={entityIds}
        onChange={(value) => dispatch({ kind: 'field-set', field: 'win', value })}
      />
      <ConditionList
        title="lose"
        note="ANY of these fires."
        conditions={lose}
        entityIds={entityIds}
        onChange={(value) => dispatch({ kind: 'field-set', field: 'lose', value })}
      />

      <h3>beats</h3>
      <p className="note">a line of story, and the condition that fires it.</p>
      {beats.map((beat, index) => {
        const edit = (patch: Partial<DraftBeat>): void => {
          const current = beats[index];
          if (current === undefined) return;
          setBeats(replaceAt(beats, index, { ...current, ...patch }));
        };
        return (
          <div key={index} className="row">
            <TextField label="id" value={beat?.id} onChange={(value) => edit({ id: value as DraftBeat['id'] })} />
            <TextField label="text" value={beat?.text} onChange={(value) => edit({ text: value as DraftBeat['text'] })} />
            <CheckField
              label="startling"
              value={beat?.startling}
              hint="required by the schema: Gentle Mode filters on this flag, so a forgotten one ships a startle to a player who asked for none"
              onChange={(startling) => edit({ startling })}
            />
            <ConditionEditor condition={beat?.on} entityIds={entityIds} onChange={(on) => edit({ on })} />
            <button type="button" onClick={() => setBeats(removeAt(beats, index))}>
              remove beat
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setBeats([...beats, blankBeat(beats.map((b) => b?.id ?? ''), entityIds[0] ?? '')])}
      >
        add beat
      </button>
    </div>
  );
}
