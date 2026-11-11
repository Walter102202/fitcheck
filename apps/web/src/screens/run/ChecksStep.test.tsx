import { runDryerSpain } from '@fitcheck/contracts';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ChecksStep, originText } from './ChecksStep.js';

test('origin lines', () => {
  expect(
    originText({
      requirement: 'common.budget',
      name: 'Under $40',
      origin: 'stated',
      originQuote: 'Under $40',
    }),
  ).toBe('You said “Under $40”');
  expect(
    originText({
      requirement: 'hair_dryer.dual_voltage',
      name: 'x',
      fact: 'voltage',
      origin: 'triggered',
      originQuote: 'trip to Spain',
    }),
  ).toBe('You said “trip to Spain”. Nobody mentioned voltage.');
  expect(
    originText({
      requirement: 'tv.wall_mount',
      name: 'x',
      origin: 'triggered',
      originQuote: 'wall',
    }),
  ).toBe('You said “wall”. Nobody mentioned it.');
  expect(originText({ requirement: 'common.in_stock', name: 'x', origin: 'always' })).toBe(
    'Checked on every purchase',
  );
});

test('one row per check, with its name and origin', () => {
  render(<ChecksStep checks={runDryerSpain.checks} notChecked={[]} />);
  expect(screen.getByRole('heading', { name: 'What Fitcheck will check' })).toBeInTheDocument();
  expect(screen.getByText('Works on 220-240 V outlets abroad')).toBeInTheDocument();
  expect(
    screen.getByText('You said “trip to Spain”. Nobody mentioned voltage.'),
  ).toBeInTheDocument();
  expect(screen.getAllByText('Checked on every purchase')).toHaveLength(
    runDryerSpain.checks.filter((c) => c.origin === 'always').length,
  );
});

test('the not-checked line', () => {
  const { unmount } = render(
    <ChecksStep
      checks={runDryerSpain.checks}
      notChecked={['shipping', 'returns', 'warranty', 'tax']}
    />,
  );
  expect(screen.getByText('Not checked: shipping, returns, warranty, tax.')).toBeInTheDocument();
  unmount();
  render(<ChecksStep checks={runDryerSpain.checks} notChecked={[]} />);
  expect(screen.queryByText(/^Not checked:/)).toBeNull();
});

test('empty checks say the request could not be read', () => {
  render(<ChecksStep checks={[]} notChecked={['shipping']} />);
  expect(screen.getByRole('status')).toHaveTextContent('Fitcheck could not read this request.');
  expect(screen.queryByText(/^Not checked:/)).toBeNull();
});
