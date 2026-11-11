import type {
  Attempt,
  CapStatus,
  Check,
  Intent,
  PaymentEventType,
  PaypalCall,
  PaypalMode,
  TaskMemory,
} from '@fitcheck/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The payment ledger: one spending cap (a PayPal authorization) per visitor session,
 * captured in parts. snake_case columns, uuid keys, timestamptz, integer cents.
 */

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () => timestamptz('updated_at').notNull().defaultNow();
const cents = (name: string) => integer(name).notNull();

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  createdAt: createdAt(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
});

export const caps = pgTable(
  'caps',
  {
    id: uuid('id').primaryKey(),
    /** Creation order; a session's latest cap is the highest. */
    seq: integer('seq').generatedAlwaysAsIdentity(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    mode: text('mode').$type<PaypalMode>().notNull(),
    status: text('status').$type<CapStatus>().notNull(),
    amountCents: cents('amount_cents'),
    capturedCents: cents('captured_cents').default(0),
    heldCents: cents('held_cents').default(0),
    orderId: text('order_id').unique(),
    authorizationId: text('authorization_id'),
    authorizedAt: timestamptz('authorized_at'),
    expiresAt: timestamptz('expires_at'),
    reauthorizedAt: timestamptz('reauthorized_at'),
    approveUrl: text('approve_url'),
    returnScenarioId: text('return_scenario_id'),
    fallback: boolean('fallback').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'caps_ledger_check',
      sql`${table.capturedCents} >= 0 and ${table.heldCents} >= 0 and ${table.capturedCents} + ${table.heldCents} <= ${table.amountCents}`,
    ),
  ],
);

export type PurchaseStatus =
  | 'held'
  | 'capturing'
  | 'pending'
  | 'captured'
  | 'not_captured'
  | 'declined';

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey(),
    capId: uuid('cap_id')
      .notNull()
      .references(() => caps.id),
    runId: uuid('run_id').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    productId: text('product_id').notNull(),
    domain: text('domain').notNull(),
    amountCents: cents('amount_cents'),
    status: text('status').$type<PurchaseStatus>().notNull(),
    /** Why it ended unpaid, so a repeated call returns the same result. */
    reason: text('reason').$type<'cap_short' | 'declined' | 'answers' | 'review'>(),
    captureId: text('capture_id'),
    /** `capture:<purchaseId>`, also the PayPal-Request-Id of its one capture. */
    requestId: text('request_id').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [unique('purchases_run_attempt_key').on(table.runId, table.attemptNo)],
);

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey(),
    /** Insertion order, so a run's events read back in the order they happened. */
    seq: integer('seq').generatedAlwaysAsIdentity(),
    capId: uuid('cap_id')
      .notNull()
      .references(() => caps.id),
    purchaseId: uuid('purchase_id'),
    type: text('type').$type<PaymentEventType>().notNull(),
    amountCents: cents('amount_cents'),
    at: timestamptz('at').notNull(),
    sentence: text('sentence').notNull(),
    paypalCall: jsonb('paypal_call').$type<PaypalCall>(),
    paypalId: text('paypal_id'),
  },
  (table) => [
    // A purchase ends once: captured or not captured, never both, never twice.
    uniqueIndex('payment_events_one_terminal')
      .on(table.purchaseId)
      .where(sql`${table.type} in ('captured', 'not_captured')`),
  ],
);

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  scenarioId: text('scenario_id').notNull(),
  review: text('review').$type<'on' | 'off'>().notNull(),
  status: text('status').$type<'awaiting_answers' | 'done'>().notNull(),
  capId: uuid('cap_id')
    .notNull()
    .references(() => caps.id),
  intent: jsonb('intent').$type<Intent>().notNull(),
  checks: jsonb('checks').$type<Check[]>().notNull(),
  attempts: jsonb('attempts').$type<Attempt[]>().notNull(),
  memory: jsonb('memory').$type<TaskMemory>().notNull(),
  notices: jsonb('notices').$type<string[]>().notNull(),
  /** Index of the next scripted pick. */
  cursor: integer('cursor').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paypalEventId: text('paypal_event_id').notNull(),
    eventType: text('event_type').notNull(),
    resourceId: text('resource_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    processedAt: timestamptz('processed_at'),
    result: text('result'),
  },
  (table) => [uniqueIndex('webhook_events_paypal_event_id_key').on(table.paypalEventId)],
);
