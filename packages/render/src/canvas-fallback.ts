/**
 * The no-WebGL2 path: blit the glyph-grid canvas straight through, with no
 * 2D approximation of the CRT effects at all.
 *
 * That is a deliberate scope boundary, not a gap. The CRT look is decorative;
 * the game's own narrative glitches are `Cell` content changes coming from
 * M2's director and render identically down either path. `intensity` is
 * accepted and ignored so `pipeline.ts` can drive both paths through one call
 * shape.
 */

export type CanvasFallback = {
  readonly kind: 'fallback';
  present(source: HTMLCanvasElement, intensity: number, timeSec: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

export function createCanvasFallback(canvas: HTMLCanvasElement): CanvasFallback {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable for the fallback blit');

  return {
    kind: 'fallback',
    present(source) {
      ctx.drawImage(source, 0, 0);
    },
    // Assigning `canvas.width`/`height` already resets the 2D context, and the
    // next `present` overwrites every pixel, so there is nothing to reallocate.
    resize() {},
    dispose() {},
  };
}
