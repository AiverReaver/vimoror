/**
 * The stage catalogue: `content/campaign.json`'s ordering zipped with the parsed
 * contents of `content/stages/*.json`.
 *
 * Two files rather than one, because the two halves answer to different owners.
 * A stage file is a stage; the ORDER stages are met in is curriculum, which is
 * why the manifest lives in `content/` beside them instead of being a constant
 * in this app — M5 and M6 author both, and neither should need a code change to
 * insert a stage.
 *
 * Everything enters through `parseStage`, from raw text, which is the same door
 * the editor's `fixtures.ts` uses and for the same reason: a second loading path
 * is a second thing to drift, and `validate-stages.ts` (the CI gate) reads these
 * files off disk through `safeParseStage` too. So a stage that fails CI cannot
 * silently load here, and a stage that loads here has passed the schema.
 *
 * **The manifest and the directory are checked against each other in both
 * directions**, by `campaign.test.ts` rather than at runtime: a manifest id with
 * no file (`missing`) and a stage file nobody listed (`unlisted`) are both
 * content mistakes, and the repo already guards two other pairs exactly this way
 * (`EDITS`/`FIELD_ORDER` in the editor, the comparator's registers). They are
 * exported rather than thrown on so that the failure mode in a browser is one
 * absent stage instead of a blank page — the test is what makes sure that never
 * ships.
 *
 * `import.meta.glob` is Vite's, and the triple-slash reference is what declares
 * it plus the `?raw` module. Scoped to this file, exactly as `fixtures.ts`
 * scopes its own, so `vite/client` never reaches the packages or the tools.
 */

/// <reference types="vite/client" />

import { parseStage, type Stage } from '@vimorror/game';

import MANIFEST_TEXT from '../../../content/campaign.json?raw';

/** Raw text keyed by path, e.g. `../../../content/stages/act1-two-worlds.json`. */
const RAW: Record<string, string> = import.meta.glob('../../../content/stages/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * The ids in curriculum order, as authored.
 *
 * Read off `stages` rather than a shape-validated object: this is committed
 * repo content behind a test, not a trust boundary, and the one failure a
 * hand-edit can produce — an id with no file — is exactly what `missing`
 * reports. `zod` arrives with Wave D's save, which IS a trust boundary.
 */
export const CAMPAIGN_IDS: readonly string[] = (JSON.parse(MANIFEST_TEXT) as { stages: string[] }).stages;

/** Every stage file, parsed, by id. Keyed by the stage's OWN id, not its filename
 * — `validate-stages.ts` is the gate that keeps those equal, so a mismatch is
 * reported there as a filename problem rather than silently resolving here. */
const BY_ID: ReadonlyMap<string, Stage> = new Map(
  Object.values(RAW).map((text) => {
    const stage = parseStage(JSON.parse(text));
    return [stage.id, stage] as const;
  }),
);

/** Manifest ids with no matching stage file. Empty, or the test fails. */
export const missing: readonly string[] = CAMPAIGN_IDS.filter((id) => !BY_ID.has(id));

/** Stage files the manifest never lists — authored but unreachable. Same. */
export const unlisted: readonly string[] = [...BY_ID.keys()].filter((id) => !CAMPAIGN_IDS.includes(id));

/** The campaign, in curriculum order. */
export const stages: readonly Stage[] = CAMPAIGN_IDS.map((id) => BY_ID.get(id)).filter(
  (stage): stage is Stage => stage !== undefined,
);

/** The stage after `id`, or `undefined` at the end of the campaign. */
export function stageAfter(id: string): Stage | undefined {
  const at = stages.findIndex((stage) => stage.id === id);
  return at < 0 ? undefined : stages[at + 1];
}
