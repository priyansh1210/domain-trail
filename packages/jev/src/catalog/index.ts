import type { QuestionDef } from '../types';
import { expansionFit, keywordCore, rankFit, rankShard, riskBrand, riskNegative, tldFit } from './later';
import { flags, profile, safety } from './s1';

export * from './later';
export * from './s1';

/** Every question the product may ask Jev, in catalog order. */
export const CATALOG: readonly QuestionDef[] = [
  ...safety,
  ...profile,
  ...flags,
  keywordCore,
  expansionFit,
  rankShard,
  rankFit,
  riskBrand,
  riskNegative,
  tldFit,
];

export function questionById(id: string): QuestionDef {
  const def = CATALOG.find((q) => q.id === id);
  if (!def) throw new Error(`unknown question id: ${id}`);
  return def;
}
