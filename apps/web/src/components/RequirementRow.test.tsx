import {
  type RequirementResult,
  runDryerSilent,
  runDryerSpain,
  runSonyAsk,
} from '@fitcheck/contracts';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { RequirementRow } from './RequirementRow.js';

function find(results: RequirementResult[] | undefined, pick: (r: RequirementResult) => boolean) {
  const found = results?.find(pick);
  if (!found) throw new Error('fixture result missing');
  return found;
}

const aniq = runDryerSpain.attempts[0];
const broken = find(aniq?.review.results, (r) => r.requirement === 'hair_dryer.dual_voltage');
const size = find(
  runSonyAsk.attempts[0]?.review.results,
  (r) => r.requirement === 'tv.screen_size',
);
const backed = find(aniq?.review.results, (r) => r.requirement === 'common.budget');

test('a broken row quotes the listing with a broken mark and is flagged', () => {
  const { container } = render(<RequirementRow result={broken} index={3} />);
  const ev = broken.evidence[0];
  expect(screen.getByText('Broken')).toBeInTheDocument();
  expect(screen.getByText(broken.name)).toBeInTheDocument();
  const mark = container.querySelector('mark');
  expect(mark).toHaveAttribute('data-tone', 'broken');
  expect(mark?.textContent).toBe(ev?.text.slice(ev.start, ev.end));
  expect((mark as HTMLElement).style.getPropertyValue('--d')).toBe('500ms');
  const row = container.firstElementChild as HTMLElement;
  expect(row).toHaveAttribute('data-flag');
  expect(row.style.getPropertyValue('--d')).toBe('300ms');
});

test('a contradictory row shows the pair with 65 in and 55 in', () => {
  const { container } = render(<RequirementRow result={size} index={0} />);
  expect(screen.getByText('Listing disagrees')).toBeInTheDocument();
  expect(screen.getByText('65 in')).toBeInTheDocument();
  expect(screen.getByText('55 in')).toBeInTheDocument();
  expect(container.firstElementChild).toHaveAttribute('data-wide');
});

test('an unbacked row says where Fitcheck looked and found nothing', () => {
  const unbacked = find(runDryerSilent.attempts[0]?.review.results, (r) => r.state === 'unbacked');
  render(<RequirementRow result={unbacked} index={0} />);
  expect(screen.getByText('Not in the listing')).toBeInTheDocument();
  expect(screen.getByText('Looked in, found nothing about voltage')).toBeInTheDocument();
  for (const label of unbacked.searched ?? []) expect(screen.getByText(label)).toBeInTheDocument();
  expect(document.querySelector('mark')).toBeNull();
});

test('a never-asked row with evidence quotes it as backed', () => {
  const result: RequirementResult = {
    requirement: 'tv.wall_mount',
    name: 'Fits the wall mount the buyer already has',
    origin: 'triggered',
    state: 'never_asked',
    evidence: [
      {
        path: 'structured_attributes.vesa-mounting-pattern',
        label: 'Attribute: vesa-mounting-pattern',
        text: '300 x 300 mm',
        start: 0,
        end: 12,
        value: '300x300',
        display: '300 x 300 mm',
      },
    ],
  };
  const { container } = render(<RequirementRow result={result} index={1} />);
  expect(screen.getByText('Nobody asked')).toBeInTheDocument();
  expect(container.querySelector('mark')).toHaveAttribute('data-tone', 'backed');
  expect(container.querySelector('mark')?.textContent).toBe('300 x 300 mm');
});

test('a never-asked row without evidence falls back to what was searched', () => {
  const result: RequirementResult = {
    requirement: 'tv.wall_mount',
    name: 'Fits the wall mount the buyer already has',
    fact: 'wall-mount pattern',
    origin: 'triggered',
    state: 'never_asked',
    evidence: [],
    searched: ['Attributes'],
  };
  render(<RequirementRow result={result} index={1} />);
  expect(screen.getByText('Looked in, found nothing about wall-mount pattern')).toBeInTheDocument();
  expect(screen.getByText('Attributes')).toBeInTheDocument();
});

test('the note shows under the name', () => {
  render(<RequirementRow result={{ ...broken, note: 'Rules it out abroad.' }} index={0} />);
  expect(screen.getByText('Rules it out abroad.')).toBeInTheDocument();
});

test('a backed row is not flagged; a not_applicable row renders nothing', () => {
  const { container } = render(<RequirementRow result={backed} index={0} />);
  expect(container.firstElementChild).not.toHaveAttribute('data-flag');
  expect(container.querySelector('mark')).toHaveAttribute('data-tone', 'backed');
  const na = render(
    <RequirementRow result={{ ...backed, state: 'not_applicable', evidence: [] }} index={0} />,
  );
  expect(na.container).toBeEmptyDOMElement();
});
