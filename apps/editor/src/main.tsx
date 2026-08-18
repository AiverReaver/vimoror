/**
 * Mount point. `StrictMode` is on deliberately: this app has exactly one
 * imperative surface (`grid-pane.tsx`'s canvas), and StrictMode's double-invoked
 * effects are the cheapest way to catch the two ways that surface can go wrong —
 * an effect that leaks (the font atlas, guarded by a module-level promise) and
 * one that blanks the canvas without telling `GlyphGrid` to invalidate.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.tsx';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
