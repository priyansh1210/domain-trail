// Reason texts for results (spec 008 tech §5.6). Reason ids and values come from the server; words live in the
// message file (FR-UX-019).
import type { Reason } from '@domains-all/core/client';
import { messages, t } from './i18n';
import { geoLabel } from './labels';

export function reasonText(r: Reason): string {
  const vars = { ...r.vars } as Record<string, string | number>;
  if (r.id === 'tld_fit')
    vars.feature = ((messages.chips.flags as Record<string, string>)[String(vars.flag)] ?? '').toLowerCase();
  if (r.id === 'local') vars.place = geoLabel(String(vars.geo));
  return t(`reasons.${r.id}`, vars);
}
