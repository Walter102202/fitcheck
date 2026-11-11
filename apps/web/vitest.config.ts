import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: '@fitcheck/web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    env: { TZ: 'UTC' },
    // Vitest blanks every CSS import by default; `?raw` imports must keep their text so the
    // style tests can read the tokens. CSS Modules still resolve to stable class names.
    css: { include: [/\.css\?raw$/] },
  },
});
