/**
 * Mount point, deliberately the editor's: `StrictMode` on, one `#root`, and a
 * loud throw if the element is missing rather than a silently blank page.
 *
 * StrictMode earns its keep here for the same reason it does in the editor, only
 * more so — this app's imperative surface is the renderer, and StrictMode's
 * double-invoked effects are the cheapest way to catch a leaked WebGL context, a
 * second `requestAnimationFrame` loop nobody cancelled, and a font atlas baked
 * twice.
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
