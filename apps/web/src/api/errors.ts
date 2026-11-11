/** A reply outside 2xx. `code` is the API's snake_case code, or 'http_error'. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
