import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { FIXTURE_RESULTS } from '../../api/fixtures/results.js';
import { ResultsMetrics } from './ResultsMetrics.js';

test('each metric has its heading and two rows of squares', () => {
  render(<ResultsMetrics rows={FIXTURE_RESULTS.rows} headingLevel={3} />);
  for (const row of FIXTURE_RESULTS.rows)
    expect(screen.getByRole('heading', { level: 3, name: row.label })).toBeInTheDocument();
  expect(screen.getAllByText('Spending cap only')).toHaveLength(4);
  expect(screen.getAllByText('Fitcheck')).toHaveLength(4);
  expect(
    screen.getByRole('img', { name: '0 of 12: Correct purchases blocked by mistake' }),
  ).toBeDefined();
});

test('the heading level follows the page', () => {
  render(<ResultsMetrics rows={FIXTURE_RESULTS.rows.slice(0, 1)} headingLevel={2} />);
  expect(
    screen.getByRole('heading', { level: 2, name: 'Wrong purchases that got paid' }),
  ).toBeInTheDocument();
});
