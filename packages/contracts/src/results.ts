import { z } from 'zod';

export const SquareStateSchema = z.enum(['paid_bad', 'paid_good', 'not_paid', 'pending']);
export type SquareState = z.infer<typeof SquareStateSchema>;

export const ResultsRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  of: z.number().int().nonnegative(),
  /** A count, or a mean such as questions per held purchase (one decimal). */
  capOnly: z.number().nonnegative().nullable(),
  fitcheck: z.number().nonnegative().nullable(),
  squares: z.object({
    capOnly: z.array(SquareStateSchema),
    fitcheck: z.array(SquareStateSchema),
  }),
});
export type ResultsRow = z.infer<typeof ResultsRowSchema>;

export const ResultsJsonSchema = z.object({
  measuredAt: z.string().nullable(),
  model: z.string(),
  recordedOn: z.string(),
  heldOutCommit: z.string().nullable(),
  rows: z.array(ResultsRowSchema),
  notes: z.array(z.string()),
});
export type ResultsJson = z.infer<typeof ResultsJsonSchema>;
