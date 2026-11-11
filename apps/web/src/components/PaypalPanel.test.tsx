import { runDryerSpain, runSonyAsk } from '@fitcheck/contracts';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { meterWidths, PaypalPanel } from './PaypalPanel.js';

const capOnlySentence = runDryerSpain.attempts[0]?.capOnly.sentence as string;

function renderDryer(eventDelayMs = 0, sentence: string | null = null) {
  return render(
    <PaypalPanel
      cap={runDryerSpain.cap}
      events={runDryerSpain.events}
      capOnlySentence={sentence}
      eventDelayMs={eventDelayMs}
    />,
  );
}

test('the cap figure and the three amounts', () => {
  renderDryer();
  expect(screen.getByRole('complementary', { name: 'What PayPal did' })).toBeInTheDocument();
  expect(screen.getByText('Spending cap, approved once').closest('div')).toHaveTextContent(
    '$3,000.00',
  );
  expect(screen.getByText('Captured', { selector: 'span' }).closest('span')).toHaveTextContent(
    '$20.20',
  );
  expect(screen.getByText('On hold', { selector: 'span' }).closest('span')).toHaveTextContent(
    '$0.00',
  );
  expect(screen.getByText('Available', { selector: 'span' }).closest('span')).toHaveTextContent(
    '$2,979.80',
  );
});

test('meter widths follow captured and held', () => {
  expect(meterWidths(runDryerSpain.cap)).toEqual({ captured: '0.67%', held: '0.00%' });
  const c = runSonyAsk.cap;
  expect(meterWidths(c).held).toBe(`${((c.heldCents / c.amountCents) * 100).toFixed(2)}%`);
  expect(meterWidths({ ...c, amountCents: 0 })).toEqual({ captured: '0%', held: '0%' });
});

test('the meter is hidden from assistive tech and keeps a small capture visible', () => {
  const { container } = renderDryer();
  const meter = container.querySelector('[data-meter]') as HTMLElement;
  expect(meter).toHaveAttribute('aria-hidden', 'true');
  const captured = meter.querySelector('[data-bar="captured"]') as HTMLElement;
  expect(captured.style.width).toBe('0.67%');
  expect(captured).toHaveAttribute('data-some');
});

test('events in order, each with its PayPal call', () => {
  renderDryer();
  const items = screen.getAllByRole('listitem');
  expect(items.map((li) => li.dataset.type)).toEqual(['authorized', 'not_captured', 'captured']);
  expect(items[0]).toHaveTextContent('Cap authorized');
  expect(items[0]).toHaveTextContent('$3,000.00');
  expect(items[0]).toHaveTextContent('POST /v2/checkout/orders/{id}/authorize');
  expect(items[1]).toHaveTextContent('Not captured');
  expect(items[1]).toHaveTextContent('No capture sent to PayPal');
  expect(items[2]).toHaveTextContent('/capture, final_capture: false');
  expect(items[2]).toHaveTextContent('Capture 3C679366HH908993F.');
  expect(items[2]).toHaveTextContent('22:40:12. PayPal captured $20.20 from the spending cap.');
});

test('only events after the authorization wait for the reveal', () => {
  renderDryer(1000);
  const items = screen.getAllByRole('listitem');
  expect(items.map((li) => li.style.getPropertyValue('--d'))).toEqual(['0ms', '1000ms', '1000ms']);
});

test('the head shows the cap mode', () => {
  render(
    <PaypalPanel
      cap={{ ...runDryerSpain.cap, mode: 'simulated' }}
      events={[]}
      capOnlySentence={null}
      eventDelayMs={0}
    />,
  );
  expect(screen.getByRole('heading', { name: 'PayPal' })).toBeInTheDocument();
  expect(screen.getByText('simulated')).toBeInTheDocument();
});

test('the spending-cap-only box shows its sentence, or nothing', () => {
  const { unmount } = renderDryer(0, capOnlySentence);
  expect(screen.getByText('With a spending cap only')).toBeInTheDocument();
  expect(screen.getByText(capOnlySentence)).toBeInTheDocument();
  unmount();
  renderDryer(0, null);
  expect(screen.queryByText('With a spending cap only')).toBeNull();
});
