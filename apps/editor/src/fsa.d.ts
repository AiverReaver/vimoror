/**
 * The two File System Access entry points, which are WICG rather than WHATWG and
 * so are absent from `lib.dom`.
 *
 * This is deliberately the *smallest* declaration that compiles, not a copy of
 * the spec: `FileSystemHandle`, `FileSystemFileHandle` and
 * `FileSystemWritableFileStream` are all in `lib.dom` already (measured against
 * the shipped `typescript@5.7` — only the two pickers and their option bag are
 * missing), so nothing here redeclares them. A `@types` package for six lines
 * would be a dependency to keep current for no gain, and a wider hand-rolled
 * copy would be six more things able to drift from the real API.
 *
 * Both are `optional` on `Window` because a browser without the API simply does
 * not have them, and `files.ts` checks before calling — a non-optional
 * declaration would type a feature detection as always-true.
 */

type FsaPickerAccept = { readonly description?: string; readonly accept: Record<string, readonly string[]> };

type FsaOpenOptions = { readonly types?: readonly FsaPickerAccept[] };

type FsaSaveOptions = { readonly types?: readonly FsaPickerAccept[]; readonly suggestedName?: string };

interface Window {
  showOpenFilePicker?(options?: FsaOpenOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: FsaSaveOptions): Promise<FileSystemFileHandle>;
}
