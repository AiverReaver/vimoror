/**
 * Spec 3 — the save survives a reload, and the note does not come back.
 *
 * Five claims, and three of them could not be checked at the unit layer at all:
 *
 * 1. **The content note is first-launch only, and LEAVING it is what writes the
 *    first save.** Both halves are asserted, because they fail differently: a
 *    save written on mount means the note never returns for a player who read it
 *    and closed the tab, and no save at all means it returns forever. Only a real
 *    page load can tell those apart, which is why `app.tsx`'s `pastNote` gate was
 *    measured rather than reasoned at Wave D.
 * 2. **`:play` resumes the stage in flight**, which is where `:play` and
 *    `:stages` finally diverge — and it resumes the right one, checked on a stage
 *    that is not the first in the campaign.
 * 3. **A resumed run enforces the difficulty it was PLAYED at.**
 *    `GameSession.restore` takes difficulty from the snapshot by design, so
 *    `:set nomagic` at the title between the reload and the resume must not
 *    change the run that comes back. This is the only place in the suite where
 *    the runner's prop and `session.difficulty` disagree, so it is the only place
 *    that can tell which one the header reads.
 * 4. **A re-snapshot equals the stored snapshot** — the codec, plus `restore()`,
 *    plus a browser's `localStorage`, which is the only place those three meet.
 * 5. **`current` is cleared as an outcome latches**, so a finished stage is never
 *    offered back as "resume", and the progress it earned persists instead.
 *
 * **The buffer is asserted by finishing the stage, not by reading the canvas.**
 * `act1-two-worlds` wins on `buffer-equals ["hello, world"]`, and the six keys
 * typed after the reload only produce that line if `helworld` came back — so the
 * win overlay IS the buffer assertion, and a stronger one than any pixel read.
 * `ihel<Esc>` is 5 of the 9 keys and `alo, <Esc>` is the other 6, which is why
 * the finish lands 2 over par rather than at it: the detour through the save
 * costs two keystrokes, exactly as it would for a player who stopped there.
 */

import { expect, test } from '@playwright/test';

import { command, play, stageReady, storedSave, uncaughtErrors } from './shell.ts';

test('a mid-stage reload resumes, and the content note stays gone', async ({ page }) => {
  const errors = uncaughtErrors(page);
  await page.goto('/');

  // Claim 1, first half: mounting on the note writes NOTHING, so a player who
  // reads it and closes the tab is met by it again.
  await expect(page.getByRole('heading', { name: 'before you start' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'before you start' })).toBeVisible();

  await page.getByRole('button', { name: 'continue' }).click();
  await expect(page.getByText('press : to open the command line')).toBeVisible();

  await command(page, ':play');
  await page.getByRole('button', { name: 'Two Worlds' }).click();
  await stageReady(page);
  await expect(page.locator('.status')).toContainText('· 0/9 keys');

  // Five of the nine keys, and a completed insert — so the buffer is edited and
  // the engine is back in normal mode.
  await play(page, 'ihel<Esc>');
  await expect(page.locator('.status')).toContainText('· 5/9 keys');
  const before = await storedSave(page);
  expect(before.current?.snapshot, 'a stage in flight is stored').toBeDefined();

  /**
   * **The stored snapshot is poisoned before the reload, and that is what makes
   * the equality assertion below an assertion rather than a tautology.**
   *
   * Measured, not reasoned: with a plain read → reload → read, deleting the
   * runner's session-start `onSnapshot(session.snapshot())` left the pre-reload
   * bytes sitting untouched in `localStorage`, and the comparison passed against
   * itself. That mutation was the one survivor of Wave E's mutation pass.
   *
   * This field survives `loadSave` because `snapshotSchema` is `.passthrough()`
   * — the same property `save.test.ts` pins directly — reaches
   * `GameSession.restore`, which has never heard of it, and cannot appear in what
   * `session.snapshot()` builds. So it is still there afterwards if and only if
   * nothing re-wrote the save.
   */
  await page.evaluate(() => {
    const save = JSON.parse(window.localStorage.getItem('vimorror.save') as string);
    save.current.snapshot.notWrittenByTheGame = true;
    window.localStorage.setItem('vimorror.save', JSON.stringify(save));
  });

  // ---- the reload ----
  await page.reload();

  // Claim 1, second half: the note is gone for good, and the title is the
  // landing screen.
  await expect(page.getByText('press : to open the command line')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'before you start' })).toHaveCount(0);

  // Claim 3: the player changes their mind at the title, and the run in flight
  // does not care. `:set nomagic` takes hold for the NEXT fresh session.
  await command(page, ':set nomagic');
  await expect(page.locator('.status', { hasText: 'difficulty' })).toContainText(':set nomagic');

  // Claim 2: `:play` goes straight back into the stage, not to the list.
  await command(page, ':play');
  await expect(page.locator('.run-head')).toContainText('Two Worlds');
  // Claim 3 again, and this is the assertion that reads `session.difficulty`
  // rather than the prop: the prop says `nomagic` here.
  await expect(page.locator('.run-head')).toContainText(':set magic');
  // Which is enforced and not merely printed: `magic` still offers a hint on
  // request, and `nomagic` would offer none at all.
  await expect(page.getByRole('button', { name: 'hint', exact: true })).toBeEnabled();
  await stageReady(page);
  await expect(page.locator('.status')).toContainText('· 5/9 keys');
  await expect(page.locator('.bad')).toHaveCount(0);
  // A resume that could not be honoured is reported rather than hidden, so its
  // absence is worth asserting: this one WAS honoured.
  await expect(page.getByText('the saved run could not be resumed')).toHaveCount(0);

  // Claim 4: what the restored session snapshots equals what was stored — and
  // the poisoned field is gone, which is what proves it was really re-written.
  const after = await storedSave(page);
  expect(after.current?.snapshot).toEqual(before.current?.snapshot);

  // The buffer came back, proved by the only thing that can prove it.
  await play(page, 'alo, <Esc>');
  const outcome = page.locator('.outcome');
  await expect(outcome).toContainText('[+] you are through');
  await expect(outcome).toContainText('11 keys, par 9 — 2 over');
  await expect(outcome).toContainText('[*] clean run');

  // Claim 5.
  const finished = await storedSave(page);
  expect(finished.current).toBeUndefined();
  expect(finished.progress['act1-two-worlds']).toEqual({
    completed: true,
    bestKeystrokes: 11,
    cleanRun: true,
  });

  expect(errors, 'nothing threw').toEqual([]);
});

/**
 * The same round trip on a stage that is NOT the first in the campaign, which is
 * what makes the stage-id half of the resume real: `:play` looks the snapshot's
 * `stageId` up in the manifest and the runner consumes its seed only when the id
 * matches, and neither of those can be seen while the answer is `stages[0]`.
 *
 * It also carries the one score sign the other specs cannot reach.
 * `act1-four-directions` is winnable in two keys against a par of three, so this
 * is the suite's only `under` — and `G` then `$` splits cleanly across a reload,
 * one key on each side of it.
 */
test('the resume finds the right stage, not merely the first one', async ({ page }) => {
  const errors = uncaughtErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'continue' }).click();

  // Open the second stage the honest way — the first one has to fall first.
  await command(page, ':play');
  await page.getByRole('button', { name: 'Two Worlds' }).click();
  await stageReady(page);
  await play(page, 'ihello, <Esc>');
  await expect(page.locator('.outcome')).toContainText('[+] you are through');
  await page.locator('.outcome').getByRole('button', { name: 'next stage' }).click();
  /**
   * The keyboard comes straight back to the stage — and this is a SINGLE-SHOT
   * read, not `toBeFocused()`, which is the whole point. This overlay unmounts on
   * a later commit, at which time focus falls back to the body on its own; an
   * auto-retrying matcher simply waits that out and passes either way (measured
   * — the mutation survived it). One `evaluate` immediately after the click sees
   * the state the next keystroke would actually meet.
   */
  expect(
    await page.evaluate(() => document.activeElement === document.body),
    'the overlay hands the keyboard back on the click, not a commit later',
  ).toBe(true);

  // `stageReady` is NOT the gate for a stage-to-stage transition: `post-fx` is
  // already resolved from the run before it, because the renderer effect depends
  // only on the atlas scale. The status line is — it still reads the previous
  // stage's tally until the session effect replaces the view, so `0/3` is proof
  // that the new session exists and can take a key.
  await expect(page.locator('.run-head')).toContainText('Four Directions');
  await expect(page.locator('.status')).toContainText('· 0/3 keys');
  await play(page, 'G');
  await expect(page.locator('.status')).toContainText('· 1/3 keys');

  await page.reload();
  await expect(page.getByText('press : to open the command line')).toBeVisible();
  await command(page, ':play');

  // The stage in flight, not the first one in the list and not the list itself.
  await expect(page.locator('.run-head')).toContainText('Four Directions');
  await stageReady(page);
  await expect(page.locator('.status')).toContainText('· 1/3 keys');

  await play(page, '$');
  const outcome = page.locator('.outcome');
  await expect(outcome).toContainText('[+] you are through');
  await expect(outcome).toContainText('2 keys, par 3 — 1 under');
  await expect(outcome).toContainText('[*] clean run');

  // Two wins open exactly one more room, and the lock survived a reload —
  // `unlockedIds` is recomputed from the stored `progress` on every load, so
  // this is the only place that is checked across one.
  await outcome.getByRole('button', { name: 'leave' }).click();
  await expect(page.getByRole('button', { name: 'Word Power' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Grammar Awakens' })).toBeDisabled();

  expect(errors, 'nothing threw').toEqual([]);
});
