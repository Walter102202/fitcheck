import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@fitcheck/eval',
    include: ['src/**/*.test.ts', '*.test.ts'],
    // The harness tests start PGlite; parallel startups blow the timeout.
    maxWorkers: 2,
    // Projects with their own maxWorkers need a unique group (backend is 1).
    sequence: { groupOrder: 2 },
  },
});
