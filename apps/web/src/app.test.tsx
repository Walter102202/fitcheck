import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './app.js';

test('the web app renders Fitcheck', () => {
  render(<App />);
  expect(screen.getByText('Fitcheck')).toBeTruthy();
});
