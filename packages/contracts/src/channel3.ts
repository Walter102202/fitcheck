import { z } from 'zod';

// The raw Channel3 record, as the API returns it. Unknown keys pass through, so a
// recorded copy keeps every field Channel3 sent.

export const MeasureSchema = z.looseObject({ number: z.number(), unit: z.string() });
export type Measure = z.infer<typeof MeasureSchema>;

export const OfferSchema = z.looseObject({
  url: z.string(),
  domain: z.string(),
  price: z.looseObject({
    price: z.number(),
    compare_at_price: z.number().nullable(),
    currency: z.string(),
  }),
  availability: z.enum(['InStock', 'OutOfStock']),
  condition: z.enum(['new', 'used']).nullable(),
  dimensions: z
    .looseObject({
      length: MeasureSchema.nullable(),
      width: MeasureSchema.nullable(),
      height: MeasureSchema.nullable(),
      weight: MeasureSchema.nullable(),
    })
    .nullable(),
});
export type Offer = z.infer<typeof OfferSchema>;

export const Channel3ProductSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  brands: z.array(z.looseObject({ id: z.string().optional(), name: z.string() })),
  images: z.array(
    z.looseObject({
      url: z.string(),
      cleaned_url: z.string().nullable().optional(),
      is_main_image: z.boolean().nullable().optional(),
    }),
  ),
  category: z.looseObject({ slug: z.string(), title: z.string() }).nullable(),
  key_features: z.array(z.string()).nullable(),
  structured_attributes: z.record(z.string(), z.array(z.string())).nullable(),
  offers: z.array(OfferSchema),
  variants: z
    .looseObject({
      options: z.array(
        z.looseObject({
          name: z.string(),
          values: z.array(z.looseObject({ label: z.string() })),
        }),
      ),
      selected: z.array(z.looseObject({ name: z.string(), label: z.string() })),
    })
    .nullable(),
});
export type Channel3Product = z.infer<typeof Channel3ProductSchema>;

export const ProductRecordSchema = z.object({
  product: Channel3ProductSchema,
  fetchedAt: z.string(),
  source: z.enum(['live', 'recorded']),
  recordedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ProductRecord = z.infer<typeof ProductRecordSchema>;
