/**
 * The gestures every spec makes, and the two fixtures more than one of them needs.
 *
 * Small on purpose. The temptation in an E2E helper file is to grow page objects
 * until the specs read as a DSL and stop saying what the player did; each export
 * below is here because it has a reason beyond tidiness:
 *
 * - **`command`** is the diegetic front door, and it is a helper because
 *   `keyboard.type(':play')` followed by a *separate* `press('Enter')` is not a
 *   style choice. `<BS>` cannot edit core's command line and `keys` is matched
 *   exactly (`shell-commands.ts`), so the terminator has to arrive as its own
 *   `Enter` keydown — the same fact `docs/HANDOFF.md` records as a harness trap
 *   for the browser tool.
 * - **`play`** exists so a spec can say `ihello, ` + `<Esc>` in the game's own
 *   notation rather than in Playwright's. Nothing else translates keys: these
 *   are real `keydown`s on the body, which is what `keyTokenFor` sees and what
 *   the runner's document-level handler stands ready for.
 * - **`seedSave`** writes a valid envelope BEFORE the app boots, which is the
 *   only way to open a stage the unlock chain has behind two others without
 *   playing them first.
 * - **`storedSave`** reads the envelope back, so a spec can assert on what the
 *   game wrote rather than only on what it drew.
 * - **`uncaughtErrors`** is the automated form of the "zero console errors"
 *   check every wave of this milestone did by hand.
 */

import { expect, type Page } from '@playwright/test';

/** Keys with no single-character `event.key` — everything else types as itself. */
const NAMED: Readonly<Record<string, string>> = { '<Esc>': 'Escape', '<CR>': 'Enter' };

/**
 * Type a command at the game's own command line and resolve it.
 *
 * `text` includes the leading `:` — the prompt is core's `pending.keyBuffer` and
 * the colon is a keystroke like any other.
 */
export async function command(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  // Its own event, deliberately. See the file comment.
  await page.keyboard.press('Enter');
}

/**
 * Feed a stage the given keys, in `content/stages/` notation: literal
 * characters, plus `<Esc>` and `<CR>` for the two named keys any of these
 * routes needs.
 *
 * Split on the named tokens rather than tokenised properly — `tokenize` is
 * core's job and importing it here would put the engine's own notation parser
 * inside the test that is meant to be driving a browser.
 */
export async function play(page: Page, keys: string): Promise<void> {
  for (const part of keys.split(/(<Esc>|<CR>)/).filter((s) => s !== '')) {
    // `Object.hasOwn` rather than `in`, the rule `keyboard.ts` states: a route
    // spelling `constructor` would otherwise find an inherited function.
    const named = Object.hasOwn(NAMED, part) ? NAMED[part] : undefined;
    if (named !== undefined) await page.keyboard.press(named);
    else await page.keyboard.type(part);
  }
}

/**
 * Wait until the play surface is really live, then let the keyboard loose.
 *
 * **`0/9 keys` is not that gate**, which is the trap worth writing down: the
 * status line prints `{view?.keystrokes ?? 0}/{stage.par}` on the runner's very
 * first commit, *before* the session effect has run — so a spec that typed as
 * soon as it saw `0/9` could feed keys into `sessionRef.current === null` and
 * have them silently dropped. `post-fx` is set from `renderer.kind` inside the
 * async atlas continuation, which cannot happen before the session effect
 * declared above it, so waiting for it orders everything correctly. It is also
 * the only DOM evidence that `getFontAtlas` baked and `createRenderer` picked a
 * path at all; a headless Chromium may answer either and both are a working
 * game, but `…` means the canvas never came up.
 */
export async function stageReady(page: Page): Promise<void> {
  await expect(page.locator('.run-head')).toContainText(/post-fx (webgl2|fallback)/);
  // And the canvas was sized by the app rather than left at the browser's
  // default 300x150: the backing store comes from `cells.width * atlas.cellW`,
  // and the narrowest frame any stage can have is `MIN_COLS` (64) cells of
  // `CELL_W` (9) at scale 1. A 300 would mean the sizing lines never ran.
  const canvas = page.locator('.run .stage canvas');
  await expect(canvas).toBeVisible();
  expect(
    await canvas.evaluate((el) => (el as HTMLCanvasElement).width),
    'the canvas backing store was sized from the frame',
  ).toBeGreaterThanOrEqual(576);
}

/**
 * A stored save, written before the app's own scripts run.
 *
 * **`addInitScript` re-runs on EVERY navigation, this one included.** So a spec
 * that seeds and then reloads gets the hand-written fixture back and loses
 * whatever the app wrote in between — which would look exactly like a save that
 * failed to persist. Nothing seeds and reloads today; a spec that needs both
 * should write `localStorage` once with `page.evaluate` after the first load
 * instead.
 */
export async function seedSave(page: Page, save: unknown): Promise<void> {
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key as string, json as string),
    ['vimorror.save', JSON.stringify(save)],
  );
}

/**
 * The envelope as the app itself wrote it.
 *
 * **Not polled, and that is safe for a concrete reason rather than by luck.**
 * Every write goes through `app.tsx`'s `persist`, which is called synchronously
 * from the runner's keydown handler and from the session effect — both of which
 * complete before the React commit that paints the DOM the caller just waited
 * on. So "the screen says 5/9" implies "the save says 5/9", and there is no
 * window between them to poll for. If that ever stops being true the symptom is
 * a flake, so it is worth knowing that this is the reasoning.
 */
export async function storedSave(page: Page): Promise<{
  progress: Record<string, { completed: boolean; bestKeystrokes: number; cleanRun: boolean }>;
  current?: { snapshot: Record<string, unknown> };
}> {
  const raw = await page.evaluate(() => window.localStorage.getItem('vimorror.save'));
  expect(raw, 'the game wrote a save').not.toBeNull();
  return JSON.parse(raw as string);
}

/**
 * Uncaught page exceptions, collected from now on.
 *
 * **`pageerror` only, deliberately.** Console *errors* would also catch a
 * failed request — and Chromium logs one for the favicon this game does not
 * ship — so the assertion would be about noise rather than about the app. An
 * uncaught exception is unambiguous: the rAF draw loop throwing every frame, or
 * a renderer that died after its first pass, neither of which stops a session
 * from reaching an outcome and neither of which any DOM assertion would notice.
 */
export function uncaughtErrors(page: Page): string[] {
  const out: string[] = [];
  page.on('pageerror', (error) => out.push(error.message));
  return out;
}

/**
 * A save whose two act-1 stages are done, so `act1-word-power` is open.
 *
 * Deliberately a real `Save` shaped by hand rather than a fixture generated from
 * `save.ts`: if the envelope's shape drifts, `loadSave` orphans this payload and
 * the app lands on the CONTENT NOTE, which the seeded specs assert against
 * before they do anything else. A silent change of what they test is the one
 * failure mode a generated fixture would have hidden.
 *
 * `effectsIntensity: 0` and `audio.muted` are not caution, they are the two
 * settings a headless run has no use for: the CRT pass still runs every frame
 * (that is the point of a rAF loop), it just has nothing to modulate, and the
 * drone would never be unlocked by a gesture anyway.
 */
export const UNLOCKED_THROUGH_ACT1 = {
  schemaVersion: 1,
  settings: {
    difficulty: 'magic',
    comfort: { gentle: false, jumpScares: true },
    effectsIntensity: 0,
    audio: { muted: true, volume: 0.4 },
  },
  progress: {
    'act1-two-worlds': { completed: true, bestKeystrokes: 9, cleanRun: true },
    'act1-four-directions': { completed: true, bestKeystrokes: 2, cleanRun: true },
  },
} as const;
