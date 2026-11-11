import { expect, test } from 'vitest';
import fonts from './fonts.css?raw';
import tokens from './tokens.css?raw';

// Vite resolves the glob at build time, so a missing font file shows up as a missing key.
const fontFiles = Object.keys(import.meta.glob('../assets/fonts/*', { query: '?url' }));

test('tokens keep the approved values', () => {
  for (const decl of [
    '--page: #f1f3f6',
    '--ink: #12151c',
    '--ink-2: #474e5c',
    '--ink-3: #626978',
    '--mark: #ffe566',
    '--mark-clash: #ffc2dd',
    '--mark-broken: #ffc9c4',
    '--backed: #0b6635',
    '--ask: #7a4a00',
    '--clash: #a0145a',
    '--broken: #b3261e',
    '--pay-auth: #1f4fbf',
    '--pay-held: #ffb932',
    '--pay-not: #12151c',
    '--ledger-bg: #161a23',
    'color-scheme: light',
  ])
    expect(tokens).toContain(decl);
});

test('tokens hold no mockup-only or component rules', () => {
  for (const sel of ['.mockbar', '.screen', '.ledger', '.ask-card', '.check', '.chip'])
    expect(tokens).not.toContain(sel);
});

test('reduced motion turns every animation off', () => {
  expect(tokens).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
});

test('fonts are self-hosted under the token family names', () => {
  expect(fonts).toContain('font-family: "Atkinson Hyperlegible Next"');
  expect(fonts).toContain('font-family: "Atkinson Hyperlegible Mono"');
  expect(fonts).not.toMatch(/googleapis|gstatic/);
  expect(fonts.match(/font-display: swap/g)).toHaveLength(2);
  for (const f of [
    'atkinson-hyperlegible-next-latin.woff2',
    'atkinson-hyperlegible-mono-latin.woff2',
    'OFL-atkinson-hyperlegible-next.txt',
    'OFL-atkinson-hyperlegible-mono.txt',
  ])
    expect(fontFiles).toContain(`../assets/fonts/${f}`);
});
