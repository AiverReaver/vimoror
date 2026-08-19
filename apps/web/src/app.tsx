/**
 * Wave A's walking skeleton: the whole wall stack, standing up, with nothing on
 * it yet.
 *
 * It exists to prove the four seams M4 depends on actually connect in a browser
 * before Wave B builds the runner on top of them — the atlas bakes out of
 * `@vimorror/stage-view` (not a second copy), a stage frame becomes cells through
 * the lifted `stageCells`, `createRenderer` picks its own post-FX path, and Vite
 * serves all of it from outside this app's root. Wave B replaces the body of this
 * file with the screen union and `runner.tsx`; the canvas plumbing below is the
 * part it keeps.
 *
 * Two rules borrowed from the editor's `grid-pane.tsx`, both load-bearing:
 *
 * - **React never touches the canvas.** The element is created once and every
 *   frame is imperative. `GlyphGrid`'s dirty-cell cache describes pixels that are
 *   already on the surface; a re-render that swapped the element would leave the
 *   cache describing a blank one.
 * - **The canvas is never asked for a second context type.** A canvas hands out
 *   exactly one, and `createRenderer` claims this one for WebGL2. Asking it for
 *   `'2d'` anywhere would make the pipeline's own probe return null.
 *
 * Unlike the editor, the draw is a `requestAnimationFrame` loop rather than one
 * render per commit: phosphor persistence and the glitch bands are time-varying,
 * so the post-FX pass has to keep running over an idle buffer. Intensity is
 * pinned at 0 here — `effectsIntensity` is never defaulted by render, and the
 * value is Wave C's comfort layer to decide.
 */

import { createRenderer, type Renderer } from '@vimorror/render';
import { CELL_H, CELL_W, getFontAtlas, stageCells } from '@vimorror/stage-view';
import { useEffect, useRef, useState } from 'react';

/** Authored here, not loaded: the campaign catalogue is Wave B. */
const SKELETON_LINES = [
  'vimorror',
  '',
  'the shell is standing up.',
  'wave a: atlas baked, cells built, renderer chosen.',
];

const COLS = 64;
const ROWS = 12;

/** One row per camera row, every row padded to `COLS`, so `linesToCells`'s own
 * longest-line width calculation lands on exactly the canvas's size instead of
 * jumping with the content — the same padding `grid-pane.tsx` does, and the shape
 * Wave B's viewport clip takes. */
function frameLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let row = 0; row < ROWS; row += 1) out.push((lines[row] ?? '').padEnd(COLS, ' '));
  return out;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState('baking the font atlas…');

  useEffect(() => {
    // Captured per effect run, not read back from a ref on cleanup: StrictMode
    // runs this twice, and a shared ref would let the second run's renderer be
    // disposed by the first run's cleanup.
    let renderer: Renderer | undefined;
    let frame = 0;
    let cancelled = false;

    void getFontAtlas().then(
      (atlas) => {
        const canvas = canvasRef.current;
        if (cancelled || canvas === null) return;

        const cells = stageCells(frameLines(SKELETON_LINES), []);
        // Sized before `createRenderer`, which reads these to build its private
        // grid canvas and to size the post-FX pass.
        canvas.width = cells.width * CELL_W;
        canvas.height = cells.height * CELL_H;

        renderer = createRenderer(canvas, { atlas });
        setStatus(`post-fx: ${renderer.kind} · ${cells.width}x${cells.height} cells · intensity 0.00`);

        const draw = (): void => {
          renderer?.draw({
            cells,
            camera: { topline: 0, height: cells.height, width: cells.width },
            cursor: { pos: { line: 0, col: 0 }, mode: 'normal' },
            effectsIntensity: 0,
          });
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
      },
      // Surfaced rather than swallowed, the lesson `grid-pane.tsx` recorded: a
      // missing woff2 otherwise reads as a slow page with an unhandled rejection
      // in the console instead of as a broken one.
      (e: unknown) => setStatus(`the font atlas failed to bake: ${String(e)}`),
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      renderer?.dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} />
      <p className={status.startsWith('the font atlas failed') ? 'status bad' : 'status'}>{status}</p>
    </>
  );
}
