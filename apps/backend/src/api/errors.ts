export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(
    code: string,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details;
  }
}
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
export function notFound(entity: string, id: string): AppError {
  return new AppError(
    `${entity}_not_found`,
    `${entity.charAt(0).toUpperCase()}${entity.slice(1)} ${id} not found`,
    { status: 404 },
  );
}
