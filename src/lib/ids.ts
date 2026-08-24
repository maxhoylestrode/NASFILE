import { z } from 'zod';

export const uuidParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, 'name must not be empty')
  .max(255, 'name must be at most 255 characters');
