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
 */

import type { Entity } from '@vimorror/game';
import { useReducer, useState } from 'react';

import { BufferPane } from './buffer-pane.tsx';
import { exportStage, parseDraft, readDraft, stageFileName } from './draft.ts';
import { FIXTURES } from './fixtures.ts';
import { HAS_FILE_PICKERS, openStageFile, saveStageFile } from './files.ts';
import { GridPane } from './grid-pane.tsx';
import { IssuesPane } from './issues-pane.tsx';
import { drawableEntities } from './stage-cells.ts';
import { initialState, reduce, textFromBuffer } from './store.ts';

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const { draft, selection } = state;
  const parse = parseDraft(draft);

  // `Array.isArray` because `readDraft` admits a file whose `entities` is not one;
  // `drawableEntities` because it also admits entities that are individually
  // unrenderable, and a throw in the grid takes the issues pane down with it.
  const entities: readonly Entity[] = drawableEntities(Array.isArray(draft.entities) ? draft.entities : []);
  const spawn = parse.ok ? parse.stage.cursor : draft.cursor;

  function load(text: string, from: string): void {
    setNotice(undefined);
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
          onChange={(text) => dispatch({ kind: 'buffer-typed', text })}
        />
        <GridPane
          lines={draft.buffer}
          entities={entities}
          spawn={spawn}
          selection={selection}
          onSelect={(id) => dispatch({ kind: 'entity-selected', id })}
        />
      </main>

      <footer>
        <IssuesPane issues={parse.ok ? undefined : parse.issues} />
        <div className="pane">
          <h2>selection</h2>
          <p className="note">
            {selection === undefined
              ? 'click an entity on the grid.'
              : describe(entities.find((e) => e.id === selection))}
          </p>
        </div>
      </footer>
    </div>
  );
}

function describe(entity: Entity | undefined): string {
  if (entity === undefined) return 'that entity is gone.';
  const to = entity.to === undefined ? '' : ` to ${entity.to.line}:${entity.to.col}`;
  return `${entity.kind} "${entity.id}" — ${entity.glyph} at ${entity.at.line}:${entity.at.col}${to}${
    entity.label === undefined ? '' : ` (${entity.label})`
  }`;
}
