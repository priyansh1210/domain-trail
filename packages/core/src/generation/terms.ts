// Stage S2a: key terms from the description (spec 004 tech §5.1, FR-GEN-001, FR-GEN-017) and their weights (§5.2,
// FR-GEN-002).
import type { Answer } from '@domains-all/jev';
import { transliterate } from 'transliteration';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import { FLAG_WORDS } from '../ranking/tlds';
import { GAZETTEER } from '../features/seed/signals';
import { TAXONOMY } from '../features/seed/taxonomy';
import type { SiteProfile } from '../features/types';
import { brandTokensIn } from '../safety/brand-risk';
import { commonness } from './lexicon';

export interface Term {
  text: string; // lower-case ASCII; phrases keep one space ("sourdough bread")
  kind: 'word' | 'phrase' | 'hint' | 'geo';
  tf: number; // frequency × part-of-speech weight (or a prior for hints)
}

export interface WeightedTerm extends Term {
  w: number;
  core: boolean;
}

/** Words that describe almost any website; kept out of key terms (the affix strategy still uses some). */
export const GENERIC_WORDS = new Set(
  (
    'website site web online page best top great good new service services company business businesses platform app ' +
    'apps offer offers provide provides help helps people customer customers client clients product products based ' +
    'quality professional local friendly easy simple small big world everyone anyone thing things stuff place way ' +
    'idea project solution solutions want need make get use like also well just one many much more'
  ).split(' '),
);

const OTHER_STOPWORDS = new Set(
  (
    'el la los las un una para con que del por y en de o al se su sus es lo como ' +
    'le les une pour avec des du et est au aux dans sur ' +
    'o os uma com do da dos das em no na nos nas e ' +
    'der die das und ein eine fur mit ist zu im auf den dem von ' +
    'il lo gli una per che della di e nel ' +
    'het een voor met en van ' +
    'yang dan untuk dengan di kami ini itu ' +
    'mein me man men ki kii ke kaa ka kee aur hai se ko par jo bhi ek'
  ).split(' '),
);

const POS_WEIGHT: Record<string, number> = { NOUN: 1, PROPN: 0.9, ADJ: 0.6, VERB: 0.5 };
const MAX_TERMS = 60;
const CORE_TERMS = 8;

let nlp: ReturnType<typeof winkNLP> | undefined;

const ascii = (s: string) =>
  transliterate(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Places named in the description, for place-based names (FR-GEN-012). */
export function placesIn(description: string): string[] {
  const text = ` ${ascii(description)} `;
  const found: string[] = [];
  for (const places of Object.values(GAZETTEER)) {
    for (const p of places) if (text.includes(` ${p} `) && !p.includes(' ') && p.length >= 3) found.push(p);
  }
  return [...new Set(found)];
}

export function extractTerms(description: string, profile?: SiteProfile): Term[] {
  nlp ??= winkNLP(model);
  const its = nlp.its;
  const nonLatin = /[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(description);
  const text = nonLatin ? ascii(description) : description;
  const doc = nlp.readDoc(text);
  const lemmas = doc.tokens().out(its.lemma as unknown as typeof its.normal) as string[];
  const pos = doc.tokens().out(its.pos) as string[];
  const types = doc.tokens().out(its.type) as string[];
  const stop = doc.tokens().out(its.stopWordFlag) as unknown as boolean[];
  const brands = new Set(brandTokensIn(description));

  const score = new Map<string, Term>();
  const add = (t: string, kind: Term['kind'], tf: number) => {
    const key = ascii(t);
    if (!key || key.length < 3 || /^\d+$/.test(key)) return;
    const cur = score.get(key);
    // A named place is always a place (for place-based names); otherwise a phrase stays a phrase.
    const merged: Term['kind'] =
      kind === 'geo' || cur?.kind === 'geo'
        ? 'geo'
        : kind === 'phrase' || cur?.kind === 'phrase'
          ? 'phrase'
          : (cur?.kind ?? kind);
    score.set(key, { text: key, kind: merged, tf: (cur?.tf ?? 0) + tf });
  };

  let run: string[] = [];
  const flush = () => {
    for (let i = 1; i < run.length; i++) add(`${run[i - 1]} ${run[i]}`, 'phrase', 1.2); // every adjacent pair
    run = [];
  };
  lemmas.forEach((lemmaRaw, i) => {
    const lemma = ascii(String(lemmaRaw));
    const p = nonLatin ? 'NOUN' : pos[i]!;
    const keep =
      types[i] === 'word' &&
      lemma.length >= 3 &&
      !stop[i] &&
      !OTHER_STOPWORDS.has(lemma) &&
      !GENERIC_WORDS.has(lemma) &&
      !brands.has(lemma) &&
      POS_WEIGHT[p] !== undefined;
    if (keep) {
      // Specific words matter more than everyday ones ("photographer" over "form"): TF × (0.5 + specificity).
      add(lemma, 'word', POS_WEIGHT[p]! * (0.5 + (1 - commonness(lemma))));
      if (p === 'NOUN' || p === 'ADJ' || p === 'PROPN') run.push(lemma);
      else flush();
    } else flush();
  });
  flush();

  // Hints from the detected profile (spec 003 §5.4): industry words, feature words, and named places.
  if (profile) {
    const industry = TAXONOMY.find((i) => i.key === profile.industry.value);
    for (const w of industry?.wordHints ?? []) add(w, 'hint', 0.3);
    for (const [flag, f] of Object.entries(profile.flags))
      if (f.on) for (const w of FLAG_WORDS[flag] ?? []) add(w, 'hint', 0.3);
    if (profile.flags.feat_local?.on || profile.geo.value !== 'global')
      for (const p of placesIn(description)) add(p, 'geo', 0.8);
  }

  return [...score.values()].sort((a, b) => b.tf - a.tf || a.text.localeCompare(b.text)).slice(0, MAX_TERMS);
}

/** Options for Jev's `keyword_core@1`: t00…t59 → term. */
export function keywordOptions(terms: readonly Term[]): Record<string, string> {
  return Object.fromEntries(terms.map((t, i) => [`t${String(i).padStart(2, '0')}`, t.text]));
}

/** w = 0.7·Jev + 0.3·frequency when Jev answered, else frequency only; the top 8 are core terms. */
export function weighTerms(terms: readonly Term[], answer?: Answer): WeightedTerm[] {
  const tfSum = terms.reduce((a, t) => a + t.tf, 0) || 1;
  const jev = answer?.type === 'choice' ? answer.probabilities : null;
  const weighted = terms.map((t, i) => {
    const wTf = t.tf / tfSum;
    const wJev = jev?.[`t${String(i).padStart(2, '0')}`];
    return { ...t, w: jev ? 0.7 * (wJev ?? 0) + 0.3 * wTf : wTf, core: false };
  });
  const order = [...weighted].sort((a, b) => b.w - a.w || a.text.localeCompare(b.text));
  order.slice(0, CORE_TERMS).forEach((t) => (t.core = true));
  return order;
}
