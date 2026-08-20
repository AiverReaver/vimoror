/**
 * Spec 1 — a fresh profile, from the content note to a first win.
 *
 * This is the flow the plan's done-line describes in words ("a fresh profile
 * walks note → title → `:play` → select → stage → win entirely without code")
 * and every wave since C has re-clicked by hand. Nothing here reaches into the
 * app: the note is dismissed by its button, the front door is typed at a real
 * `VimEngine`'s command line, and the stage is won with the nine keystrokes its
 * own `solution` field records.
 *
 * Three assertions earn their place beyond "the flow works":
 *
 * - **The resources link is checked by `href`, not by its text.** It is a
 *   helpline. A link that reads `findahelpline.com` and points somewhere else is
 *   the one broken thing on this screen that matters, and an accessible-name
 *   assertion cannot see it.
 * - **The comfort controls are OPERATED, not merely counted.** Turning Gentle
 *   Mode on must disable the jump-scare switch, which is `allowsBeat`'s rule
 *   (`startling` needs `jumpScares && !gentle`) made visible. A screen whose
 *   checkboxes render and write nothing would otherwise pass.
 * - **No uncaught exception, and no `.bad`.** `.bad` is where the atlas error
 *   and the engine-throw freeze would print, and `pageerror` catches a draw loop
 *   that throws every frame. Neither stops a session from reaching an outcome —
 *   without them a dead canvas still shows a win. (The one thing left unpinned
 *   is what the canvas actually *shows*: `stageReady` proves it was sized and
 *   the renderer picked a path, and the win condition proves the engine's buffer
 *   is right, but nothing here reads a pixel. A WebGL2 backing store is not
 *   readable after the frame without `preserveDrawingBuffer`, so that stays an
 *   in-browser check, as it has been at every wave.)
 *
 * The last two tests are the same first-run walk under the two machine facts the
 * shell reads once at startup and can never re-read: `prefers-reduced-motion`,
 * which picks the effects default, and `devicePixelRatio`, which picks the atlas
 * scale. Both are page-load properties, so both are their own page load.
 */

import { expect, test } from '@playwright/test';

import { command, play, stageReady, uncaughtErrors } from './shell.ts';

test('a fresh profile walks the content note to a first win', async ({ page }) => {
  const errors = uncaughtErrors(page);
  await page.goto('/');

  // The content note, on first launch and only then.
  await expect(page.getByRole('heading', { name: 'before you start' })).toBeVisible();
  await expect(page.getByText('no depictions of self-harm or suicide')).toBeVisible();
  const resources = page.getByRole('link', { name: 'findahelpline.com' });
  await expect(resources).toHaveAttribute('href', 'https://findahelpline.com');

  // Comfort is SURFACED here, not merely findable — the same `ComfortControls`
  // the settings screen renders, on the screen that explains why they exist.
  const comfort = page.getByRole('group', { name: 'comfort' });
  const gentle = comfort.getByRole('checkbox').first();
  const jumpScares = comfort.getByRole('checkbox').last();
  await expect(comfort.getByText('Gentle Mode')).toBeVisible();
  await expect(comfort.getByText('Jump scares')).toBeVisible();
  // Never colour alone: real form controls, and a slider whose value is printed
  // beside it rather than left to the thumb's position.
  await expect(comfort.getByRole('slider')).toHaveCount(1);
  await expect(comfort).toContainText('Effects intensity 0.60');

  // They really write: Gentle Mode takes the jump-scare switch out of play,
  // which is `allowsBeat`'s own rule and not a second policy.
  await expect(jumpScares).toBeEnabled();
  await gentle.check();
  await expect(jumpScares).toBeDisabled();
  await expect(comfort).toContainText('Gentle Mode already has them off.');
  await gentle.uncheck();
  await expect(jumpScares).toBeEnabled();

  await page.getByRole('button', { name: 'continue' }).click();

  // The title: a real buffer with a real command line, and the resources link
  // still there — permanently, which is the half of "skippable" that matters.
  await expect(page.getByText('press : to open the command line')).toBeVisible();
  await expect(page.getByRole('link', { name: 'findahelpline.com' })).toBeVisible();

  // `:play` with nothing in flight falls through to the list.
  await command(page, ':play');
  await expect(page.getByRole('heading', { name: 'stages' })).toBeVisible();

  // The unlock chain, from the other side: the first stage and no more. Both
  // sides matter — a policy that opened n+1 alongside n would pass the post-win
  // check below on its own.
  await expect(page.getByRole('button', { name: 'Two Worlds' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Four Directions' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Word Power' })).toBeDisabled();

  await page.getByRole('button', { name: 'Two Worlds' }).click();

  const head = page.locator('.run-head');
  await expect(head).toContainText('Two Worlds');
  // Normal is the default difficulty, and the header reads it off the session.
  await expect(head).toContainText(':set magic');
  await stageReady(page);
  await expect(page.locator('.status')).toContainText('· 0/9 keys');

  // `act1-two-worlds`'s own solution, key for key.
  await play(page, 'ihello, <Esc>');

  const outcome = page.locator('.outcome');
  await expect(outcome).toContainText('[+] you are through');
  // Anchored through the separator, so a stray digit cannot satisfy it.
  await expect(outcome).toContainText('9 keys, par 9 — exactly par');
  await expect(outcome).toContainText('[*] clean run');
  await expect(page.locator('.bad')).toHaveCount(0);

  // The win is recorded and the next room is open — the projection of
  // `progress` that the select screen owns. Scoped to the overlay, because
  // `leave stage` is a second button whose name contains this one's.
  await outcome.getByRole('button', { name: 'leave' }).click();
  await expect(page.getByRole('heading', { name: 'stages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Two Worlds' })).toContainText('[*]');
  await expect(page.getByRole('button', { name: 'Four Directions' })).toBeEnabled();
  // And no further: one win opens exactly one room.
  await expect(page.getByRole('button', { name: 'Word Power' })).toBeDisabled();

  expect(errors, 'nothing threw').toEqual([]);
});

test.describe('with prefers-reduced-motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the effects default is 0, and it is still a slider the player owns', async ({ page }) => {
    await page.goto('/');

    const comfort = page.getByRole('group', { name: 'comfort' });
    // The one default in this file that is NOT a judgment call: a profile that
    // asked for less motion gets none until it asks otherwise.
    await expect(comfort).toContainText('Effects intensity 0.00');
    // Offered, not imposed — the slider is live and the label never claims to be
    // a safety guarantee.
    await expect(comfort.getByRole('slider')).toBeEnabled();
    await expect(comfort).not.toContainText('epilepsy');
  });
});

test.describe('on a 2x display', () => {
  // The top-level option, not `contextOptions`: `devices['Desktop Chrome']`
  // sets `deviceScaleFactor: 1` as a top-level `use` value, and those win over
  // anything inside `contextOptions` (measured — the atlas stayed at scale 1).
  test.use({ deviceScaleFactor: 2 });

  test('the scale reaches the atlas: backing store doubles, the layout does not', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'continue' }).click();
    await expect(page.getByText('press : to open the command line')).toBeVisible();
    await command(page, ':play');
    await page.getByRole('button', { name: 'Two Worlds' }).click();
    await stageReady(page);

    /**
     * **The one automated gate on M4-PLAN.md's biggest measured correction.**
     * Fact 4 originally prescribed sizing the canvas at `cells × cellSize × dpr`
     * and calling `renderer.resize()`; Wave B measured that this draws a 1x frame
     * into a 2x buffer, because `GlyphGrid.#drawCell` blits at `atlas.cellW` and
     * nothing else. The scale has to reach the ATLAS — `getFontAtlas(scale)`,
     * memoised per integer scale — so the backing store is `cells × atlas.cellW`
     * while the CSS box stays `cells × CELL_W`. That is exactly the pair of
     * numbers below, and the ratio between them IS the correction. Nothing else
     * in the repo checks it: every unit suite runs in node, and the whole rest of
     * this suite runs at `deviceScaleFactor: 1`, where the two are equal and the
     * bug is invisible.
     */
    const box = await page.locator('.run .stage canvas').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: parseFloat(canvas.style.width),
        cssHeight: parseFloat(canvas.style.height),
      };
    });
    expect(box.width).toBe(box.cssWidth * 2);
    expect(box.height).toBe(box.cssHeight * 2);
    // And the layout is unchanged: a 2x display shows the same stage, sharper.
    expect(box.cssWidth).toBe(64 * 9);

    // Still playable, which is the half a geometry assertion cannot see.
    await play(page, 'ihello, <Esc>');
    await expect(page.locator('.outcome')).toContainText('[+] you are through');
  });
});
