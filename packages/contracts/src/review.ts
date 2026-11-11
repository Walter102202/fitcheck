import { z } from 'zod';
import { ProductRecordSchema } from './channel3.js';
import { IntentSchema } from './intent.js';
import { CentsSchema } from './money.js';

export const AnswerSchema = z.enum(['yes', 'no', 'dont_know']);
export type Answer = z.infer<typeof AnswerSchema>;

export const RequirementStateSchema = z.enum([
  'backed',
  'unbacked',
  'never_asked',
  'contradictory',
  'broken',
  'not_applicable',
]);
export type RequirementState = z.infer<typeof RequirementStateSchema>;

export const ReasonTypeSchema = z.enum([
  'broken',
  'unbacked',
  'contradictory',
  'never_asked',
  'payment',
]);
export type ReasonType = z.infer<typeof ReasonTypeSchema>;

export const DecisionSchema = z.enum(['capture', 'ask', 'return_to_agent']);
export type Decision = z.infer<typeof DecisionSchema>;

export const OriginSchema = z.enum(['stated', 'triggered', 'always']);
export type Origin = z.infer<typeof OriginSchema>;

export const EvidenceSchema = z.object({
  /** Path grammar of requisitos-common.json, e.g. "key_features[3]", "offer.price.price". */
  path: z.string(),
  /** Plain words: "Title", "Features, line 4", "Store offer, pcrichard.com". */
  label: z.string(),
  /** The field text, or an excerpt of at most 160 characters. */
  text: z.string(),
  /** Highlight range inside `text`; 0,0 when there is nothing to highlight. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  /** Normalized machine value. */
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  /** Ready to show: "65 in", "110-120 V only", "$1,398.00". */
  display: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RequirementResultSchema = z.object({
  requirement: z.string(),
  name: z.string(),
  /** Plain-words fact name for copy: "voltage", "screen size". */
  fact: z.string().optional(),
  origin: OriginSchema,
  /** From the request, for "You said '65-inch'". */
  originQuote: z.string().optional(),
  state: RequirementStateSchema,
  /** Two or more items when contradictory; empty when unbacked. */
  evidence: z.array(EvidenceSchema),
  /** Labels of the fields Fitcheck looked in; required when unbacked. */
  searched: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type RequirementResult = z.infer<typeof RequirementResultSchema>;

/**
 * `lineId` is "<requirementId>=<valueSignature>" when the line is about specific
 * values ("tv.screen_size=55|65", "tv.wall_mount=300x300"), else "<requirementId>".
 * `text` ends with "Is that OK?" or another question.
 */
export const QuestionLineSchema = z.object({
  lineId: z.string(),
  requirement: z.string(),
  type: ReasonTypeSchema,
  text: z.string(),
});
export type QuestionLine = z.infer<typeof QuestionLineSchema>;

/** 1 to 3 lines; title "Before we pay $1,398.00 for this TV". */
export const QuestionCardSchema = z.object({
  title: z.string(),
  lines: z.array(QuestionLineSchema).min(1).max(3),
});
export type QuestionCard = z.infer<typeof QuestionCardSchema>;

/** Answers kept for the whole task, keyed by lineId. */
export const TaskMemorySchema = z.record(z.string(), z.enum(['needed', 'not_needed']));
export type TaskMemory = z.infer<typeof TaskMemorySchema>;

export const VariantSelectedSchema = z.array(z.object({ name: z.string(), label: z.string() }));

export const ReviewInputSchema = z.object({
  intent: IntentSchema,
  record: ProductRecordSchema,
  purchase: z.object({
    purchaseId: z.string(),
    taskId: z.string(),
    productId: z.string(),
    domain: z.string(),
    quantity: z.number().int().positive(),
    priceSeenCents: CentsSchema,
    amountCents: CentsSchema,
    variantSelected: VariantSelectedSchema.optional(),
  }),
  memory: TaskMemorySchema,
  capturedProductIds: z.array(z.string()),
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export const ReviewSummarySchema = z.object({
  backed: z.number().int().nonnegative(),
  unbacked: z.number().int().nonnegative(),
  never_asked: z.number().int().nonnegative(),
  contradictory: z.number().int().nonnegative(),
  broken: z.number().int().nonnegative(),
});

export const ReviewResultSchema = z.object({
  decision: DecisionSchema,
  /** Ordered: stated, triggered, always. */
  results: z.array(RequirementResultSchema),
  /** Present iff decision is 'ask'. */
  card: QuestionCardSchema.optional(),
  /** Present iff decision is 'return_to_agent'. */
  agentMessage: z.string().optional(),
  summary: ReviewSummarySchema,
  /** Structured stop reasons, for the measurement. */
  reasons: z.array(z.object({ requirement: z.string(), type: ReasonTypeSchema })),
  /** Absent only when the review failed closed before any record was obtained. */
  record: z
    .object({
      fetchedAt: z.string(),
      source: z.enum(['live', 'recorded']),
      recordedOn: z.string().optional(),
    })
    .optional(),
  /** The review could not run; decision is return_to_agent. */
  failedClosed: z.literal(true).optional(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
