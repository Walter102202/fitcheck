import { z } from 'zod';

export const SquareStateSchema = z.enum(['paid_bad', 'paid_good', 'not_paid', 'pending']);
export type SquareState = z.infer<typeof SquareStateSchema>;

export const ResultsRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  of: z.number().int().nonnegative(),
  /**
   * "mean": the values are averages, shown alone ("1.2", not "1.2 of 9"); a null capOnly means
   * "does not apply" and a null fitcheck means "not measured yet". Absent means "count", where
   * null means "not measured yet".
   */
  unit: z.enum(['count', 'mean']).optional(),
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
