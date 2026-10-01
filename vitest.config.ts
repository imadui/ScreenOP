import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@app-types': resolve('src/types')
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
});
