// Search request (spec 001 tech §4; FR-INT-002). Server-side validation; the browser checks length itself.
import { intake } from '@domains-all/config/defaults';
import * as z from 'zod/mini';
import { normalize } from './normalize';
import { PreferencesSchema } from './schema';

/** Description rule shared by client and server: length is checked after normalizing (FR-INT-002). */
export const DescriptionSchema = z.pipe(
  z.pipe(
    z.string(),
    z.transform((s: string) => normalize(s).text),
  ),
  z
    .string()
    .check(
      z.minLength(intake.descriptionMin, `Please write at least ${intake.descriptionMin} characters`),
      z.maxLength(intake.descriptionMax, `Please keep it under ${intake.descriptionMax} characters`),
    ),
);

export const SearchRequestSchema = z.object({
  description: DescriptionSchema,
  preferences: z._default(PreferencesSchema, () => PreferencesSchema.parse({})),
  turnstileToken: z.string().check(z.minLength(1), z.maxLength(4096)),
  clientRequestId: z.uuid(), // idempotency
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
