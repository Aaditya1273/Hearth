import { defineConfig } from 'vitest/config';

/**
 * Integration tests: the real Express app, real SQL and the real MCP client
 * against PostgreSQL running in-process (PGlite, scripts/pglite-server.mjs).
 * No Docker needed. `npm run test:integration`.
 */
export default defineConfig({
    test: {
        include: ['tests/integration/**/*.test.ts'],
        environment: 'node',
        env: { TZ: 'Europe/Paris' },
        testTimeout: 30000,
        hookTimeout: 60000,
        fileParallelism: false,
    },
});
