import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Root is `apps/web` (the `dev` script names it), and every import this app
// makes resolves OUTSIDE that root: the four workspace packages as raw `.ts`
// sources, render's vendored woff2, and `content/stages/*.json`. Vite allows
// that because it finds the pnpm workspace root on its own — `dev:render` and
// `dev:editor` have both relied on the same thing since M1, so there is no
// `server.fs.allow` here either.
export default defineConfig({
  plugins: [react()],
});
