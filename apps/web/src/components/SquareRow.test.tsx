import type { SquareState } from '@fitcheck/contracts';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SquareLegend, SquareRow } from './SquareRow.js';

test('14 of 16 renders 16 squares and an accessible count', () => {
  const squares: SquareState[] = [...Array(14).fill('paid_bad'), 'not_paid', 'not_paid'];
  const { container } = render(
    <SquareRow
      who="Spending cap only"
      squares={squares}
      count={14}
      of={16}
      label="Wrong purchases that got paid"
    />,
  );
  expect(
    screen.getByRole('img', { name: '14 of 16: Wrong purchases that got paid' }),
  ).toBeInTheDocument();
  expect(container.querySelectorAll('i[data-state="paid_bad"]')).toHaveLength(14);
  expect(container.querySelectorAll('i[data-state="not_paid"]')).toHaveLength(2);
  expect(screen.getByText('14 of 16')).not.toHaveAttribute('data-pending');
  expect(screen.getByText('Spending cap only')).toBeInTheDocument();
});

test('a row not measured yet says so', () => {
  const { container } = render(
    <SquareRow
      who="Fitcheck"
      squares={Array<SquareState>(16).fill('pending')}
      count={null}
      of={16}
      label="Wrong purchases that got paid"
    />,
  );
  // The words are longer than a count, so they take the smaller pending style and stay inside the sheet.
  expect(screen.getByText('Not measured yet')).toHaveAttribute('data-pending');
  expect(
    screen.getByRole('img', { name: 'Not measured yet: Wrong purchases that got paid' }),
  ).toBeInTheDocument();
  expect(container.querySelectorAll('i[data-state="pending"]')).toHaveLength(16);
});

test('a mean shows the number alone, and a missing mean does not apply', () => {
  const label = 'Questions per held purchase';
  const { unmount } = render(
    <SquareRow who="Fitcheck" squares={[]} count={1.2} of={9} label={label} unit="mean" />,
  );
  expect(screen.getByText('1.2')).not.toHaveAttribute('data-pending');
  expect(screen.queryByText(/of 9/)).toBeNull();
  expect(screen.getByRole('img', { name: `1.2: ${label}` })).toBeInTheDocument();
  unmount();
  render(
    <SquareRow
      who="Spending cap only"
      squares={[]}
      count={null}
      of={9}
      label={label}
      unit="mean"
    />,
  );
  expect(screen.getByText('Does not apply')).toHaveAttribute('data-pending');
  expect(screen.queryByText('Not measured yet')).toBeNull();
  expect(screen.getByRole('img', { name: `Does not apply: ${label}` })).toBeInTheDocument();
});

test('the legend names each square, and the pending one only when needed', () => {
  const { unmount } = render(<SquareLegend pending={false} />);
  expect(screen.getByText('Happened, and it is bad')).toBeInTheDocument();
  expect(screen.getByText('Happened, and it is good')).toBeInTheDocument();
  expect(screen.getByText('Did not happen')).toBeInTheDocument();
  expect(screen.queryByText('Not measured yet')).toBeNull();
  unmount();
  render(<SquareLegend pending />);
  expect(screen.getByText('Not measured yet')).toBeInTheDocument();
});
