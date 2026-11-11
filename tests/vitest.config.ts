import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@fitcheck/tests',
    include: ['e2e/**/*.test.ts'],
    // Each test boots PGlite; parallel startups blow the timeout.
    maxWorkers: 2,
    // Projects with their own maxWorkers need a unique group (backend 1, eval 2).
    sequence: { groupOrder: 3 },
  },
});
