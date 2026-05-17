import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
    passWithNoTests: true,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      // Stub Deno-targeted URL imports so edge-function modules load under
      // Node-based vitest (the real SDK only runs in Deno at runtime).
      {
        find: 'https://esm.sh/@anthropic-ai/sdk@0.30.0',
        replacement: path.resolve(__dirname, 'tests/stubs/anthropic.ts'),
      },
    ],
  },
});
