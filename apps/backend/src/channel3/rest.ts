import { type Channel3Product, Channel3ProductSchema } from '@fitcheck/contracts';

export const CHANNEL3_BASE_URL = 'https://api.trychannel3.com';
export const DEFAULT_TIMEOUT_MS = 8000;

export class Channel3HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'Channel3HttpError';
    this.status = status;
  }
}

export class Channel3ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Channel3ShapeError';
  }
}

export type Channel3RestClient = {
  /** `GET /v1/products/{id}`: free. */
  getProductRaw(id: string): Promise<unknown>;
  /** `POST /v1/search`: costs 1 credit. */
  searchRaw(query: string, limit: number): Promise<unknown>;
};

export function createChannel3RestClient(o: {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Channel3RestClient {
  const doFetch = o.fetch ?? fetch;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('x-api-key', o.apiKey);
    headers.set('accept', 'application/json');
    const res = await doFetch(`${CHANNEL3_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Channel3HttpError(res.status, `Channel3 answered ${res.status} for ${path}`);
    }
    return res.json();
  }

  return {
    getProductRaw: (id) => call(`/v1/products/${encodeURIComponent(id)}`, { method: 'GET' }),
    searchRaw: (query, limit) =>
      call('/v1/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, limit }),
      }),
  };
}

/** The product itself, or the one under `product` or `data`; anything else is a Channel3ShapeError. */
export function toChannel3Product(raw: unknown): Channel3Product {
  const direct = Channel3ProductSchema.safeParse(raw);
  if (direct.success) return direct.data;
  if (raw !== null && typeof raw === 'object') {
    for (const key of ['product', 'data'] as const) {
      const inner = (raw as Record<string, unknown>)[key];
      if (inner !== undefined) {
        const parsed = Channel3ProductSchema.safeParse(inner);
        if (parsed.success) return parsed.data;
      }
    }
  }
  const issues = direct.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  throw new Channel3ShapeError(`Unknown Channel3 product shape: ${issues}`);
}
