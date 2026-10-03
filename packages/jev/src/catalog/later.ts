// Stage S2, S5 and S6 questions (questions/catalog.md, v1). Used from milestone M3; defined now so the code
// catalog mirrors catalog.md completely.
import type { ChoiceDef, NoulDef, ScoreDef } from '../types';

export const keywordCore: ChoiceDef = {
  id: 'keyword_core',
  version: 1,
  group: 'keywords',
  type: 'choice',
  instructions: 'Which word or phrase best describes the core product, service or topic of this website?',
  criteria: 'runtime', // t00…t59 → extracted terms
};

export const expansionFit: ChoiceDef = {
  id: 'expansion_fit',
  version: 1,
  group: 'keywords',
  type: 'choice',
  instructions: 'Which of these words would fit most naturally into a name for this website?',
  criteria: 'runtime', // w000…w254 → related words
};

export const rankShard: ChoiceDef = {
  id: 'rank_shard',
  version: 1,
  group: 'rank_r1',
  type: 'choice',
  instructions:
    'Which of these would make the best domain name (without the extension) for the website described? Prefer names that are relevant, memorable, easy to spell and say, and match the tone.',
  criteria: 'runtime', // o000…o249 → candidate labels
};

export const rankFit: ScoreDef = {
  id: 'rank_fit',
  version: 1,
  group: 'rank_r2',
  type: 'score',
  instructions: 'How well does the name "{label}" fit the website described, as its domain name?',
  criteria: [
    'Unrelated or confusing',
    'Weak fit',
    'Acceptable but generic',
    'Good fit',
    'Excellent: relevant, memorable and on-tone',
  ],
};

export const riskBrand: NoulDef = {
  id: 'risk_brand',
  version: 1,
  group: 'rank_r2',
  type: 'noul',
  instructions:
    'The name "{label}" contains, imitates or could easily be confused with an existing well-known brand, company, product or trademark.',
};

export const riskNegative: NoulDef = {
  id: 'risk_negative',
  version: 1,
  group: 'rank_r2',
  type: 'noul',
  instructions:
    'The name "{label}" has an offensive, negative, embarrassing or unintended meaning, including when its words run together.',
};

export const tldFit: ChoiceDef = {
  id: 'tld_fit',
  version: 1,
  group: 'tld_fit',
  type: 'choice',
  instructions: 'Which domain extension would suit this website best?',
  criteria: 'runtime', // tld_<name> → short description from tld_policies
};
