import { defineConfig } from 'vitest/config';

// PGlite boots a full Postgres in-process; give the schema tests room on slow machines.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 120_000 } });
