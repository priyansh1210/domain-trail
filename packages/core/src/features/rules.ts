// Rule-based feature detection (spec 003 tech §5.5, FR-FEAT-014): used when Jev is unavailable, for questions
// Jev failed to answer, and as the source of mock answers in MOCK_EXTERNALS mode.
import { analyze } from './nlp';
import { TAXONOMY } from './seed/taxonomy';
import {
  FLAG_KEYWORDS,
  GAMBLING_WORDS,
  GAZETTEER,
  REGION_WORDS,
  SAFETY_PATTERNS,
  SITE_TYPE_KEYWORDS,
} from './seed/signals';
import type { RawFeatures } from './types';

type Analysis = ReturnType<typeof analyze>;

function hits(a: Analysis, words: readonly string[]): number {
  let n = 0;
  for (const w of words) if (w.includes(' ') ? a.lower.includes(` ${w} `) : a.lemmas.has(w)) n++;
  return n;
}

/** Scores → distribution. Equal top scores mean "unclear" and resolve to `fallbackKey` (spec: ties → other). */
function distribution(scores: Record<string, number>, fallbackKey: string): Record<string, number> {
  const ranked = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((x, y) => y[1] - x[1]);
  if (ranked.length === 0 || (ranked[1] && ranked[1][1] === ranked[0]![1])) return { [fallbackKey]: 1 };
  const top = ranked.slice(0, 4);
  const sum = top.reduce((acc, [, s]) => acc + s, 0);
  return Object.fromEntries(top.map(([k, s]) => [k, s / sum]));
}

const SCRIPTS: Array<[RegExp, string]> = [
  [/[\u3040-\u30FF]/, 'ja'],
  [/[\uAC00-\uD7AF]/, 'ko'],
  [/[\u4E00-\u9FFF]/, 'zh'],
  [/[\u0900-\u097F]/, 'hi'],
  [/[\u0980-\u09FF]/, 'bn'],
  [/[\u0B80-\u0BFF]/, 'ta'],
  [/[\u0C00-\u0C7F]/, 'te'],
  [/[\u0600-\u06FF]/, 'ar'],
  [/[\u0E00-\u0E7F]/, 'th'],
  [/[\u0400-\u04FF]/, 'ru'],
];

const LATIN_STOPWORDS: Record<string, string[]> = {
  es: ['el', 'la', 'los', 'las', 'una', 'para', 'con', 'que', 'del', 'por', 'tienda', 'y'],
  pt: ['o', 'os', 'uma', 'para', 'com', 'que', 'do', 'da', 'loja', 'não', 'em'],
  fr: ['le', 'la', 'les', 'une', 'pour', 'avec', 'des', 'du', 'et', 'est', 'boutique'],
  de: ['der', 'die', 'das', 'und', 'ein', 'eine', 'für', 'mit', 'ist', 'zu'],
  it: ['il', 'lo', 'gli', 'una', 'per', 'con', 'che', 'della', 'negozio', 'e'],
  nl: ['de', 'het', 'een', 'voor', 'met', 'en', 'van', 'winkel'],
  id: ['yang', 'dan', 'untuk', 'dengan', 'toko', 'di', 'kami'],
  tr: ['ve', 'bir', 'için', 'ile', 'bu', 'mağaza'],
  pl: ['i', 'w', 'na', 'dla', 'z', 'sklep', 'jest'],
  vi: ['và', 'của', 'cho', 'với', 'cửa', 'hàng'],
};

function detectLanguage(text: string): string {
  for (const [re, lang] of SCRIPTS) if (re.test(text)) return lang;
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const en = ['the', 'and', 'for', 'with', 'our', 'that', 'online', 'website', 'a', 'of', 'to'];
  let best = 'en';
  let bestScore = words.filter((w) => en.includes(w)).length;
  for (const [lang, stop] of Object.entries(LATIN_STOPWORDS)) {
    const score = words.filter((w) => stop.includes(w)).length;
    if (score > bestScore + 1) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

function detectGeo(a: Analysis): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [iso, places] of Object.entries(GAZETTEER)) {
    const n = places.filter(
      (p) => a.lower.includes(` ${p} `) || a.lower.includes(` ${p},`) || a.lower.includes(` ${p}.`),
    ).length;
    if (n) scores[`country_${iso}`] = n;
  }
  if (Object.keys(scores).length === 0) {
    for (const [word, key] of Object.entries(REGION_WORDS)) {
      if (a.lower.includes(` ${word} `) || a.lower.includes(` ${word}.`) || a.lower.includes(` ${word},`)) {
        scores[key] = (scores[key] ?? 0) + 1;
      }
    }
  }
  const dist = distribution(scores, 'global');
  return Object.keys(scores).length ? dist : { global: 1 };
}

const AUDIENCE_FROM_FLAGS: Array<[string, string]> = [
  ['feat_developer', 'developers'],
  ['feat_kids', 'families_kids'],
  ['feat_school', 'students'],
  ['feat_courses', 'students'],
  ['feat_gaming', 'gamers'],
  ['feat_health', 'patients'],
  ['feat_travel', 'travelers'],
  ['feat_donations', 'donors_volunteers'],
  ['feat_nonprofit', 'donors_volunteers'],
  ['feat_b2b', 'small_businesses'],
  ['feat_local', 'local_community'],
  ['feat_crypto', 'investors'],
];

const ADULT_WORDS = ['porn', 'xxx', 'sex', 'erotic', 'nsfw', 'adult', 'escort', 'camgirl'];

export function detectByRules(description: string): RawFeatures {
  const a = analyze(description);
  const wordCount = Math.max(a.words, (description.match(/[\p{L}\p{N}]+/gu) ?? []).length);

  const flags: Record<string, number> = {};
  for (const [flag, words] of Object.entries(FLAG_KEYWORDS)) flags[flag] = hits(a, words) > 0 ? 0.7 : 0.1;

  const siteScores: Record<string, number> = {};
  for (const [type, words] of Object.entries(SITE_TYPE_KEYWORDS)) siteScores[type] = hits(a, words);
  const industryScores: Record<string, number> = {};
  for (const i of TAXONOMY) industryScores[i.key] = hits(a, i.keywords);

  const audience = AUDIENCE_FROM_FLAGS.find(([flag]) => flags[flag]! >= 0.7)?.[1] ?? 'consumers_general';
  const refuse = SAFETY_PATTERNS.refuse.some((re) => re.test(description));
  const strict = SAFETY_PATTERNS.strictBrand.some((re) => re.test(description));

  return {
    siteType: distribution(siteScores, 'other'),
    industry: distribution(industryScores, 'other__other'),
    audience: { [audience]: 1 },
    geo: detectGeo(a),
    language: { [detectLanguage(description)]: 1 },
    nameStyle: { compound: 1 },
    tone: 2,
    clarity: wordCount < 6 ? 0.5 : 2,
    flags,
    safety: {
      phishing: refuse ? 0.9 : 0.02,
      illegal: refuse ? 0.9 : 0.02,
      impersonation: strict ? 0.8 : 0.05,
      adult: hits(a, ADULT_WORDS) > 0 ? 0.8 : 0.02,
    },
    gambling: hits(a, GAMBLING_WORDS) > 0,
  };
}
