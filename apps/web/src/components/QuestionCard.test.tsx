import { type QuestionCard as QuestionCardData, runSonyAsk } from '@fitcheck/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { QuestionCard } from './QuestionCard.js';

const sony = runSonyAsk.attempts[0]?.review.card as QuestionCardData;
const first = sony.lines[0] as QuestionCardData['lines'][number];
const second = {
  lineId: 'l2',
  requirement: 'tv.wall_mount',
  type: 'never_asked',
  text: 'The listing gives a 300 x 300 mm wall-mount pattern. Nobody asked which mount you have. Is that OK?',
} as const;
const card: QuestionCardData = { title: sony.title, lines: [first, second] };

function answer(lineText: string, label: string) {
  const group = screen.getByRole('radiogroup', { name: lineText });
  fireEvent.click(within(group).getByLabelText(label));
}

test('one radio group per line, named by the line text', () => {
  render(<QuestionCard card={card} onSubmit={vi.fn()} />);
  expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
  expect(screen.getByRole('radiogroup', { name: first.text })).toBeInTheDocument();
});

test('each group holds Yes, No and Don’t know radios that share the line id', () => {
  render(<QuestionCard card={card} onSubmit={vi.fn()} />);
  const group = screen.getByRole('radiogroup', { name: second.text });
  const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map((r) => r.value)).toEqual(['yes', 'no', 'dont_know']);
  expect(new Set(radios.map((r) => r.name))).toEqual(new Set([second.lineId]));
  expect(within(group).getByLabelText('Don’t know')).toBeInTheDocument();
});

test('the title and the line count come from the card', () => {
  const { rerender, container } = render(<QuestionCard card={sony} onSubmit={vi.fn()} />);
  expect(screen.getByRole('heading', { name: sony.title })).toBeInTheDocument();
  expect(container.querySelector('h2 .mono, h2 [data-money]')?.textContent).toBe('$1,398.00');
  expect(screen.getByText('The buyer answers 1 question.')).toBeInTheDocument();
  expect(
    screen.getByText(
      'PayPal captures only if every answer is yes. Anything else releases the hold.',
    ),
  ).toBeInTheDocument();
  rerender(<QuestionCard card={card} onSubmit={vi.fn()} />);
  expect(screen.getByText('The buyer answers 2 questions.')).toBeInTheDocument();
  expect(screen.getByRole('form', { name: sony.title })).toBeInTheDocument();
});

test('Send answers does nothing until every line is answered', () => {
  const onSubmit = vi.fn(async () => {});
  render(<QuestionCard card={card} onSubmit={onSubmit} />);
  answer(first.text, 'Yes');
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(
    screen.getByText('Answer every question first. PayPal captures only if every answer is yes.'),
  ).toBeInTheDocument();
  const unanswered = within(screen.getByRole('radiogroup', { name: second.text })).getAllByRole(
    'radio',
  )[0];
  expect(unanswered).toHaveFocus();
});

test('Don’t know is sent as dont_know', async () => {
  const onSubmit = vi.fn(async () => {});
  render(<QuestionCard card={card} onSubmit={onSubmit} />);
  answer(first.text, 'Yes');
  answer(second.text, 'Don’t know');
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  expect(onSubmit).toHaveBeenCalledWith({ [first.lineId]: 'yes', [second.lineId]: 'dont_know' });
  // Once sent, the card stays locked until the run replaces it.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled());
});

test('a double click sends the answers once', () => {
  const onSubmit = vi.fn(() => new Promise<void>(() => {}));
  render(<QuestionCard card={card} onSubmit={onSubmit} />);
  answer(first.text, 'Yes');
  answer(second.text, 'No');
  const send = screen.getByRole('button', { name: 'Send answers' });
  fireEvent.click(send);
  fireEvent.click(send);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
});

test('a failed send says so and allows another try', async () => {
  const onSubmit = vi.fn(async () => {
    throw new Error('down');
  });
  render(<QuestionCard card={sony} onSubmit={onSubmit} />);
  answer(first.text, 'No');
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  expect(await screen.findByText('The answers were not sent. Try again.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send answers' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  expect(onSubmit).toHaveBeenCalledTimes(2);
});

test('submitting the form with Enter sends the answers', () => {
  const onSubmit = vi.fn(() => new Promise<void>(() => {}));
  render(<QuestionCard card={card} onSubmit={onSubmit} />);
  answer(first.text, 'Yes');
  answer(second.text, 'Yes');
  fireEvent.submit(screen.getByRole('form', { name: sony.title }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
