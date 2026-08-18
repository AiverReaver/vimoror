/**
 * Stage files: one stage per file, opened and saved through the File System
 * Access API.
 *
 * Per-file pickers only. A directory handle would let the editor browse
 * `content/stages/` as a corpus, and that is a real convenience — but it is also
 * a whole second surface (listing, refresh, write-back, permission
 * re-prompting), and nothing in M3 needs it. Noted as a ceiling, not built.
 *
 * The two things here that are decisions rather than plumbing:
 *
 * - **The suggested filename is derived, never stored** — `draft.ts`'s
 *   `stageFileName`, so there is no second copy of the id to drift from the
 *   first. It lives there rather than here because it is a fact about the
 *   document, and because nothing in this file is reachable outside a browser:
 *   the picker detection below reads `window` at module load, which is why the
 *   FSA surface is verified in-browser and its one pure rule is not.
 * - **A cancelled picker is not an error.** Both pickers reject with
 *   `AbortError` when the author dismisses the dialog, which is the single most
 *   common outcome of clicking Open by accident. It comes back as `undefined`
 *   here so a caller never has to tell "the author changed their mind" apart
 *   from "the file was unreadable" by inspecting a DOMException name.
 */

import { readDraft, stageFileName, type StageDraft } from './draft.ts';

const STAGE_FILE_TYPES = [
  { description: 'vimorror stage', accept: { 'application/json': ['.json'] } },
] as const;

/**
 * Feature detection, not a browser sniff — Firefox and Safari ship neither
 * picker. Resolved once at module load because it cannot change afterwards, and
 * because it is read on every render to disable the buttons.
 */
export const HAS_FILE_PICKERS =
  typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';

export type OpenedStage = { readonly draft: StageDraft; readonly fileName: string };

/**
 * `undefined` means the author cancelled — or that this browser has no picker at
 * all, which the optional call collapses into the same answer rather than a
 * hand-written throw that `HAS_FILE_PICKERS` already prevents reaching.
 */
export async function openStageFile(): Promise<OpenedStage | undefined> {
  const handles = await window.showOpenFilePicker?.({ types: STAGE_FILE_TYPES }).catch(rethrowUnlessCancelled);
  const handle = handles?.[0];
  if (handle === undefined) return undefined;

  const text = await (await handle.getFile()).text();
  return { draft: readDraft(text), fileName: handle.name };
}

/** The name it was written under, or `undefined` if the author cancelled. */
export async function saveStageFile(draft: StageDraft, text: string): Promise<string | undefined> {
  const handle = await window
    .showSaveFilePicker?.({ types: STAGE_FILE_TYPES, suggestedName: stageFileName(draft) })
    .catch(rethrowUnlessCancelled);
  if (handle === undefined) return undefined;

  const stream = await handle.createWritable();
  await stream.write(text);
  await stream.close();
  return handle.name;
}

/**
 * `AbortError` is the only rejection that means "the author dismissed the
 * dialog". A `SecurityError` (no user gesture) or `NotAllowedError` (permission
 * refused) is a real failure the author needs told about, so only the one name
 * is swallowed.
 */
function rethrowUnlessCancelled(e: unknown): undefined {
  if (e instanceof DOMException && e.name === 'AbortError') return undefined;
  throw e;
}
