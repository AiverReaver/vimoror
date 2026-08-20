/**
 * Playwright — the one automated gate the shell was missing.
 *
 * Every other layer of this repo is checked by something that runs without a
 * human: `vim-core` against 1159 committed goldens, `game` against
 * `validate:stages`, the pure halves of `render` and `apps/web` under vitest.
 * The shell's flows were the exception — note → title → `:play` → select →
 * stage → win was re-clicked by hand at every wave, and "the identical keys
 * lose on `nomagic` and win on `verymagic`" was measured three times by three
 * different means. These specs are that re-clicking, written down.
 *
 * Four decisions:
 *
 * - **Chromium only.** `MergedPlan.md`'s verification table names one browser,
 *   the game is a canvas plus some chrome, and a cross-browser matrix would
 *   triple a CI job to re-prove the same session logic. Firefox and WebKit are
 *   worth adding the first time something in `apps/web` depends on a browser
 *   difference; nothing does today.
 * - **`webServer` runs `pnpm dev`.** So `pnpm test:e2e` is one command from a
 *   cold checkout, locally and in CI, and there is no second way to start the
 *   game that could drift from the one the launch entry uses.
 *   `reuseExistingServer` locally, because a dev server is usually already up
 *   when these are being written.
 * - **No retries.** A spec that passes on the second run is a spec that found
 *   something; retries would hide exactly the timing bug an E2E suite over a
 *   rAF loop and a real keyboard exists to catch. Every wait in these specs is
 *   an `expect` on the DOM, never a sleep.
 * - **`list` reporter, traces on failure.** The HTML reporter opens a server on
 *   failure, which hangs a CI job and an agent alike; a trace is what actually
 *   answers "what did the page look like when it failed".
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'apps/web/e2e',
  // A spec that hangs is a spec that fails, and a stage runner that never
  // reaches an outcome is the failure this suite is for. Generous rather than
  // tight because the first `goto` of a cold CI checkout waits on Vite
  // pre-bundling react; the whole suite runs in three seconds warm, so this is
  // headroom for one slow start and not a budget anything actually uses.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Pinned, because `defaultSettings()` reads it once at startup to choose the
    // effects-intensity default. Left to Playwright's own default, which branch
    // the whole suite exercises would be decided somewhere else — and the
    // reduced-motion case is asserted deliberately, in `first-run.spec.ts`.
    contextOptions: { reducedMotion: 'no-preference' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Vite is fast, but a cold CI checkout has a dep graph to crawl first.
    timeout: 60_000,
  },
});
