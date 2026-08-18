import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'tools/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    // The golden corpus is committed, so the default suite never shells out
    // to Vim. Only `goldens:generate` and `test:fuzz` need it installed.
    environment: 'node',
  },
});
