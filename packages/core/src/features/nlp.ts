// Lemmatization for the rule-based fallback (spec 003 tech §5.5) using wink-nlp's small English model.
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

let nlp: ReturnType<typeof winkNLP> | undefined;

/** Lower-case lemmas of the words in `text`, plus the plain lower-cased text for phrase matching. */
export function analyze(text: string): { lemmas: Set<string>; lower: string; words: number } {
  nlp ??= winkNLP(model);
  const doc = nlp.readDoc(text);
  const its = nlp.its;
  const types = doc.tokens().out(its.type) as string[];
  // wink-nlp types its.lemma with model add-ons; at runtime it is a normal token property.
  const lemma = doc.tokens().out(its.lemma as unknown as typeof its.normal) as string[];
  const normal = doc.tokens().out(its.normal) as string[];
  const lemmas = new Set<string>();
  let words = 0;
  types.forEach((type, i) => {
    if (type !== 'word') return;
    words++;
    lemmas.add(String(lemma[i]).toLowerCase());
    lemmas.add(String(normal[i]).toLowerCase());
  });
  return { lemmas, lower: ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ')} `, words };
}
