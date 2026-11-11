import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { FIXTURE_SCENARIOS } from '../api/fixtures/scenarios.js';
import { ScenarioRow } from './ScenarioRow.js';

const [s, s2] = FIXTURE_SCENARIOS;
if (!s || !s2) throw new Error('fixture scenarios missing');

test('a scenario row shows the request, what it shows, its state chip, how it ends and a Run link', () => {
  const { container } = render(
    <MemoryRouter>
      <ScenarioRow scenario={s} to="/run/dryer-spain" primary />
    </MemoryRouter>,
  );
  expect(screen.getByText(s.request)).toBeInTheDocument();
  expect(screen.getByText(s.shows)).toBeInTheDocument();
  expect(container.querySelector('[data-state="broken"]')).toHaveTextContent('Broken');
  expect(container.querySelector('[data-kind="ends-in"]')).toHaveTextContent(s.endsIn);
  const link = screen.getByRole('link', { name: `Run: ${s.title}` });
  expect(link).toHaveAttribute('href', '/run/dryer-spain');
  expect(link).toHaveAttribute('data-variant', 'primary');
  expect(link).toHaveTextContent('Run');
});

test('a secondary row has a quiet Run link', () => {
  render(
    <MemoryRouter>
      <ScenarioRow scenario={s2} to="/run/dryer-silent" primary={false} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: `Run: ${s2.title}` })).toHaveAttribute(
    'data-variant',
    'quiet',
  );
});
