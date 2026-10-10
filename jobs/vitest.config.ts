import { defineConfig } from 'vitest/config';

// Each test file boots an in-process Postgres (PGlite) with every migration applied.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 120_000 } });
