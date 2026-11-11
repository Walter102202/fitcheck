export const FAIL_CLOSED_MESSAGE = 'Fitcheck could not check this listing.';
export const OVERFLOW_MESSAGE =
  'Too many points in this listing cannot be verified; choose a better documented offer.';

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
