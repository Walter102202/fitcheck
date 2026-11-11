import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { Button, ButtonLink } from './Button.js';
import { PaymentChip } from './PaymentChip.js';
import { REQUIREMENT_LABEL, RequirementChip } from './RequirementChip.js';

test.each([
  ['backed', 'Backed'],
  ['unbacked', 'Not in the listing'],
  ['never_asked', 'Nobody asked'],
  ['contradictory', 'Listing disagrees'],
  ['broken', 'Broken'],
] as const)('requirement chip %s reads %s with an icon', (state, label) => {
  const { container } = render(<RequirementChip state={state} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(container.querySelector('svg')).not.toBeNull();
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(container.firstElementChild).toHaveAttribute('data-state', state);
});

test.each([
  ['authorized', 'Cap authorized'],
  ['held', 'On hold'],
  ['captured', 'Captured'],
  ['not_captured', 'Not captured'],
] as const)('payment chip %s reads %s with an icon', (state, label) => {
  const { container } = render(<PaymentChip state={state} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(container.querySelector('svg')).not.toBeNull();
  expect(container.firstElementChild).toHaveAttribute('data-state', state);
});

test('the payment reason type has no chip of its own', () => {
  expect(Object.keys(REQUIREMENT_LABEL).sort()).toEqual([
    'backed',
    'broken',
    'contradictory',
    'never_asked',
    'unbacked',
  ]);
});

test('a button carries its variant and size, and clicks', () => {
  const onClick = vi.fn();
  render(
    <Button variant="quiet" size="small" onClick={onClick}>
      Start over
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Start over' });
  expect(button).toHaveAttribute('data-variant', 'quiet');
  expect(button).toHaveAttribute('data-size', 'small');
  expect(button).toHaveAttribute('type', 'button');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('a button link defaults to primary and normal', () => {
  render(
    <MemoryRouter>
      <ButtonLink to="/run/dryer-spain">Run</ButtonLink>
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'Run' });
  expect(link).toHaveAttribute('href', '/run/dryer-spain');
  expect(link).toHaveAttribute('data-variant', 'primary');
  expect(link).toHaveAttribute('data-size', 'normal');
});
