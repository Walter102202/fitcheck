import type { ProductRecord } from '@fitcheck/contracts';
import { FIXTURES_DIR, listRecordedProducts, readRecordedProduct } from './fixtures.js';
import {
  type Channel3RestClient,
  createChannel3RestClient,
  toChannel3Product,
  toRequestedProduct,
} from './rest.js';
import { createInMemorySearchCounter, type SearchCounter } from './search-counter.js';

export type Channel3Env = {
  CHANNEL3_MODE: 'live' | 'recorded';
  CHANNEL3_API_KEY?: string;
  CHANNEL3_DAILY_SEARCH_LIMIT: number;
};

export type Channel3Options = {
  fixturesDir?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  searchCounter?: SearchCounter;
  /** Default 8000. */
  timeoutMs?: number;
};

export type SearchResult = { records: ProductRecord[]; source: 'live' | 'recorded' };

export interface Channel3Gateway {
  readonly mode: 'live' | 'recorded';
  /** Live failure falls back to the recording (source 'recorded'); no recording throws Channel3UnavailableError. */
  getProduct(id: string): Promise<ProductRecord>;
  search(query: string, opts?: { limit?: number }): Promise<SearchResult>;
  /** The fallback notice iff the mode is live and the record is the recorded copy. */
  noticeFor(record: ProductRecord): string | null;
}

export class Channel3UnavailableError extends Error {
  readonly productId: string;
  constructor(productId: string, message = `Channel3 has no copy of product ${productId}`) {
    super(message);
    this.name = 'Channel3UnavailableError';
    this.productId = productId;
  }
}

export class Channel3SearchLimitError extends Error {
  constructor(limit: number) {
    super(`The daily Channel3 search limit of ${limit} is reached`);
    this.name = 'Channel3SearchLimitError';
  }
}

const RECORDED_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Channel3 did not answer. Showing the copy recorded on Nov 10, 2026." */
export function fallbackNotice(recordedOn: string): string {
  const date = RECORDED_DATE.format(new Date(`${recordedOn}T00:00:00.000Z`));
  return `Channel3 did not answer. Showing the copy recorded on ${date}.`;
}

const DEFAULT_SEARCH_LIMIT = 10;

export function createChannel3Gateway(
  env: Channel3Env,
  options: Channel3Options = {},
): Channel3Gateway {
  const mode = env.CHANNEL3_MODE;
  const now = options.now ?? (() => new Date());
  const dir = options.fixturesDir ?? FIXTURES_DIR;
  const counter = options.searchCounter ?? createInMemorySearchCounter();

  let rest: Channel3RestClient | null = null;
  if (mode === 'live') {
    if (!env.CHANNEL3_API_KEY) {
      throw new Error('CHANNEL3_API_KEY is required when CHANNEL3_MODE is live');
    }
    rest = createChannel3RestClient({
      apiKey: env.CHANNEL3_API_KEY,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  function recordedCopy(id: string): ProductRecord {
    let record: ProductRecord | null = null;
    try {
      record = readRecordedProduct(id, dir);
    } catch {
      record = null;
    }
    if (!record) throw new Channel3UnavailableError(id);
    return record;
  }

  function liveRecord(raw: unknown): ProductRecord {
    return { product: toChannel3Product(raw), fetchedAt: now().toISOString(), source: 'live' };
  }

  async function getProduct(id: string): Promise<ProductRecord> {
    if (!rest) return recordedCopy(id);
    try {
      const product = toRequestedProduct(id, await rest.getProductRaw(id));
      return { product, fetchedAt: now().toISOString(), source: 'live' };
    } catch {
      // network, timeout, non-2xx (404 included), an unknown shape or another product's answer:
      // use the recording
      return recordedCopy(id);
    }
  }

  async function search(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    const limit = opts.limit ?? DEFAULT_SEARCH_LIMIT;
    if (!rest) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const records = listRecordedProducts(dir)
        .filter((r) => {
          const title = r.product.title.toLowerCase();
          return words.every((w) => title.includes(w));
        })
        .sort((a, b) => (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0))
        .slice(0, limit);
      return { records, source: 'recorded' };
    }
    const day = now().toISOString().slice(0, 10);
    if (!counter.take(day, env.CHANNEL3_DAILY_SEARCH_LIMIT)) {
      throw new Channel3SearchLimitError(env.CHANNEL3_DAILY_SEARCH_LIMIT);
    }
    try {
      const raw = await rest.searchRaw(query, limit);
      const list = Array.isArray(raw)
        ? raw
        : raw !== null && typeof raw === 'object'
          ? (raw as { products?: unknown }).products
          : undefined;
      if (!Array.isArray(list)) throw new Error('Channel3 search answered without products');
      return { records: list.map(liveRecord), source: 'live' };
    } catch (err) {
      // the demo never searches, so there is no recorded fallback for live search
      throw new Channel3UnavailableError(
        '',
        `Channel3 search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    mode,
    getProduct,
    search,
    noticeFor(record) {
      if (mode !== 'live' || record.source !== 'recorded') return null;
      return fallbackNotice(record.recordedOn ?? record.fetchedAt.slice(0, 10));
    },
  };
}
