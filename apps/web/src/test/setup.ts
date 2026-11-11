import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library's automatic cleanup needs this hook.
// Session storage holds the photo switch and the fixture state; each test starts clean.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
