/**
 * Layout and the file actions. Everything else lives in the panes.
 *
 * The draft is re-parsed on every render rather than cached. A stage is about a
 * kilobyte of JSON and `safeParseStage` is the only validation authority in the
 * app, so a cache here would exist purely to risk showing an author an issue list
 * for a draft they have already changed.
 *
 * The grid renders from the DRAFT's buffer and entities, never from the parsed
 * stage — a broken draft must keep drawing, or the author loses the picture at
 * the exact moment the issues pane starts talking about it. Only the spawn
 * prefers the parse, because that is where `cursor`'s default is resolved and the
 * editor must not carry a second copy of it.
 *
 * **Wave D adds one exception, and it is the whole of "playtest in place":** while
 * a session is live the grid draws the SESSION's buffer, cursor, mode and live
 * entity positions instead. Same canvas, same skin, same geometry — the author
 * plays the stage on the surface they authored it on, and there is no second
 * preview to drift from this one.
 *
 * **The compile-time guard below is Wave C's done-line.** "Every field
 * `schema.ts` accepts is reachable from the UI" is not a property a test can
 * assert — a panel is not introspectable — so it is spelt as an exhaustiveness
 * check over the four panes' own `EDITS` lists. Add a field to `stageShape` and
 * this file stops compiling until a pane claims it; `draft.ts`'s `FIELD_ORDER`
 * guard covers the other half, that the field also gets EXPORTED. Between them, a
 * new schema field cannot be silently unauthorable or silently dropped.
 */

import type { Entity } from '@vimorror/game';
import { useReducer, useState } from 'react';

import { BufferPane, EDITS as BUFFER_EDITS } from './buffer-pane.tsx';
import { ConditionsPanel, EDITS as CONDITION_EDITS } from './conditions-panel.tsx';
import { exportStage, listOf, parseDraft, readDraft, stageFileName, type DraftEntity, type StageDraft } from './draft.ts';
import { EntitiesPanel, EDITS as ENTITY_EDITS } from './entities-panel.tsx';
import { FIXTURES } from './fixtures.ts';
import { HAS_FILE_PICKERS, openStageFile, saveStageFile } from './files.ts';
import { GridPane } from './grid-pane.tsx';
import { IssuesPane } from './issues-pane.tsx';
import { MetadataPanel, EDITS as METADATA_EDITS } from './metadata-panel.tsx';
import { PlayPane, type PlayView } from './play-pane.tsx';
import { drawableEntities } from './stage-cells.ts';
import { initialState, reduce, textFromBuffer } from './store.ts';

type AuthoredField =
  | (typeof BUFFER_EDITS)[number]
  | (typeof METADATA_EDITS)[number]
  | (typeof ENTITY_EDITS)[number]
  | (typeof CONDITION_EDITS)[number];

const _everyFieldIsAuthorable: Exclude<keyof StageDraft, AuthoredField> extends never ? true : never = true;

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  /**
   * The live playtest, or `undefined` while editing. Not in the reducer: the
   * `GameSession` behind it is mutable and un-serialisable, so `store.ts` could
   * not stay pure — and a `mode` field alongside a session held elsewhere would
   * be two sources of truth for one fact. The presence of this view IS the mode.
   */
  const [play, setPlay] = useState<PlayView | undefined>(undefined);

  const { draft, selection, tool } = state;
  const parse = parseDraft(draft);

  // `listOf` because `readDraft` admits a file whose `entities` is not an array;
  // `drawableEntities` because it also admits entities that are individually
  // unrenderable, and a throw in the grid takes the issues pane down with it.
  const entities: readonly Entity[] = drawableEntities(listOf<DraftEntity>(draft.entities) as readonly Entity[]);
  const spawn = parse.ok ? parse.stage.cursor : draft.cursor;

  function load(text: string, from: string): void {
    setNotice(undefined);
    // A live session belongs to the stage that is closing. Left standing, the
    // grid would keep drawing the old play over the new stage's draft.
    setPlay(undefined);
    try {
      dispatch({ kind: 'draft-opened', draft: readDraft(text) });
      setNotice(`opened ${from}`);
    } catch (e) {
      setNotice(`${from}: ${(e as Error).message}`);
    }
  }

  async function open(): Promise<void> {
    // Cleared BEFORE awaiting: a dismissed picker returns `undefined` and writes
    // no notice, so a stale "saved <name>" would otherwise keep asserting a save
    // that no longer describes the file on disk.
    setNotice(undefined);
    setPlay(undefined);
    try {
      const opened = await openStageFile();
      if (opened === undefined) return;
      dispatch({ kind: 'draft-opened', draft: opened.draft });
      setNotice(`opened ${opened.fileName}`);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function save(): Promise<void> {
    setNotice(undefined);
    try {
      const name = await saveStageFile(draft, exportStage(draft));
      if (name !== undefined) setNotice(`saved ${name}`);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>vimorror stage editor</h1>
        <select
          value=""
          aria-label="open a committed stage"
          onChange={(event) => {
            const fixture = FIXTURES.find((f) => f.name === event.target.value);
            if (fixture !== undefined) load(fixture.text, fixture.name);
          }}
        >
          <option value="">open from content/stages…</option>
          {FIXTURES.map((fixture) => (
            <option key={fixture.name} value={fixture.name}>
              {fixture.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void open()} disabled={!HAS_FILE_PICKERS}>
          open file…
        </button>
        <button type="button" onClick={() => void save()} disabled={!HAS_FILE_PICKERS}>
          save as {stageFileName(draft)}
        </button>
        {HAS_FILE_PICKERS ? null : (
          <span className="note">this browser has no File System Access pickers</span>
        )}
        {notice === undefined ? null : <span className="note">{notice}</span>}
      </header>

      <main>
        <BufferPane
          text={textFromBuffer(draft.buffer)}
          readOnly={play !== undefined}
          onChange={(text) => dispatch({ kind: 'buffer-typed', text })}
        />
        {/* One grid, two sources: the draft while editing, the live session while
            a playtest runs. That is what "playtest in place" means literally —
            the author watches the stage they are authoring, on the surface they
            authored it on, with no second canvas to drift. Painting is disarmed
            with the same switch, since an entity added mid-play would go into the
            draft while the grid was drawing the session's own array. */}
        <GridPane
          lines={play?.lines ?? draft.buffer}
          entities={play?.entities ?? entities}
          spawn={play?.cursor ?? spawn}
          mode={play?.mode}
          selection={selection}
          onSelect={(id) => dispatch({ kind: 'entity-selected', id })}
          tool={play === undefined ? tool : undefined}
          onPaint={(from, to) => dispatch({ kind: 'entity-painted', from, to })}
        />
      </main>

      <section className="panels">
        <MetadataPanel draft={draft} dispatch={dispatch} />
        <EntitiesPanel draft={draft} selection={selection} tool={tool} dispatch={dispatch} />
        <ConditionsPanel draft={draft} dispatch={dispatch} />
        <PlayPane draft={draft} parse={parse} view={play} onView={setPlay} dispatch={dispatch} />
      </section>

      <footer>
        <IssuesPane issues={parse.ok ? undefined : parse.issues} />
      </footer>
    </div>
  );
}
