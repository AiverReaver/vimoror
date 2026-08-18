/**
 * The committed corpus, bundled.
 *
 * This exists because the File System Access pickers open a NATIVE dialog:
 * nothing in the browser can drive one, so an editor whose only way in is
 * `showOpenFilePicker` cannot be verified end to end, by a person or otherwise.
 * A bundled list of what is already in `content/stages/` gives the wave's
 * done-line ("open a fixture, see it render") a route that does not depend on a
 * dialog — and it is what an author actually reaches for anyway, since a new
 * stage usually starts from the last one.
 *
 * It is deliberately **raw text**, not parsed JSON, so a bundled fixture enters
 * through `readDraft` — the same door a picked file uses. A second loading path
 * would be a second thing to drift, and this way the door is exercised on every
 * page load instead of only when someone clicks Open.
 *
 * `import.meta.glob` is Vite's, and this is the only file that uses it. The
 * triple-slash reference below is what declares it: an explicit reference is
 * honoured whatever `compilerOptions.types` says, which keeps the type widening
 * scoped to this file instead of adding `vite/client` to every package and tool
 * in the repo — and keeps M3-PLAN.md's five-root-edit ledger true.
 */

/// <reference types="vite/client" />

const RAW: Record<string, string> = import.meta.glob('../../../content/stages/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export type Fixture = { readonly name: string; readonly text: string };

export const FIXTURES: readonly Fixture[] = Object.entries(RAW)
  .map(([path, text]) => ({ name: path.slice(path.lastIndexOf('/') + 1), text }))
  .sort((a, b) => a.name.localeCompare(b.name));
