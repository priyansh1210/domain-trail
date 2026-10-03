// Safety gate (spec 014 tech §5.3; FR-ABU-005, FR-ABU-006). Jev's safety answers decide; the keyword rules only
// stand in when Jev could not answer.
import { safety as T } from '@domains-all/config';
import type { Answer } from '@domains-all/jev';
import type { RawFeatures } from '../features/types';

export type SafetyAction = 'allow' | 'refuse' | 'strict_brand';

export function safetyGate(answers: Record<string, Answer>, rules: RawFeatures): SafetyAction {
  const p = (name: string, fallback: number) => {
    const a = answers[name];
    return a?.type === 'noul' ? a.noul : fallback;
  };
  if (
    p('safety_phishing', rules.safety.phishing) >= T.refuseAt ||
    p('safety_illegal', rules.safety.illegal) >= T.refuseAt
  ) {
    return 'refuse';
  }
  if (p('safety_impersonation', rules.safety.impersonation) >= T.strictBrandAt) return 'strict_brand';
  return 'allow';
}
