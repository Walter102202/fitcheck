export const FAIL_CLOSED_MESSAGE = 'Fitcheck could not check this listing.';
export const OVERFLOW_MESSAGE =
  'Too many points in this listing cannot be verified; choose a better documented offer.';

/** Every return_to_agent message starts with this, except fail closed. */
export const NOT_PAID_PREFIX = 'Not paid. ';

export function notPaid(message: string): string {
  return `${NOT_PAID_PREFIX}${message}`;
}

export type ReviewUnavailableReason =
  | 'model_error'
  | 'invalid_output'
  | 'no_recording'
  | 'channel3';

/** The review cannot run; the caller fails closed and does not capture. */
export class ReviewUnavailableError extends Error {
  readonly reason: ReviewUnavailableReason;
  constructor(reason: ReviewUnavailableReason, message?: string, options?: { cause?: unknown }) {
    super(message ?? `Review unavailable: ${reason}`, options);
    this.name = 'ReviewUnavailableError';
    this.reason = reason;
  }
}
