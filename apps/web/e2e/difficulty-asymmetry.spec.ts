/**
 * Spec 2 — the difficulty asymmetry, which is `MergedPlan.md`'s own named test.
 *
 * The claim under test is the whole reason difficulty is modifier config rather
 * than a second engine: **the same keystrokes, on the same stage, lose at one
 * setting and win at another** — and nothing about the engine changed between
 * the two runs. `enforceBudget` is live on `nomagic` alone, so
 * `act1-word-power`'s authored `keystrokes-over: 20` is a real lose condition
 * there and is filtered out of the list before play everywhere else.
 *
 * The route is a character crawl — `jj` then `l` forty-three times — because it
 * has to be a route a player would actually reach for before they know `f` and
 * `;`, which is what the stage teaches. Measured against the game layer: it is
 * decided at keystroke **21** on `nomagic` (`keystrokes-over`) and reaches the
 * third door at **45** on `verymagic`. All forty-five keys are typed in both
 * runs; the losing one simply stops mattering at 21, because a decided session
 * ignores every further key. That is what makes them the *identical* keys rather
 * than two routes chosen to suit their outcomes.
 *
 * Two things this spec does NOT do, both deliberate:
 *
 * - **It does not play stages one and two to get here.** The unlock chain is
 *   linear and already has its own spec (spec 1 asserts both sides of it) plus a
 *   unit suite; replaying it would add two stages of keystrokes to prove
 *   something twice. The save is seeded instead — and a seeded envelope the
 *   codec cannot read lands on the content note, which is what the `beforeEach`
 *   assertion below would catch.
 * - **It does not touch the settings screen.** Difficulty is typed at the title,
 *   at a real engine's command line, because "diegetic" is half of what is being
 *   verified. The radio buttons reach the same state and have their own unit test.
 *
 * One ceiling worth stating rather than discovering: the two `.run-head`
 * assertions cannot distinguish the runner's `difficulty` PROP from
 * `session.difficulty`, because on a fresh session those agree by construction.
 * The case where they differ is a resumed run, and that is spec 3's job.
 */

import { expect, test } from '@playwright/test';

import { command, play, seedSave, stageReady, storedSave, uncaughtErrors, UNLOCKED_THROUGH_ACT1 } from './shell.ts';

/** `jj` to the third line, then one column at a time. 45 keys. */
const CRAWL = 'jj' + 'l'.repeat(43);

test.beforeEach(async ({ page }) => {
  await seedSave(page, UNLOCKED_THROUGH_ACT1);
  await page.goto('/');
  // A save the codec could read, so no content note — and act 1 is open.
  await expect(page.getByText('press : to open the command line')).toBeVisible();
});

test('the crawl loses on :set nomagic and the identical keys win on :set verymagic', async ({ page }) => {
  const errors = uncaughtErrors(page);

  // `:settings` first — the third verb, and the third and last place the
  // resources link has to be reachable from. The radios and the command line
  // reach the same state, so the seeded `magic` is what this screen must show,
  // marked by a glyph and a word rather than by a tint.
  await command(page, ':settings');
  await expect(page.getByRole('heading', { name: 'settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'findahelpline.com' })).toHaveAttribute(
    'href',
    'https://findahelpline.com',
  );
  await expect(page.getByRole('group', { name: 'difficulty' })).toContainText('> :set magic current');
  await page.getByRole('button', { name: 'back' }).click();
  await expect(page.getByText('press : to open the command line')).toBeVisible();

  // ---- the hard reading of the same stage ----
  await command(page, ':set nomagic');
  // The title footer is the acknowledgement that the command was consumed;
  // core's own `:set` reports nothing for an option it does not know.
  await expect(page.locator('.status', { hasText: 'difficulty' })).toContainText(':set nomagic');

  await command(page, ':stages');
  await expect(page.getByRole('heading', { name: 'stages' })).toBeVisible();
  const wordPower = page.getByRole('button', { name: 'Word Power' });
  await expect(wordPower).toBeEnabled();
  await wordPower.click();

  await expect(page.locator('.run-head')).toContainText(':set nomagic');
  // `hints: 'none'` — the button is not disabled here, it does not exist.
  await expect(page.getByRole('button', { name: 'hint' })).toHaveCount(0);
  await stageReady(page);

  await play(page, CRAWL);

  const lost = page.locator('.outcome');
  await expect(lost).toContainText('[-] it ended here');
  // `lossLine` is a lookup over the condition that actually fired, so this is
  // the budget speaking. (`act1-word-power` authors no other lose condition, so
  // what this pins is the copy and the `max`, not a choice between two.)
  await expect(lost).toContainText('More than 20 keys.');
  // Decided at 21 and frozen there, with twenty-four keys still typed after it.
  await expect(page.locator('.status')).toContainText('· 21/8 keys');

  // A decided run is not a play in flight, whichever way it was decided — the
  // only loss in the suite, so the only place this half of `onOutcome` is seen.
  const afterLoss = await storedSave(page);
  expect(afterLoss.current, 'a lost run is not offered back as a resume').toBeUndefined();
  expect(afterLoss.progress['act1-word-power'], 'losing records nothing').toBeUndefined();

  await lost.getByRole('button', { name: 'leave' }).click();
  // The same thing the storage assertion said, said on screen: no resume banner.
  await expect(page.getByText('is where you left it')).toHaveCount(0);
  await page.getByRole('button', { name: 'back to title' }).click();

  // ---- the same keys, the easy reading ----
  await expect(page.getByText('press : to open the command line')).toBeVisible();
  await command(page, ':set verymagic');
  await expect(page.locator('.status', { hasText: 'difficulty' })).toContainText(':set verymagic');

  await command(page, ':stages');
  await page.getByRole('button', { name: 'Word Power' }).click();

  await expect(page.locator('.run-head')).toContainText(':set verymagic');
  // `hints: 'always'` — on screen from the first frame, and the button says so
  // rather than offering a purchase the player has already made.
  await expect(page.getByRole('button', { name: 'hint is always on' })).toBeDisabled();
  await expect(page.locator('.hint')).toContainText('next:');
  await stageReady(page);

  await play(page, CRAWL);

  const won = page.locator('.outcome');
  await expect(won).toContainText('[+] you are through');
  await expect(won).toContainText('45 keys, par 8 — 37 over');
  // Not clean — and the counts say why it is not, which is the whole point:
  // nothing was undone and no hint was ASKED for. A hint on screen is a hint
  // used, which is `scoring.ts`'s rule and not the runner's.
  await expect(won).toContainText('[ ] assisted (0 undo, 0 hint)');

  expect(errors, 'nothing threw').toEqual([]);
});
