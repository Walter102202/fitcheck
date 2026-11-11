import { z } from 'zod';
import { CentsSchema } from './money.js';

export const PaypalModeSchema = z.enum(['sandbox', 'simulated', 'mock']);
export type PaypalMode = z.infer<typeof PaypalModeSchema>;

export const CapStatusSchema = z.enum([
  'pending_approval',
  'active',
  'exhausted',
  'voided',
  'expired',
]);
export type CapStatus = z.infer<typeof CapStatusSchema>;

/** The per-session spending cap: one PayPal authorization, captured in parts. */
export const CapSchema = z.object({
  capId: z.string(),
  mode: PaypalModeSchema,
  status: CapStatusSchema,
  amountCents: CentsSchema,
  capturedCents: CentsSchema,
  heldCents: CentsSchema,
  /** amount - captured - held */
  availableCents: CentsSchema,
  approveUrl: z.string().optional(),
  authorizationId: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type Cap = z.infer<typeof CapSchema>;

export const PaymentEventTypeSchema = z.enum([
  'authorized',
  'held',
  'captured',
  'not_captured',
  'voided',
  'released',
]);
export type PaymentEventType = z.infer<typeof PaymentEventTypeSchema>;

export const PaypalCallSchema = z.object({
  method: z.enum(['POST', 'GET']),
  /** e.g. "/v2/payments/authorizations/{id}/capture" */
  path: z.string(),
  /** e.g. "final_capture: false" */
  note: z.string().optional(),
});
export type PaypalCall = z.infer<typeof PaypalCallSchema>;

export const PaymentEventSchema = z.object({
  eventId: z.string(),
  purchaseId: z.string().optional(),
  type: PaymentEventTypeSchema,
  amountCents: CentsSchema,
  at: z.string(),
  /** "No capture sent to PayPal." */
  sentence: z.string(),
  /** Null when no PayPal call was made (holds live only in Fitcheck's ledger). */
  paypalCall: PaypalCallSchema.nullable(),
  /** Capture id or authorization id. */
  paypalId: z.string().optional(),
});
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;
