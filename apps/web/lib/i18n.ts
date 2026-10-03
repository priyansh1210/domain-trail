// All interface text lives in messages/en.json (FR-UX-019) so it can be translated later.
import messages from '@/messages/en.json';

type Vars = Record<string, string | number>;

function lookup(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages);
}

export function t(path: string, vars: Vars = {}): string {
  const value = lookup(path);
  if (typeof value !== 'string') return path;
  return value.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function tList(path: string): string[] {
  const value = lookup(path);
  return Array.isArray(value) ? (value as string[]) : [];
}

/** Flat `key → text` map of one message section, for passing to client components as props. */
export function section(name: string): Record<string, string> {
  const node = lookup(name);
  if (!node || typeof node !== 'object') return {};
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
  ) as Record<string, string>;
}

export { messages };
