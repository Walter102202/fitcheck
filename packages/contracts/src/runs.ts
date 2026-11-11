import { z } from 'zod';
import { CategorySchema, IntentSchema } from './intent.js';
import { CentsSchema } from './money.js';
import { CapSchema, PaymentEventSchema } from './payments.js';
import { AnswerSchema, OriginSchema, ReviewResultSchema } from './review.js';

export const ShowcaseStateSchema = z.enum([
  'backed',
  'unbacked',
  'never_asked',
  'contradictory',
  'broken',
]);

/** A preset demo purchase. `showcase` is the state chip on its Home row. */
export const ScenarioSchema = z.object({
  id: z.string(),
  category: CategorySchema,
  request: z.string(),
  title: z.string(),
  image: z.string(),
  shows: z.string(),
  endsIn: z.string(),
  showcase: ShowcaseStateSchema,
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const AgentPickSchema = z.object({
  productId: z.string(),
  title: z.string(),
  domain: z.string(),
  priceCents: CentsSchema,
  image: z.string().nullable(),
  agentSays: z.string(),
});
export type AgentPick = z.infer<typeof AgentPickSchema>;

export const AttemptSchema = z.object({
  attemptNo: z.number().int().positive(),
  pick: AgentPickSchema,
  review: ReviewResultSchema,
  /** lineId -> answer, once sent. */
  answers: z.record(z.string(), AnswerSchema).optional(),
  /**
   * Set after the review or the answers. `amountCents` is the amount captured, so it
   * is 0 when the purchase returns to the agent. `agentMessage` is the text sent to
   * the agent when returned.
   */
  outcome: z
    .object({
      decision: z.enum(['capture', 'return_to_agent']),
      amountCents: CentsSchema,
      agentMessage: z.string().optional(),
    })
    .optional(),
  /** What the same purchase would do with a spending cap only (review off). */
  capOnly: z.object({
    outcome: z.enum(['captured', 'not_captured']),
    amountCents: CentsSchema,
    sentence: z.string(),
  }),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const CheckSchema = z.object({
  requirement: z.string(),
  name: z.string(),
  fact: z.string().optional(),
  origin: OriginSchema,
  originQuote: z.string().optional(),
});
export type Check = z.infer<typeof CheckSchema>;

export const RunResponseSchema = z.object({
  runId: z.string(),
  scenarioId: z.string(),
  review: z.enum(['on', 'off']),
  intent: IntentSchema,
  /** Step 1, "What Fitcheck will check". Empty when the request could not be read. */
  checks: z.array(CheckSchema),
  attempts: z.array(AttemptSchema),
  status: z.enum(['awaiting_answers', 'done']),
  cap: CapSchema,
  events: z.array(PaymentEventSchema),
  notices: z.array(z.string()),
});
export type RunResponse = z.infer<typeof RunResponseSchema>;

export const RunCreateRequestSchema = z.object({
  scenarioId: z.string(),
  review: z.enum(['on', 'off']),
});
export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;

export const AnswersRequestSchema = z.object({
  attemptNo: z.number().int().positive(),
  answers: z.record(z.string(), AnswerSchema),
});
export type AnswersRequest = z.infer<typeof AnswersRequestSchema>;
