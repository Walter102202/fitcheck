import { runDryerSpain } from '@fitcheck/contracts';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Notices } from './Notices.js';
import { OutcomeStrip } from './OutcomeStrip.js';

test('captured shows the amount and the cap', () => {
  render(
    <OutcomeStrip
      kind="captured"
      amountCents={2020}
      capAmountCents={300000}
      product="hair dryer"
      reason="review"
    />,
  );
  expect(screen.getByRole('status')).toHaveAttribute('data-kind', 'captured');
  expect(screen.getByText('$20.20')).toBeInTheDocument();
  expect(screen.getByText('PayPal captured $20.20 from the $3,000.00 cap.')).toBeInTheDocument();
  expect(
    screen.getByText(
      'The amount is the price of the store offer at the moment of paying, not a number from the agent.',
      { exact: false },
    ),
  ).toBeInTheDocument();
});

test('captured after answers says every line was a yes', () => {
  render(
    <OutcomeStrip
      kind="captured"
      amountCents={139800}
      capAmountCents={300000}
      product="TV"
      reason="answers"
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('You answered yes to every line.');
});

test('captured with the review off is a warning, not a success', () => {
  render(
    <OutcomeStrip
      kind="unchecked"
      amountCents={1499}
      capAmountCents={300000}
      product="hair dryer"
      reason="review"
    />,
  );
  const strip = screen.getByRole('status');
  expect(strip).toHaveAttribute('data-kind', 'unchecked');
  expect(screen.getByText('Captured $14.99. Nobody checked the listing.')).toBeInTheDocument();
  expect(strip).toHaveTextContent('Captured, unchecked');
  expect(strip).toHaveTextContent('$14.99');
  expect(strip.textContent).not.toMatch(/PayPal captured \$14\.99 from/);
});

test('not captured shows $0.00 and the message sent to the agent', () => {
  const msg = runDryerSpain.attempts[0]?.review.agentMessage as string;
  render(
    <OutcomeStrip
      kind="not_captured"
      amountCents={2929}
      capAmountCents={300000}
      product="hair dryer"
      reason="review"
      agentMessage={msg}
    />,
  );
  const strip = screen.getByRole('status');
  expect(strip).toHaveAttribute('data-kind', 'not_captured');
  expect(screen.getByText('$0.00')).toBeInTheDocument();
  expect(screen.getByText('PayPal captured nothing for this hair dryer.')).toBeInTheDocument();
  expect(strip).toHaveTextContent('It went back to the agent with the reason.');
  expect(screen.getByText('Sent to the agent:')).toBeInTheDocument();
  expect(screen.getByText(msg)).toBeInTheDocument();
  expect(strip).toHaveTextContent(`Sent to the agent: ${msg}`);
});

test('not captured after answers says not every line was accepted', () => {
  render(
    <OutcomeStrip
      kind="not_captured"
      amountCents={0}
      capAmountCents={300000}
      product="TV"
      reason="answers"
    />,
  );
  expect(screen.getByText('PayPal captured nothing for this TV.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'You did not accept every line, so the purchase went back to the agent.',
  );
  expect(screen.queryByText('Sent to the agent:')).toBeNull();
});

test('a yes the payment refused says so, and does not blame the buyer', () => {
  const msg = 'Not paid. The spending cap has $168.81 left.';
  render(
    <OutcomeStrip
      kind="not_captured"
      amountCents={0}
      capAmountCents={300000}
      product="TV"
      reason="payment"
      agentMessage={msg}
    />,
  );
  const strip = screen.getByRole('status');
  expect(screen.getByText('PayPal captured nothing for this TV.')).toBeInTheDocument();
  expect(strip).toHaveTextContent(
    'You answered yes to every line, but the payment did not go through.',
  );
  expect(strip).toHaveTextContent(`Sent to the agent: ${msg}`);
  expect(strip.textContent).not.toMatch(/did not accept/);
});

test('a capture PayPal has not confirmed yet is pending, never "captured $0.00"', () => {
  render(
    <OutcomeStrip
      kind="pending"
      amountCents={0}
      capAmountCents={300000}
      product="hair dryer"
      reason="review"
    />,
  );
  const strip = screen.getByRole('status');
  expect(strip).toHaveAttribute('data-kind', 'pending');
  expect(screen.getByText('PayPal is still confirming this capture.')).toBeInTheDocument();
  expect(strip.textContent).not.toMatch(/\$0\.00/);
  expect(strip.textContent).not.toMatch(/captured \$/i);
});

test('failed closed says Fitcheck could not check this listing', () => {
  render(
    <OutcomeStrip
      kind="not_captured"
      amountCents={0}
      capAmountCents={300000}
      product="hair dryer"
      reason="failed_closed"
    />,
  );
  expect(screen.getByText('Fitcheck could not check this listing.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Nothing is captured when the review cannot run.',
  );
  expect(screen.getByText('Not captured')).toBeInTheDocument();
});

test('the next-purchase link renders inside the strip', () => {
  render(
    <OutcomeStrip
      kind="captured"
      amountCents={2020}
      capAmountCents={300000}
      product="hair dryer"
      reason="review"
    >
      <a href="/run/dryer-silent">Next purchase</a>
    </OutcomeStrip>,
  );
  expect(screen.getByRole('status')).toContainElement(screen.getByRole('link'));
});

test('notices: none renders nothing, two render two items', () => {
  const two = [
    'Channel3 did not answer. Showing the copy recorded on 2026-11-10.',
    'The PayPal sandbox did not answer. PayPal is simulated for this visit.',
  ];
  const empty = render(<Notices notices={[]} />);
  expect(empty.container).toBeEmptyDOMElement();
  empty.unmount();
  render(<Notices notices={two} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('status')).toHaveTextContent(two[1] as string);
});
