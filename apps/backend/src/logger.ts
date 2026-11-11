type Fields = Record<string, unknown>;
export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}
const SECRET_KEYS = /^(token|authorization|secret|password|clientSecret|apiKey)$/i;
export function redact(fields: Fields): Fields {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value !== null && typeof value === 'object') return redact(value as Fields);
    return value;
  };
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      SECRET_KEYS.test(key) ? '[redacted]' : visit(value),
    ]),
  );
}
export function createLogger(bindings: Fields = {}, options: { silent?: boolean } = {}): Logger {
  const write = (level: string, msg: string, fields: Fields = {}) => {
    if (!options.silent)
      process.stdout.write(
        `${JSON.stringify(redact({ ...bindings, ...fields, level, time: new Date().toISOString(), msg }))}\n`,
      );
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }, options),
  };
}
