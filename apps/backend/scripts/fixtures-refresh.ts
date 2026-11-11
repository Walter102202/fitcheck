// Refreshes the recorded Channel3 products, or (--check) compares the live REST shape with
// the recorded MCP shape. Usage:
//   pnpm --filter @fitcheck/backend fixtures:refresh [--check] [--only id1,id2] [--save-raw <dir>]
// Refreshing changes the measurement inputs: the main session decides when to run it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Channel3ProductSchema, type ProductRecord } from '@fitcheck/contracts';
import { FIXTURES_DIR } from '../src/channel3/fixtures.js';
import {
  type Channel3RestClient,
  createChannel3RestClient,
  toChannel3Product,
} from '../src/channel3/rest.js';

type IndexEntry = { id: string; title: string; category: string; recordedOn: string };

export type ShapeDiff = {
  id: string;
  parses: boolean;
  missingInLive: string[];
  newInLive: string[];
  /** Set when the live call itself failed. */
  error?: string;
};

const CHECK_IDS = ['UXXAg59', 'cv7t721', '0gH7IUm'];

function readIndex(dir: string): IndexEntry[] {
  return JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[];
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Re-fetches every product in index.json (or `only`). A failure leaves the file and its entry as they were. */
export async function refreshFixtures(o: {
  client: Channel3RestClient;
  fixturesDir: string;
  now: Date;
  only?: string[];
}): Promise<{ updated: string[]; failed: { id: string; error: string }[] }> {
  const index = readIndex(o.fixturesDir);
  const ids = o.only ?? index.map((e) => e.id);
  const recordedOn = o.now.toISOString().slice(0, 10);
  const updated: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const product = toChannel3Product(await o.client.getProductRaw(id));
      const record: ProductRecord = {
        product,
        fetchedAt: o.now.toISOString(),
        source: 'recorded',
        recordedOn,
      };
      writeJson(join(o.fixturesDir, `${id}.json`), record);
      const entry = index.find((e) => e.id === id);
      if (entry) {
        entry.recordedOn = recordedOn;
        entry.title = product.title;
      }
      updated.push(id);
    } catch (err) {
      failed.push({ id, error: message(err) });
    }
  }
  if (updated.length > 0) writeJson(join(o.fixturesDir, 'index.json'), index);
  return { updated, failed };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function unwrap(raw: unknown): Record<string, unknown> {
  if (isObject(raw) && !('offers' in raw)) {
    if (isObject(raw.product)) return raw.product;
    if (isObject(raw.data)) return raw.data;
  }
  return isObject(raw) ? raw : {};
}

/** Key paths: top level, offers[0].*, offers[0].price.*, offers[0].dimensions.*, variants.*. */
function keyPaths(p: Record<string, unknown>): string[] {
  const out = Object.keys(p);
  const prefixed = (prefix: string, v: unknown) =>
    isObject(v) ? Object.keys(v).map((k) => `${prefix}.${k}`) : [];
  const offer = Array.isArray(p.offers) ? p.offers[0] : undefined;
  out.push(...prefixed('offers[0]', offer));
  if (isObject(offer)) {
    out.push(...prefixed('offers[0].price', offer.price));
    out.push(...prefixed('offers[0].dimensions', offer.dimensions));
  }
  out.push(...prefixed('variants', p.variants));
  return out;
}

export async function checkShapes(o: {
  client: Channel3RestClient;
  fixturesDir: string;
  ids: string[];
  saveRawDir?: string;
}): Promise<ShapeDiff[]> {
  const diffs: ShapeDiff[] = [];
  for (const id of o.ids) {
    const recorded = JSON.parse(readFileSync(join(o.fixturesDir, `${id}.json`), 'utf8')) as {
      product: Record<string, unknown>;
    };
    const recordedKeys = keyPaths(recorded.product);
    try {
      const raw = await o.client.getProductRaw(id);
      if (o.saveRawDir) {
        mkdirSync(o.saveRawDir, { recursive: true });
        writeJson(join(o.saveRawDir, `rest-${id}.json`), raw);
      }
      const live = unwrap(raw);
      const liveKeys = keyPaths(live);
      diffs.push({
        id,
        parses: Channel3ProductSchema.safeParse(live).success,
        missingInLive: recordedKeys.filter((k) => !liveKeys.includes(k)),
        newInLive: liveKeys.filter((k) => !recordedKeys.includes(k)),
      });
    } catch (err) {
      diffs.push({
        id,
        parses: false,
        missingInLive: recordedKeys,
        newInLive: [],
        error: message(err),
      });
    }
  }
  return diffs;
}

function loadRootEnv(): void {
  for (const file of ['./.env', '../.env', '../../.env']) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args: string[]): Promise<number> {
  loadRootEnv();
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) {
    console.error('CHANNEL3_API_KEY is required (root .env).');
    return 1;
  }
  const client = createChannel3RestClient({ apiKey });
  const only = argValue(args, '--only')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const saveRaw = argValue(args, '--save-raw');
  if (args.includes('--check')) {
    const diffs = await checkShapes({
      client,
      fixturesDir: FIXTURES_DIR,
      ids: only ?? CHECK_IDS,
      ...(saveRaw ? { saveRawDir: resolve(saveRaw) } : {}),
    });
    console.log(JSON.stringify(diffs, null, 2));
    return diffs.every((d) => d.parses && !d.error) ? 0 : 1;
  }
  const out = await refreshFixtures({
    client,
    fixturesDir: FIXTURES_DIR,
    now: new Date(),
    ...(only ? { only } : {}),
  });
  console.log(JSON.stringify(out, null, 2));
  return out.failed.length === 0 ? 0 : 1;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(message(err));
      process.exit(1);
    },
  );
}
