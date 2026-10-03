#!/usr/bin/env node
// Builds the offline word data used by name generation (spec 004 tech §2, FR-GEN-003, 008, 009, 018).
// Inputs are downloaded once by hand; outputs are committed under packages/core/src/generation/data/.
//
//   node scripts/build-words.mjs --enable <enable1.txt> --wordnet <wordnet-db>/dict --profanity <ldnoobw en>
//
// Sources (see data/NOTICE.md): ENABLE word list (public domain), WordNet 3.1 (WordNet licence, via the
// MIT-packaged `wordnet-db`), LDNOOBW English list (CC BY 4.0).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
};
const OUT = join(import.meta.dirname, '..', 'packages', 'core', 'src', 'generation', 'data');
const WORD = /^[a-z]{2,12}$/;

// ENABLE: the spelling authority.
const enable = new Set(
  readFileSync(arg('enable'), 'utf8')
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => WORD.test(w)),
);

// WordNet index files: lemma, pos, synset_cnt, p_cnt, [ptr...], sense_cnt, tagsense_cnt, offsets (most common first).
const wn = arg('wordnet');
const tagCount = new Map(); // how often a word was seen in the SemCor sample: a commonness signal
const senses = new Map(); // lemma -> { n: [offsets], a: [...], v: [...] }
const posTag = new Map(); // lemma -> { n: tagsense count, ... }
for (const [pos, file] of [
  ['n', 'noun'],
  ['v', 'verb'],
  ['a', 'adj'],
  ['r', 'adv'],
]) {
  for (const line of readFileSync(join(wn, `index.${file}`), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.trim().split(' ');
    const lemma = f[0];
    if (!WORD.test(lemma)) continue;
    const synsetCnt = Number(f[2]);
    const pCnt = Number(f[3]);
    const tagsense = Number(f[5 + pCnt]);
    tagCount.set(lemma, (tagCount.get(lemma) ?? 0) + (Number.isFinite(tagsense) ? tagsense : 0));
    const entry = senses.get(lemma) ?? {};
    entry[pos] = f.slice(f.length - synsetCnt);
    senses.set(lemma, entry);
    posTag.set(lemma, { ...(posTag.get(lemma) ?? {}), [pos]: Number.isFinite(tagsense) ? tagsense : 0 });
  }
}

// Known words: real words in both lists. Ranked by how often WordNet's tagged sample saw them.
const known = [...enable]
  .filter((w) => senses.has(w) && w.length >= 2)
  .sort((a, b) => (tagCount.get(b) ?? 0) - (tagCount.get(a) ?? 0) || a.localeCompare(b));
const knownSet = new Set(known);

// WordNet data files: synonyms in the same synset, plus direct hypernyms (@, @i) and similar adjectives (&).
const synsets = new Map(); // `${pos}:${offset}` -> { words, ptrs }
for (const [pos, file] of [
  ['n', 'noun'],
  ['v', 'verb'],
  ['a', 'adj'],
  ['r', 'adv'],
]) {
  for (const line of readFileSync(join(wn, `data.${file}`), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const [head] = line.split(' | ');
    const f = head.split(' ');
    const offset = f[0];
    const wCnt = parseInt(f[3], 16);
    const words = [];
    for (let i = 0; i < wCnt; i++) words.push(f[4 + i * 2].toLowerCase().replace(/\(.*\)$/, ''));
    let k = 4 + wCnt * 2;
    const pCnt = Number(f[k++]);
    const ptrs = [];
    for (let i = 0; i < pCnt; i++, k += 4) {
      const symbol = f[k];
      const targetPos = f[k + 2] === 's' ? 'a' : f[k + 2];
      if (symbol === '@' || symbol === '@i' || symbol === '&') ptrs.push(`${targetPos}:${f[k + 1]}`);
    }
    synsets.set(`${pos}:${offset}`, { words, ptrs });
  }
}

// Related words come only from a word's most common meaning: the first sense of its most used part of speech, plus
// the first sense of a second part of speech when that is also attested. So "bread" relates to food, not money,
// and "teach" to instructing, not the pirate.
const relatedOut = {};
for (const w of known) {
  if (w.length < 3) continue;
  const out = [];
  const push = (x) => {
    if (x !== w && WORD.test(x) && knownSet.has(x) && x.length >= 3 && x.length <= 10 && !out.includes(x))
      out.push(x);
  };
  const entry = senses.get(w);
  const tags = posTag.get(w) ?? {};
  const order = ['n', 'a', 'v'].filter((pos) => entry[pos]).sort((a, b) => (tags[b] ?? 0) - (tags[a] ?? 0));
  const chosen = order.filter((pos, i) => i === 0 || (i === 1 && (tags[pos] ?? 0) >= 1));
  for (const pos of chosen) {
    const s = synsets.get(`${pos}:${entry[pos][0]}`);
    if (!s) continue;
    s.words.forEach(push);
    for (const p of s.ptrs) synsets.get(p)?.words.forEach(push);
  }
  if (out.length) relatedOut[w] = out.slice(0, 10);
}
const common = known; // kept name for the trigram model below

// Character trigram counts over common words with boundary markers: index = a*27*27 + b*27 + c, 26 = boundary.
const idx = (ch) => (ch === '^' || ch === '$' ? 26 : ch.charCodeAt(0) - 97);
const trigrams = new Array(27 ** 3).fill(0);
for (const w of common) {
  const s = `^^${w}$`;
  for (let i = 0; i + 2 < s.length; i++) trigrams[idx(s[i]) * 729 + idx(s[i + 1]) * 27 + idx(s[i + 2])]++;
}

// Profanity: single words and joined phrases, lower case.
const profanity = [
  ...new Set(
    readFileSync(arg('profanity'), 'utf8')
      .split(/\r?\n/)
      .map((w) =>
        w
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ''),
      )
      .filter((w) => w.length >= 3),
  ),
].sort();

mkdirSync(OUT, { recursive: true });
const write = (name, value) => {
  const text = JSON.stringify(value);
  writeFileSync(join(OUT, name), text);
  console.log(`${name}: ${(text.length / 1024).toFixed(0)} KiB`);
};
write('words.json', known);
// Stored as [word, related[]] pairs: object keys like "break" or "constructor" upset JSON-to-module loaders.
write('related-words.json', Object.entries(relatedOut));
write('trigrams.json', trigrams);
write('profanity.json', profanity);
console.log(
  `words ${known.length}, related keys ${Object.keys(relatedOut).length}, profanity ${profanity.length}`,
);
