/**
 * The form primitives the three Wave C panels are built from.
 *
 * These exist because the alternative is thirty hand-written
 * `<label><input …/></label>` pairs, each with its own idea of how an empty box
 * becomes a value — and that decision is the one thing on this surface that is
 * not cosmetic. Two rules are shared by every field below, and both come
 * straight from the input-type decision `draft.ts` documents:
 *
 * - **An empty box is an ABSENT field, not a zero or an empty string.** Clearing
 *   `par` removes it and the schema says `par: Required`, which is a true
 *   statement about what the author has written. Substituting `0` would invent a
 *   value the author did not choose, and on `cursor` or `options` it would
 *   materialize a default the export is supposed to leave out.
 * - **A value off a hand-edited FILE need not be the type the field expects.**
 *   `readDraft` admits `{"title": {}}` deliberately — `schema.ts` is the
 *   authority and reports it on the next render — so `asText` never assumes, and
 *   nothing here indexes into a value before checking it. Wave B's blank page
 *   came from exactly one such read.
 */

import type { Pos } from '@vimorror/core';
import type { ChangeEvent, ReactNode } from 'react';

/**
 * Anything at all, as something an `<input>` can hold. An object shows as its
 * JSON rather than as `[object Object]`, so an author who hand-edited a field
 * into the wrong shape can see what is in there before replacing it.
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label" title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
  placeholder?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="text"
        value={asText(value)}
        placeholder={placeholder ?? ''}
        spellCheck={false}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </Field>
  );
}

/**
 * `Number('')` is 0, which is why the empty case is handled before the parse
 * rather than after: a cleared `par` must go absent, not become the one value
 * `positive()` rejects with a message about the number instead of about the gap.
 */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  placeholder?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        className="num"
        value={asText(value)}
        placeholder={placeholder ?? ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

export function CheckField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: unknown;
  onChange: (value: boolean) => void;
  hint?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
    </Field>
  );
}

/**
 * A three-state boolean: core's default, or an explicit override either way.
 *
 * The middle state is the point. `options` has seven `.default()`s and an author
 * who wants `expandtab` on must be able to say so without also writing the other
 * six — and must be able to take it back to "whatever core says" rather than to a
 * `false` that happens to match today's default and would stop tracking it
 * tomorrow. The default's own value is shown rather than described, because
 * "default" alone leaves the author guessing which way it falls.
 */
export function TriField({
  label,
  value,
  fallback,
  onChange,
  hint,
}: {
  label: string;
  value: unknown;
  fallback: boolean;
  onChange: (value: boolean | undefined) => void;
  hint?: string | undefined;
}) {
  const current = value === true ? 'true' : value === false ? 'false' : '';
  return (
    <Field label={label} hint={hint}>
      <select value={current} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
        <option value="">default ({String(fallback)})</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </Field>
  );
}

export function ChoiceField({
  label,
  value,
  options,
  onChange,
  empty,
  hint,
}: {
  label: string;
  value: unknown;
  options: readonly string[];
  onChange: (value: string) => void;
  /** Text for the "nothing picked" entry; omit when the field is required. */
  empty?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint}>
      <select value={asText(value)} onChange={(e) => onChange(e.target.value)}>
        {/* A value that is not one of the options gets an option of its own, and
            that covers two REAL states rather than being defensive. An entity id
            whose entity was renamed or deleted must stay visible, or the select
            would display the first option while the draft still holds the stale
            reference the issues pane is complaining about. And a MISSING value
            does the same thing more quietly: a `<select>` whose value matches no
            option renders the first one, so a condition that a hand-edited file
            left as `null` displayed `cursor-on` — the editor asserting a kind
            nothing in the draft says. Measured in the browser on exactly that
            file. */}
        {options.includes(asText(value)) ? null : (
          <option value={asText(value)}>
            {asText(value) === '' ? (empty ?? '(unset)') : `${asText(value)} (unknown)`}
          </option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * A `string[]` as one entry per line, reusing `store.ts`'s own textarea
 * conversion — the pair with the round-trip property test, so nothing here can
 * lose or invent a line.
 *
 * Empty lines are KEPT rather than dropped, which is the difference between a
 * working input and a broken one: the value is derived from state on every
 * render, so a rule that dropped the trailing empty entry would delete the
 * newline the author just typed, out from under the caret. The cost is that a
 * trailing blank line in `allowedKeys` reads as `a key spec may not be empty` —
 * the schema's own message, about something genuinely written.
 */
export function LinesField({
  label,
  value,
  onChange,
  rows,
  hint,
}: {
  label: string;
  value: readonly string[] | undefined;
  onChange: (value: string[]) => void;
  rows?: number | undefined;
  hint?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className="lines"
        rows={rows ?? 3}
        wrap="off"
        spellCheck={false}
        value={(value ?? []).map(asText).join('\n')}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value.split('\n'))}
      />
    </Field>
  );
}

/**
 * A `Pos`, as two number boxes.
 *
 * Clearing BOTH removes the position entirely, which is how a rectangle becomes
 * a single cell (`to` gone) and how a spawn goes back to the schema's own
 * `{0, 0}` default instead of a written-out copy of it. Clearing ONE leaves the
 * other and reports `at.line: Required` — deliberately not snapped to zero,
 * because a silent zero moves an entity to the top of the buffer and looks like
 * the editor did it on purpose.
 */
export function PosField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: unknown;
  onChange: (value: Pos | undefined) => void;
  placeholder?: Pos | undefined;
  hint?: string | undefined;
}) {
  const pos = value !== null && typeof value === 'object' ? (value as { line?: unknown; col?: unknown }) : {};
  const emit = (axis: 'line' | 'col', next: number | undefined): void => {
    const merged: Record<string, unknown> = { line: pos.line, col: pos.col, [axis]: next };
    for (const key of ['line', 'col']) if (merged[key] === undefined) delete merged[key];
    onChange(Object.keys(merged).length === 0 ? undefined : (merged as unknown as Pos));
  };
  return (
    <div className="field pos">
      <span className="field-label" title={hint}>
        {label}
      </span>
      <input
        type="number"
        className="num"
        aria-label={`${label} line`}
        value={asText(pos.line)}
        placeholder={placeholder === undefined ? 'line' : String(placeholder.line)}
        onChange={(e) => emit('line', e.target.value === '' ? undefined : Number(e.target.value))}
      />
      <input
        type="number"
        className="num"
        aria-label={`${label} col`}
        value={asText(pos.col)}
        placeholder={placeholder === undefined ? 'col' : String(placeholder.col)}
        onChange={(e) => emit('col', e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </div>
  );
}
