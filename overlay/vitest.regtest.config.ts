import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/regtest/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    setupFiles: ['./test/regtest/setup.ts'],
  },
});
