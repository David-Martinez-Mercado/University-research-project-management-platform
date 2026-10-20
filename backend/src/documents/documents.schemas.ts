import { DocumentType } from '@prisma/client';
import { z } from 'zod';

// .strict(): the multipart text fields are limited to `type`; anything else is a 400.
export const uploadFieldsSchema = z
  .object({
    type: z.nativeEnum(DocumentType).default('OTHER'),
  })
  .strict();

export const projectIdParamSchema = z.object({ id: z.string().uuid() });
export const documentParamsSchema = z.object({ id: z.string().uuid(), docId: z.string().uuid() });

export type UploadFields = z.infer<typeof uploadFieldsSchema>;
