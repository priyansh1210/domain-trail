// Description normalization (spec 001 tech §5; FR-INT-007, FR-INT-011). Links, e-mail addresses and phone
// numbers are removed before anything else sees the text, and the caller learns what was removed so the UI can
// say so.

export interface Normalized {
  text: string;
  removed: { url: boolean; email: boolean; phone: boolean };
}

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
// Deliberately matches control characters: they are stripped from user input.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const URL = /https?:\/\/\S+|www\.\S+/gi;
// Bounded parts and a start-of-run lookbehind keep matching linear (CodeQL js/polynomial-redos).
const EMAIL = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const PHONE = /(?<![\d+])\+?\d[\d\s().-]{7,20}\d/g;

export function normalize(raw: string): Normalized {
  let s = raw.normalize('NFKC').replace(ZERO_WIDTH, '').replace(CONTROL, '');
  const removed = { url: false, email: false, phone: false };
  s = s.replace(URL, () => ((removed.url = true), ' '));
  s = s.replace(EMAIL, () => ((removed.email = true), ' '));
  s = s.replace(PHONE, () => ((removed.phone = true), ' '));
  return { text: s.replace(/\s+/g, ' ').trim(), removed };
}
