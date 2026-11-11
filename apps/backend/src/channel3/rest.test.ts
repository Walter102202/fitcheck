import { describe, expect, it } from 'vitest';
import { readRecordedProduct } from './fixtures.js';
import {
  Channel3HttpError,
  Channel3ShapeError,
  createChannel3RestClient,
  toChannel3Product,
} from './rest.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function recorded(id: string) {
  const r = readRecordedProduct(id);
  if (!r) throw new Error(`missing fixture ${id}`);
  return r.product;
}

describe('toChannel3Product', () => {
  it('accepts the recorded MCP shape', () => {
    const p = recorded('UXXAg59');
    expect(toChannel3Product(structuredClone(p))).toEqual(p);
  });

  it('unwraps product and data envelopes', () => {
    const p = recorded('cv7t721');
    expect(toChannel3Product({ product: p }).id).toBe('cv7t721');
    expect(toChannel3Product({ data: p }).id).toBe('cv7t721');
  });

  it('throws Channel3ShapeError when offers are missing', () => {
    expect(() => toChannel3Product({ id: 'x', title: 't' })).toThrow(Channel3ShapeError);
  });

  it('throws Channel3ShapeError on a non-object', () => {
    expect(() => toChannel3Product('nope')).toThrow(Channel3ShapeError);
    expect(() => toChannel3Product(null)).toThrow(Channel3ShapeError);
  });
});

describe('createChannel3RestClient', () => {
  it('GETs /v1/products/{id} with x-api-key', async () => {
    const calls: Call[] = [];
    const client = createChannel3RestClient({
      apiKey: 'k',
      fetch: fakeFetch(200, recorded('UXXAg59'), calls),
    });
    await client.getProductRaw('UXXAg59');
    expect(calls[0]?.url).toBe('https://api.trychannel3.com/v1/products/UXXAg59');
    expect(new Headers(calls[0]?.init.headers).get('x-api-key')).toBe('k');
    expect(calls[0]?.init.method ?? 'GET').toBe('GET');
  });

  it('POSTs /v1/search with the query and limit', async () => {
    const calls: Call[] = [];
    const client = createChannel3RestClient({ apiKey: 'k', fetch: fakeFetch(200, [], calls) });
    await client.searchRaw('travel hair dryer', 5);
    expect(calls[0]?.url).toBe('https://api.trychannel3.com/v1/search');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: 'travel hair dryer',
      limit: 5,
    });
  });

  it('throws Channel3HttpError on non-2xx', async () => {
    const client = createChannel3RestClient({ apiKey: 'k', fetch: fakeFetch(500, {}) });
    await expect(client.getProductRaw('x')).rejects.toMatchObject({ status: 500 });
    await expect(client.getProductRaw('x')).rejects.toBeInstanceOf(Channel3HttpError);
  });
});
