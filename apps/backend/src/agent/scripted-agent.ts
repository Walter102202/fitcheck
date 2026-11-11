import { type AgentPick, type Cents, formatUsd, type ProductRecord } from '@fitcheck/contracts';
import { AppError } from '../api/errors.js';
import type { PickStep } from './scenarios.js';

/** Channel3 prices are dollars; the ledger is cents. */
export function toCents(price: number): Cents {
  return Math.round(price * 100);
}

/**
 * The scripted agent's pick, priced from the record it just read (so a live price change
 * never trips the price check). If the scenario's store is gone, it takes the cheapest
 * in-stock USD offer and names that store instead.
 */
export function pickFor(step: PickStep, record: ProductRecord): AgentPick {
  const offers = record.product.offers;
  let offer = offers.find((o) => o.domain === step.domain);
  if (!offer) {
    const usable = offers
      .filter((o) => o.availability === 'InStock' && o.price.currency === 'USD')
      .sort((a, b) => a.price.price - b.price.price);
    offer = usable[0] ?? offers[0];
  }
  if (!offer) {
    throw new AppError('no_offer', `Product ${step.productId} has no offer to buy`, {
      status: 502,
    });
  }
  const priceCents = toCents(offer.price.price);
  const images = record.product.images;
  const image = (images.find((i) => i.is_main_image) ?? images[0])?.url ?? null;
  return {
    productId: record.product.id,
    title: record.product.title,
    domain: offer.domain,
    priceCents,
    image,
    agentSays: step.agentSays
      .replaceAll('{price}', formatUsd(priceCents))
      .replaceAll(step.domain, offer.domain),
  };
}
