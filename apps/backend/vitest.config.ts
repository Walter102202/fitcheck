import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@fitcheck/backend',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Parallel PGlite startups blow the timeout; do not raise timeouts instead.
    maxWorkers: 2,
    // Projects with their own maxWorkers need a unique group.
    sequence: { groupOrder: 1 },
  },
});
