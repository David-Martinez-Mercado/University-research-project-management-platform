import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000);
const maxScore = z.number().int().min(1).max(100);
// DECIMAL(5,2): at most 2 decimals. Extra precision is rejected instead of silently rounded.
const weight = z
  .number()
  .min(0.01)
  .max(99.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'weight must have at most 2 decimal places');
const position = z.number().int().min(0).max(100_000);

// .strict(): unknown keys (createdById, id, ...) are a 400, never silently ignored.
export const createCriterionSchema = z
  .object({
    name,
    description: description.nullable().optional(),
    maxScore: maxScore.default(10),
    weight: weight.default(1),
    position: position.default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateCriterionSchema = z
  .object({
    name,
    description: description.nullable(),
    maxScore,
    weight,
    position,
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const listCriteriaQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const criterionIdParamSchema = z.object({ id: z.string().uuid() });
export const projectIdParamSchema = z.object({ id: z.string().uuid() });

export type CreateCriterionInput = z.infer<typeof createCriterionSchema>;
export type UpdateCriterionInput = z.infer<typeof updateCriterionSchema>;
