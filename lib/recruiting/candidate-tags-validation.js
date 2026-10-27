import { z, zPositiveInt } from '../validate.js';
import {
  CANDIDATE_TAG_COLORS,
  MAX_CANDIDATE_TAGS,
  normalizeCandidateTagFilter,
} from './candidate-tags-core.js';

export const candidateTagBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(40),
  color: z.enum(CANDIDATE_TAG_COLORS),
  active: z.boolean().optional(),
});

export const candidateTagFilterShape = {
  tagIds: z
    .string()
    .max(600)
    .optional()
    .refine((value) => {
      try {
        normalizeCandidateTagFilter({ tagIds: value });
        return true;
      } catch {
        return false;
      }
    }),
  tagMode: z.enum(['any', 'all', 'none']).optional(),
};

export const candidateTagAssignmentSchema = z.object({
  companyId: zPositiveInt.optional(),
  tagIds: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(MAX_CANDIDATE_TAGS),
});
