import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC preserva decorators e metadata (NestJS) nos testes.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    globalSetup: process.env.TEST_DATABASE_URL ? ['./test/global-setup.ts'] : [],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
