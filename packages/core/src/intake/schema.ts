// Search preferences (spec 001 tech §4; FR-INT-004, 005). The same schema validates the form in the browser and the
// request on the server. Built with `zod/mini` and kept apart from the request schema so the home page stays within
// its JavaScript budget (NFR-INT-004).
import { intake } from '@domains-all/config/defaults';
import * as z from 'zod/mini';

const d = intake.preferenceDefaults;
const int = (min: number, max?: number) =>
  z.number().check(z.int(), z.minimum(min), ...(max === undefined ? [] : [z.maximum(max)]));

export const PreferencesSchema = z
  .object({
    preferredTlds: z._default(
      z.array(z.string().check(z.regex(/^[a-z0-9-]+(\.[a-z0-9-]+)?$/))).check(z.maxLength(20)),
      [],
    ),
    maxLength: z._default(int(intake.maxLabelLengthRange[0], intake.maxLabelLengthRange[1]), d.maxLength),
    allowHyphens: z._default(z.boolean(), d.allowHyphens),
    allowDigits: z._default(z.boolean(), d.allowDigits),
    country: z._default(z.string().check(z.regex(/^(auto|global|[a-z]{2})$/)), d.country),
    priceMinCents: z._default(int(0), 0),
    priceMaxCents: z._default(z.nullable(int(0)), null), // null = no upper limit
    includeFree: z._default(z.boolean(), d.includeFree),
    forceSearch: z._default(z.boolean(), false), // "Search anyway" after the vague prompt
  })
  .check(
    z.refine((p) => p.priceMaxCents === null || p.priceMaxCents >= p.priceMinCents, {
      message: 'Maximum price must be at least the minimum price',
      path: ['priceMaxCents'],
    }),
  );

export type Preferences = z.infer<typeof PreferencesSchema>;
