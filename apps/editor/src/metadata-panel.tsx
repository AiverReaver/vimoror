/**
 * Everything about the stage that is not its overlay: the identity fields, the
 * spawn, the key gating, the solution pair, and the seven `:set` overrides.
 *
 * Two things here are derived rather than typed out, and both are drift guards
 * rather than cleverness:
 *
 * - **The `options` grid is a loop over `DEFAULT_OPTIONS` itself.** Add an option
 *   to `vim-core` and it becomes authorable with no edit here — the same
 *   direction `schema.ts`'s `satisfies Record<keyof EditorOptions, …>` guards
 *   from, one layer up. The field TYPE comes from the default's own type, so
 *   there is no second table saying which options are booleans.
 * - **`EDITS` names the fields this panel owns**, and `app.tsx` asserts the four
 *   panels' lists cover `keyof StageDraft` between them. A fifteenth schema field
 *   fails the build until some panel claims it, which is Wave C's done-line
 *   ("every field `schema.ts` accepts is reachable from the UI") enforced by the
 *   compiler instead of by memory.
 *
 * **There is no difficulty field**, deliberately and per M2 Wave E's decision:
 * difficulty is the player's session-level choice, nothing would consume a
 * stage-level copy, and "this stage is harder" is already authorable in `par`, a
 * `keystrokes-over` budget, threat placement and `allowedKeys`. The plan named
 * such a field twice before that decision landed; this comment is here so it is
 * not added back by a reader working from the older doc.
 */

import { DEFAULT_OPTIONS } from '@vimorror/core';
import type { Dispatch } from 'react';

import { specsOrAbsent, withOption, type DraftOptions, type StageDraft } from './draft.ts';
import { LinesField, NumberField, PosField, TextField, TriField } from './fields.tsx';
import type { EditorAction } from './store.ts';

export const EDITS = ['id', 'act', 'title', 'cursor', 'allowedKeys', 'teachesKeys', 'par', 'solution', 'options'] as const satisfies readonly (keyof StageDraft)[];

export function MetadataPanel({ draft, dispatch }: { draft: StageDraft; dispatch: Dispatch<EditorAction> }) {
  const options = draft.options as DraftOptions | undefined;
  const setOption = (key: keyof DraftOptions, value: number | boolean | undefined): void => {
    dispatch({ kind: 'field-set', field: 'options', value: withOption(options, key, value) });
  };

  return (
    <div className="pane">
      <h2>metadata</h2>

      <TextField
        label="id"
        value={draft.id}
        hint="unique across content/stages; the file is named after it"
        onChange={(value) => dispatch({ kind: 'field-set', field: 'id', value })}
      />
      <TextField
        label="title"
        value={draft.title}
        onChange={(value) => dispatch({ kind: 'field-set', field: 'title', value })}
      />
      <NumberField
        label="act"
        value={draft.act}
        hint="1–6, the curriculum's acts"
        onChange={(value) => dispatch({ kind: 'field-set', field: 'act', value })}
      />
      <PosField
        label="spawn"
        value={draft.cursor}
        placeholder={{ line: 0, col: 0 }}
        hint="where the cursor starts; empty is the schema's own 0:0"
        onChange={(value) => dispatch({ kind: 'field-set', field: 'cursor', value })}
      />

      <h3>the route</h3>
      <TextField
        label="solution"
        value={draft.solution}
        hint="key notation; Wave D's recorder writes this from real play"
        onChange={(value) => dispatch({ kind: 'field-set', field: 'solution', value })}
      />
      <NumberField
        label="par"
        value={draft.par}
        hint="target keystrokes; may not be under the solution's own length"
        onChange={(value) => dispatch({ kind: 'field-set', field: 'par', value })}
      />

      <h3>keys</h3>
      <LinesField
        label="allowedKeys"
        value={draft.allowedKeys}
        hint="one key spec per line — empty leaves the stage ungated"
        onChange={(lines) => dispatch({ kind: 'field-set', field: 'allowedKeys', value: specsOrAbsent(lines) })}
      />
      <LinesField
        label="teachesKeys"
        value={draft.teachesKeys}
        hint="what the stage is FOR; must be a subset of allowedKeys"
        onChange={(lines) => dispatch({ kind: 'field-set', field: 'teachesKeys', value: specsOrAbsent(lines) })}
      />

      <h3>options</h3>
      <p className="note">the same `:set` options a player could type; not difficulty.</p>
      {Object.entries(DEFAULT_OPTIONS).map(([key, fallback]) => {
        const option = key as keyof DraftOptions;
        const value = options?.[option];
        return typeof fallback === 'boolean' ? (
          <TriField
            key={key}
            label={key}
            value={value}
            fallback={fallback}
            onChange={(next) => setOption(option, next)}
          />
        ) : (
          <NumberField
            key={key}
            label={key}
            value={value}
            placeholder={String(fallback)}
            onChange={(next) => setOption(option, next)}
          />
        );
      })}
    </div>
  );
}
