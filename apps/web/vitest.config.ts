import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': import.meta.dirname } },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
    env: { PUBLIC_DATA_MODE: 'fixture' }, // recorded DNS, RDAP, price and FX answers; tests never go online
  },
});
