import { runDryerSpain, runSonyAsk } from '@fitcheck/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { photosEnabled } from '../lib/photos.js';
import { ProductCard } from './ProductCard.js';

const aniq = runDryerSpain.attempts[0]?.pick;
const tvPick = runSonyAsk.attempts[0]?.pick;
if (!aniq || !tvPick) throw new Error('fixture picks missing');

test('the product card shows title, store, price and the agent’s words', () => {
  render(<ProductCard pick={aniq} category="hair_dryer" />);
  expect(screen.getByRole('heading', { name: aniq.title })).toBeInTheDocument();
  expect(screen.getByText('walmart.com')).toBeInTheDocument();
  expect(screen.getByText('$29.29')).toBeInTheDocument();
  expect(screen.getByText(`The agent says: “${aniq.agentSays}”`)).toBeInTheDocument();
  const photo = screen.getByRole('img', { name: 'Product photo from the listing' });
  expect(photo).toHaveAttribute('src', aniq.image);
  expect(photo).toHaveAttribute('loading', 'lazy');
  expect(photo).toHaveAttribute('referrerpolicy', 'no-referrer');
});

test('photos off shows the category icon, not the photo', () => {
  photosEnabled('?photos=off');
  render(<ProductCard pick={aniq} category="hair_dryer" />);
  expect(screen.queryByRole('img', { name: 'Product photo from the listing' })).toBeNull();
  expect(screen.getByRole('img', { name: 'Hair dryer' })).toBeInTheDocument();
});

test('a photo that fails to load falls back to the category icon', () => {
  render(<ProductCard pick={aniq} category="hair_dryer" />);
  fireEvent.error(screen.getByRole('img', { name: 'Product photo from the listing' }));
  expect(screen.getByRole('img', { name: 'Hair dryer' })).toBeInTheDocument();
});

test('a pick without an image shows the category icon', () => {
  render(<ProductCard pick={{ ...tvPick, image: null }} category="tv" />);
  expect(screen.getByRole('img', { name: 'TV' })).toBeInTheDocument();
});
