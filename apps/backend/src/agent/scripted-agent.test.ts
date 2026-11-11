import { existsSync, readFileSync } from 'node:fs';
import { type ProductRecord, ProductRecordSchema } from '@fitcheck/contracts';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, SCENARIOS } from './scenarios.js';
import { pickFor, toCents } from './scripted-agent.js';

const fixture = (id: string): ProductRecord =>
  ProductRecordSchema.parse(JSON.parse(readFileSync(new URL(`${id}.json`, FIXTURES_DIR), 'utf8')));
const aniqStep = SCENARIOS[0]?.picks[0];

describe('scripted agent', () => {
  it('pickFor reads the price from the record at pick time', () => {
    if (!aniqStep) throw new Error('dryer-spain has no first pick');
    const record = fixture('cv7t721');
    const pick = pickFor(aniqStep, record);
    expect(pick).toMatchObject({
      productId: 'cv7t721',
      title: 'Hair Dryer',
      domain: 'walmart.com',
      priceCents: 2929,
      agentSays: 'This hair dryer is $29.29 at walmart.com, under your $40 budget.',
    });
    expect(pick.image).toMatch(/^https:\/\/cdn\.trychannel3\.com\//);
    const edited = structuredClone(record);
    const offer = edited.product.offers[0];
    if (offer) offer.price.price = 31;
    expect(pickFor(aniqStep, edited).priceCents).toBe(3100);
  });

  it('uses the cheapest in-stock USD offer when the scenario store is gone', () => {
    const record = fixture('UXXAg59');
    const step = {
      productId: 'UXXAg59',
      domain: 'gone.example',
      quantity: 1,
      agentSays: 'It is {price} at gone.example.',
    };
    const pick = pickFor(step, record);
    expect(pick.domain).toBe('pcrichard.com');
    expect(pick.priceCents).toBe(139800);
    expect(pick.agentSays).toBe('It is $1,398.00 at pcrichard.com.');
  });

  it('every scripted pick has a Channel3 recording', () => {
    for (const scenario of SCENARIOS) {
      for (const step of scenario.picks) {
        expect(existsSync(new URL(`${step.productId}.json`, FIXTURES_DIR)), step.productId).toBe(
          true,
        );
        expect(fixture(step.productId).product.offers.some((o) => o.domain === step.domain)).toBe(
          true,
        );
      }
    }
  });

  it('rounds prices to cents', () => {
    expect(toCents(20.2)).toBe(2020);
    expect(toCents(1199.99)).toBe(119999);
  });
});
