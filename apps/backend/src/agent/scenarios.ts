import { readFileSync } from 'node:fs';
import { type ProductRecord, ProductRecordSchema, type Scenario } from '@fitcheck/contracts';

/** fixtures/channel3/ at the repo root; the same relative path works from src and dist. */
export const FIXTURES_DIR = new URL('../../../../fixtures/channel3/', import.meta.url);

/**
 * One scripted agent pick. `agentSays` may hold {price}, filled from the record at pick time.
 * `photo` is part of an image URL to show instead of the main image (falls back to it if gone).
 */
export type PickStep = {
  productId: string;
  domain: string;
  quantity: number;
  agentSays: string;
  photo?: string;
};
export type ScenarioScript = Omit<Scenario, 'image'> & { picks: PickStep[] };

/**
 * The four preset purchases of 01-foundation "Scenarios", in order. Cutting `tv-wall` means
 * deleting its entry here; nothing else changes.
 */
export const SCENARIOS: ScenarioScript[] = [
  {
    id: 'dryer-spain',
    category: 'hair_dryer',
    request: 'A hair dryer for my trip to Spain next week. Under $40.',
    title: 'Hair dryer for a trip to Spain',
    shows: 'The listing says 110-120 V only',
    endsIn: 'Sent back, then the second pick is paid',
    showcase: 'broken',
    picks: [
      {
        productId: 'cv7t721',
        domain: 'walmart.com',
        quantity: 1,
        agentSays: 'This hair dryer is {price} at walmart.com, under your $40 budget.',
      },
      {
        productId: 'saZdY6C',
        domain: 'walmart.com',
        quantity: 1,
        agentSays: 'Fitcheck sent that one back. This travel hair dryer is {price} at walmart.com.',
      },
    ],
  },
  {
    id: 'dryer-silent',
    category: 'hair_dryer',
    request: 'The cheapest hair dryer you can find for my trip to Spain.',
    title: 'The cheapest hair dryer for Spain',
    shows: 'The listing says nothing about voltage',
    endsIn: 'On hold: one card',
    showcase: 'unbacked',
    picks: [
      {
        productId: '5swh9aC',
        domain: 'boscovs.com',
        quantity: 1,
        agentSays: 'The cheapest one I found: {price} at boscovs.com.',
      },
      {
        productId: 'Qxt4Ypf',
        domain: 'newegg.com',
        quantity: 1,
        agentSays: 'You said no, so here is a Conair travel dryer at {price} from newegg.com.',
      },
    ],
  },
  {
    id: 'tv-sony',
    category: 'tv',
    request: 'A 65-inch OLED TV for the living room. Up to $1,500.',
    title: '65-inch OLED for the living room',
    shows: 'The title says 65 inch, the features say 55',
    endsIn: 'On hold: one card',
    showcase: 'contradictory',
    picks: [
      {
        productId: 'UXXAg59',
        domain: 'pcrichard.com',
        quantity: 1,
        agentSays: 'Sony BRAVIA 8, 65-inch OLED, {price} at pcrichard.com. Inside your $1,500.',
      },
    ],
  },
  {
    id: 'tv-wall',
    category: 'tv',
    request: 'Replace the TV on our living room wall with a 65-inch, up to $1,600.',
    title: '65-inch TV for the wall mount',
    shows: 'Nobody asked about the wall-mount pattern',
    endsIn: 'Asked twice: no, then yes and paid',
    showcase: 'never_asked',
    picks: [
      {
        productId: '0gH7IUm',
        domain: 'beachcamera.com',
        quantity: 1,
        agentSays: 'Panasonic 65-inch W80C, {price} at beachcamera.com.',
        // The main image is the energy label; this one shows the TV on a wall.
        photo: '952add9f',
      },
      {
        productId: '1U7pIWX',
        domain: 'lg.com',
        quantity: 1,
        agentSays:
          'You said no, so here is the LG B6 65-inch at {price} from lg.com. Its mount pattern is 200 x 200 mm.',
      },
    ],
  },
];

/** The pick's chosen photo when the record still has it, else the record's main image. */
export function imageOf(record: ProductRecord, photo?: string): string | null {
  const images = record.product.images;
  const chosen = photo ? images.find((i) => i.url.includes(photo)) : undefined;
  return (chosen ?? images.find((i) => i.is_main_image) ?? images[0])?.url ?? null;
}

/** The image of a recorded product, for the Home rows. */
export function recordedImage(productId: string, photo?: string): string {
  const record = ProductRecordSchema.parse(
    JSON.parse(readFileSync(new URL(`${productId}.json`, FIXTURES_DIR), 'utf8')),
  );
  return imageOf(record, photo) ?? '';
}

let listed: Scenario[] | undefined;
/** The scenarios as the API serves them; `image` is the first pick's recorded main image. */
export function scenarioList(): Scenario[] {
  listed ??= SCENARIOS.map(({ picks, ...scenario }) => ({
    ...scenario,
    image: recordedImage(picks[0]?.productId ?? '', picks[0]?.photo),
  }));
  return listed;
}

export function scenarioById(id: string): ScenarioScript | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
