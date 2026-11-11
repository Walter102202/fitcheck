import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `eval` and `tests` are globbed so the config also works before lane C and
    // the integration add those packages.
    projects: ['packages/*', 'apps/*', '{eval,tests}'],
  },
});
