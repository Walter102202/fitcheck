import { ZodError } from 'zod';

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

/**
 * One sentence a visitor can read. A ZodError's own message is the issue list as JSON, and a
 * failed fetch is a bare TypeError, so neither is shown as it is.
 */
export function readableError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof ZodError) return 'The server’s reply did not match what this page expects.';
  if (error instanceof TypeError) return 'The server did not answer.';
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}
