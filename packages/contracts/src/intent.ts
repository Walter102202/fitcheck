import { z } from 'zod';
import { CentsSchema } from './money.js';

export const CategorySchema = z.enum(['tv', 'hair_dryer']);
export type Category = z.infer<typeof CategorySchema>;

/** What the buyer asked, as values on the checklist. Quotes are verbatim from the request. */
export const IntentSchema = z.object({
  category: CategorySchema,
  request: z.string(),
  budgetCents: CentsSchema.optional(),
  quantity: z.number().int().positive().default(1),
  acceptUsed: z.boolean().default(false),
  /** Allowed store domains; absent means any store. */
  stores: z.array(z.string()).optional(),
  /** Requirement id -> stated value and the verbatim quote it came from. */
  stated: z.record(
    z.string(),
    z.object({ value: z.union([z.string(), z.number(), z.boolean()]), quote: z.string() }),
  ),
  /** Requirement id -> the verbatim cue in the request that triggers it. */
  triggered: z.record(z.string(), z.object({ quote: z.string() })),
  /** Human labels of what Fitcheck does not check, e.g. "shipping", "returns". */
  notChecked: z.array(z.string()),
  source: z.enum(['model', 'recorded']),
});
export type Intent = z.infer<typeof IntentSchema>;
