import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Root is `apps/editor` (the `dev:editor` script names it), and every import
// this app makes resolves OUTSIDE that root: the three workspace packages as
// raw `.ts` sources, render's vendored woff2, and `content/stages/*.json`.
// Vite allows that because it finds the pnpm workspace root on its own — the
// `dev:render` script has relied on the same thing since M1.
export default defineConfig({
  plugins: [react()],
});
