export { FIXTURES_DIR, listRecordedProducts, readRecordedProduct } from './fixtures.js';
export {
  type Channel3Env,
  type Channel3Gateway,
  type Channel3Options,
  Channel3SearchLimitError,
  Channel3UnavailableError,
  createChannel3Gateway,
  fallbackNotice,
  type SearchResult,
} from './gateway.js';
export {
  Channel3HttpError,
  type Channel3RestClient,
  Channel3ShapeError,
  createChannel3RestClient,
  toChannel3Product,
} from './rest.js';
export { createInMemorySearchCounter, type SearchCounter } from './search-counter.js';
