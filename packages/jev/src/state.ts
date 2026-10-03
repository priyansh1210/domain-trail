// The only way to build what is sent to Jev (spec 002 tech §9, FR-JEV-013): fields are copied from a whitelist,
// so account data (e-mail, user id, IP) can never reach the model even if a caller passes it in.

export interface S1Input {
  description: string;
  preferences?: { country?: string; preferredTlds?: string[]; nameStyle?: string };
}

export interface S5Input {
  description: string;
  summary: {
    siteType: string;
    industry: string;
    audience: string;
    geo: string;
    tone: string;
    features: string[];
  };
  keywords: string[];
}

export type StageState =
  | { description: string; preferences: { country?: string; preferredTlds?: string[]; nameStyle?: string } }
  | S5Input;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const strList = (v: unknown, max: number): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : undefined;

export function buildState(stage: 'S1' | 'S2', input: S1Input): StageState;
export function buildState(stage: 'S5' | 'S6', input: S5Input): StageState;
export function buildState(stage: 'S1' | 'S2' | 'S5' | 'S6', input: S1Input | S5Input): StageState {
  if (stage === 'S1' || stage === 'S2') {
    const i = input as S1Input;
    const prefs = i.preferences ?? {};
    const preferences: { country?: string; preferredTlds?: string[]; nameStyle?: string } = {};
    const country = str(prefs.country);
    if (country && country !== 'auto') preferences.country = country;
    const tlds = strList(prefs.preferredTlds, 20);
    if (tlds && tlds.length) preferences.preferredTlds = tlds;
    const style = str(prefs.nameStyle);
    if (style) preferences.nameStyle = style;
    return { description: String(i.description), preferences };
  }
  const i = input as S5Input;
  const s = i.summary;
  return {
    description: String(i.description),
    summary: {
      siteType: String(s.siteType),
      industry: String(s.industry),
      audience: String(s.audience),
      geo: String(s.geo),
      tone: String(s.tone),
      features: strList(s.features, 40) ?? [],
    },
    keywords: strList(i.keywords, 60) ?? [],
  };
}
