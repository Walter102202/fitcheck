import type { Evidence } from '@fitcheck/contracts';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ContradictionPair } from './ContradictionPair.js';
import { Quote, QuoteNone } from './Quote.js';

const sizeFeature: Evidence = {
  path: 'key_features[3]',
  label: 'Features, line 4',
  text: 'Screen Size Class: 55 Inch',
  start: 19,
  end: 26,
  value: 55,
  display: '55 in',
};
const sizeTitle: Evidence = {
  path: 'title',
  label: 'Title',
  text: 'Sony BRAVIA 8 K65XR80 65 inch 4K HDR Smart OLED TV (2024)',
  start: 22,
  end: 29,
  value: 65,
  display: '65 in',
};

test('highlights exactly the cited range and names the field', () => {
  const { container } = render(<Quote evidence={sizeFeature} tone="clash" />);
  expect(container.querySelector('mark')?.textContent).toBe('55 Inch');
  expect(container.querySelector('blockquote')).toHaveTextContent('Screen Size Class: 55 Inch');
  expect(screen.getByText('Features, line 4')).toBeInTheDocument();
  expect(screen.getByText('key_features[3]')).toBeInTheDocument();
  expect(container.firstElementChild).toHaveAttribute('data-tone', 'clash');
});

test('a listing head names the field for a reader and never shows the path', () => {
  render(<Quote evidence={sizeFeature} tone="broken" head="listing" />);
  expect(screen.getByText('Features, line 4, from the store’s listing')).toBeInTheDocument();
  expect(screen.queryByText('key_features[3]')).toBeNull();
});

test('the mark carries its tone and its delay', () => {
  const { container } = render(<Quote evidence={sizeFeature} tone="broken" markDelayMs={450} />);
  const mark = container.querySelector('mark') as HTMLElement;
  expect(mark).toHaveAttribute('data-tone', 'broken');
  expect(mark.style.getPropertyValue('--d')).toBe('450ms');
});

test('no highlight when start equals end', () => {
  const { container } = render(
    <Quote evidence={{ ...sizeFeature, start: 0, end: 0 }} tone="backed" />,
  );
  expect(container.querySelector('mark')).toBeNull();
  expect(container.querySelector('blockquote')).toHaveTextContent('Screen Size Class: 55 Inch');
});

test('out-of-range offsets clamp instead of throwing', () => {
  const a = render(<Quote evidence={{ ...sizeFeature, start: 20, end: 999 }} tone="backed" />);
  expect(a.container.querySelector('mark')?.textContent).toBe('5 Inch');
  const b = render(<Quote evidence={{ ...sizeFeature, start: 500, end: 600 }} tone="backed" />);
  expect(b.container.querySelector('mark')).toBeNull();
});

test('QuoteNone names the fact and the fields searched', () => {
  const { container } = render(
    <QuoteNone fact="voltage" searched={['Title', 'Features', 'Description']} />,
  );
  expect(screen.getByText('Looked in, found nothing about voltage')).toBeInTheDocument();
  expect(screen.getByText('Description')).toBeInTheDocument();
  expect(container.querySelectorAll('li')).toHaveLength(3);
  expect(container.firstElementChild).toHaveAttribute('data-tone', 'none');
});

test('QuoteNone without data stays honest', () => {
  const { container } = render(<QuoteNone />);
  expect(screen.getByText('Looked in, found nothing about this')).toBeInTheDocument();
  expect(container.querySelectorAll('li')).toHaveLength(0);
});

test('the pair shows both values and the not-equal sign', () => {
  const { container } = render(<ContradictionPair left={sizeTitle} right={sizeFeature} />);
  expect(screen.getAllByText('reads as', { exact: false })).toHaveLength(2);
  expect(screen.getByText('65 in')).toBeInTheDocument();
  expect(screen.getByText('55 in')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'is not equal to' })).toBeInTheDocument();
  expect([...container.querySelectorAll('mark')].map((m) => m.dataset.tone)).toEqual([
    'clash',
    'clash',
  ]);
});
