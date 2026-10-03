// Jev answers → site profile (spec 003 tech §1, §5.2, §5.6; FR-FEAT-001…010, 012, 015). Fields Jev could not
// answer come from the rule-based detector and say so; user preferences override detected values.
import { COUNTRIES, FLAG_STATEMENTS, type Answer, type FeatureFlag } from '@domains-all/jev';
import { features as T } from '@domains-all/config';
import type { Preferences } from '../intake/schema';
import type { Detected, RawFeatures, SensitiveCategory, SiteProfile } from './types';

type Answers = Record<string, Answer>;

function alternatives(probs: Record<string, number>, value: string) {
  return Object.entries(probs)
    .filter(([k, p]) => k !== value && p >= T.alternativesMinP)
    .sort((a, b) => b[1] - a[1])
    .slice(0, T.alternativesMax)
    .map(([k, p]) => ({ value: k, p }));
}

function choiceField(name: string, answers: Answers, rules: Record<string, number>): Detected {
  const a = answers[name];
  if (a?.type === 'choice') {
    return {
      value: a.choice,
      confidence: a.confidence,
      alternatives: alternatives(a.probabilities, a.choice),
      edited: false,
      source: 'jev',
      unsure: a.confidence < T.unsureConfidence,
    };
  }
  const [value, p] = Object.entries(rules).sort((x, y) => y[1] - x[1])[0] ?? ['other', 1];
  const confidence = Math.min(p, T.rulesConfidence);
  return {
    value,
    confidence,
    alternatives: alternatives(rules, value),
    edited: false,
    source: 'rules',
    unsure: confidence < T.unsureConfidence,
  };
}

const noul = (answers: Answers, name: string, fallback: number): number => {
  const a = answers[name];
  return a?.type === 'noul' ? a.noul : fallback;
};

const score = (answers: Answers, name: string): number | undefined => {
  const a = answers[name];
  return a?.type === 'score' ? a.score : undefined;
};

/** A country preference (FR-INT-004) wins over detection (FR-FEAT-012). */
function geoOverride(country: string): Detected | null {
  if (country === 'auto') return null;
  const value = country === 'global' ? 'global' : COUNTRIES[country] ? `country_${country}` : 'other_country';
  return { value, confidence: 1, alternatives: [], edited: true, source: 'user', unsure: false };
}

export function interpretFeatures(input: {
  answers: Answers;
  rules: RawFeatures;
  prefs: Pick<Preferences, 'country'>;
  refs: Record<string, string>;
}): SiteProfile {
  const { answers, rules, prefs } = input;

  const toneScore = score(answers, 'tone');
  const tone = toneScore ?? rules.tone;
  const toneConfidence = answers.tone?.type === 'score' ? answers.tone.confidence : T.rulesConfidence;
  const clarity = score(answers, 'clarity') ?? rules.clarity;

  const flags = Object.fromEntries(
    Object.keys(FLAG_STATEMENTS).map((flag) => {
      const p = noul(answers, flag, rules.flags[flag] ?? 0.1);
      return [flag, { p, on: p >= T.flagOn, edited: false }];
    }),
  ) as SiteProfile['flags'];

  const sensitive: SensitiveCategory[] = [];
  if (noul(answers, 'safety_adult', rules.safety.adult) >= T.adultOn) sensitive.push('adult');
  if (rules.gambling) sensitive.push('gambling');
  const on = (f: FeatureFlag) => flags[f]?.on;
  if (on('feat_crypto')) sensitive.push('crypto');
  if (on('feat_health')) sensitive.push('health');
  if (on('feat_finance')) sensitive.push('finance');

  const profileQuestions = [
    'site_type',
    'industry',
    'audience',
    'geo_scope',
    'language',
    'name_style',
    'tone',
    'clarity',
  ];
  const anyJev = profileQuestions.some((q) => answers[q]) || Object.keys(flags).some((f) => answers[f]);

  const catalogVersions = Object.fromEntries(
    Object.values(input.refs).map((ref) => {
      const [id, v] = ref.split('@');
      return [id!, Number(v)];
    }),
  );

  return {
    siteType: choiceField('site_type', answers, rules.siteType),
    industry: choiceField('industry', answers, rules.industry),
    audience: choiceField('audience', answers, rules.audience),
    geo: geoOverride(prefs.country) ?? choiceField('geo_scope', answers, rules.geo),
    language: choiceField('language', answers, rules.language),
    tone: {
      score: tone,
      level: Math.max(0, Math.min(4, Math.round(tone))) as 0 | 1 | 2 | 3 | 4,
      confidence: toneConfidence,
      edited: false,
      source: toneScore === undefined ? 'rules' : 'jev',
    },
    nameStyle: choiceField('name_style', answers, rules.nameStyle),
    clarity: { score: clarity, tooVague: clarity < T.clarityVagueBelow },
    flags,
    sensitive,
    source: anyJev ? 'jev' : 'rules',
    catalogVersions,
  };
}
