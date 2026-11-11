// The semantic schema of the checklist data (packages/checklists/*.json). Objects are loose,
// so data keys the review does not read are kept.
import { ReasonTypeSchema } from '@fitcheck/contracts';
import { z } from 'zod';

export const FactSpecSchema = z.looseObject({
  type: z.enum(['number', 'enum', 'orderedEnum', 'boolean']),
  normalizer: z.string().min(1),
  evidence: z.array(z.string()).min(1),
  /** Plain-words fact name: "voltage", "screen size". */
  label: z.string().min(1),
  unit: z.string().optional(),
  exclusive: z.boolean().optional(),
  tolerance: z.number().nonnegative().optional(),
  values: z.array(z.string()).optional(),
  semantics: z.literal('max').optional(),
  synonyms: z.record(z.string(), z.array(z.string())).optional(),
  contradictionScan: z.array(z.string()).optional(),
});

export const AppliesWhenSchema = z.union([
  z.looseObject({ always: z.literal(true) }),
  z.looseObject({ intentHas: z.string(), orCues: z.array(z.string()).optional() }),
  z.looseObject({ cues: z.array(z.string()).min(1), unlessAlsoApplies: z.string().optional() }),
  z.looseObject({ productHas: z.string() }),
]);

export const FactTestSchema = z.looseObject({
  fact: z.string(),
  op: z.enum(['eq', 'in', 'max', 'min', 'fitsWithin']),
  value: z.unknown().optional(),
  valueFrom: z.string().optional(),
  tolerance: z.number().nonnegative().optional(),
  multiplyBy: z.string().optional(),
  orIntentFlag: z.string().optional(),
  andIn: z.string().optional(),
  default: z.unknown().optional(),
});

export const TestSpecSchema = z.union([
  FactTestSchema,
  z.looseObject({ everyOptionNamed: z.array(z.string()).min(1), mustBeIn: z.string() }),
  z.looseObject({ noEarlierCaptureFor: z.string(), within: z.string() }),
]);

export const RequirementSpecSchema = z.looseObject({
  id: z.string().regex(/^(common|tv|hair_dryer)\.[a-z0-9_]+$/),
  name: z.string().min(1),
  origin: z.enum(['stated', 'triggered', 'unasked', 'always']),
  reasonType: ReasonTypeSchema.optional(),
  appliesWhen: AppliesWhenSchema,
  askWhen: z.looseObject({ always: z.literal(true) }).optional(),
  test: TestSpecSchema.optional(),
  check: z.enum(['code', 'code_with_model_citation']),
  ifMissing: z.enum(['ask', 'return_to_agent']).optional(),
  onBroken: z.enum(['ask', 'return_to_agent']),
  reasonTemplate: z.string().optional(),
  line: z.partialRecord(ReasonTypeSchema, z.string()).optional(),
  whenStatedValue: z.string().optional(),
});

export const OutOfScopeSchema = z.looseObject({ id: z.string(), name: z.string() });

export const ChecklistFileSchema = z.looseObject({
  category: z.enum(['common', 'tv', 'hair_dryer']),
  channel3CategorySlugs: z.array(z.string()).optional(),
  facts: z.record(z.string(), FactSpecSchema),
  requirements: z.array(RequirementSpecSchema),
  outOfScope: z.array(OutOfScopeSchema).default([]),
});

export type FactSpec = z.infer<typeof FactSpecSchema>;
export type AppliesWhen = z.infer<typeof AppliesWhenSchema>;
export type FactTest = z.infer<typeof FactTestSchema>;
export type TestSpec = z.infer<typeof TestSpecSchema>;
export type RequirementSpec = z.infer<typeof RequirementSpecSchema>;
export type ChecklistFile = z.infer<typeof ChecklistFileSchema>;
