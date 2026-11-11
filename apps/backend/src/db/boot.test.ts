import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logger.js';
import { isConnectionError, migrateWhenReady } from './boot.js';
import type { Db } from './client.js';

const db = {} as Db;
const silent = createLogger({}, { silent: true });
const noSleep = async () => {};

function refused(): Error {
  // Shape of the error drizzle raises when `pg` cannot reach the server: the
  // DrizzleQueryError wraps the socket error in `cause`.
  const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
    code: 'ECONNREFUSED',
  });
  return Object.assign(new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"'), {
    cause,
  });
}

describe('isConnectionError', () => {
  it('recognises socket errors directly and through cause', () => {
    expect(isConnectionError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isConnectionError(refused())).toBe(true);
    expect(isConnectionError(Object.assign(new Error('x'), { code: '57P03' }))).toBe(true);
  });

  it('does not treat other failures as connection errors', () => {
    expect(isConnectionError(new Error('syntax error at or near "CREATE"'))).toBe(false);
    expect(isConnectionError(Object.assign(new Error('x'), { code: '42601' }))).toBe(false);
    expect(isConnectionError('nope')).toBe(false);
  });
});

describe('migrateWhenReady', () => {
  it('migrates once when the database answers', async () => {
    const migrate = vi.fn(async () => {});
    await migrateWhenReady(db, silent, { migrate, sleep: noSleep });
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it('retries while the database refuses connections, then succeeds', async () => {
    const migrate = vi
      .fn<(db: Db) => Promise<void>>()
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async () => {});
    const warn = vi.fn();
    await migrateWhenReady(db, { ...silent, warn }, { migrate, sleep, attempts: 5, delayMs: 250 });
    expect(migrate).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(warn).toHaveBeenCalledWith(
      'db.not_ready',
      expect.objectContaining({ attempt: 1, attempts: 5 }),
    );
  });

  it('gives up after the last attempt with the original error', async () => {
    const error = refused();
    const migrate = vi.fn(async () => {
      throw error;
    });
    await expect(
      migrateWhenReady(db, silent, { migrate, sleep: noSleep, attempts: 3 }),
    ).rejects.toBe(error);
    expect(migrate).toHaveBeenCalledTimes(3);
  });

  it('does not retry a migration that fails for another reason', async () => {
    const error = new Error('relation "quotes" already exists');
    const migrate = vi.fn(async () => {
      throw error;
    });
    const sleep = vi.fn(async () => {});
    await expect(migrateWhenReady(db, silent, { migrate, sleep })).rejects.toBe(error);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
