// Browser-safe template filling for strings passed down from server components (no message file in the bundle).
export type Vars = Record<string, string | number>;

export function format(template: string | undefined, vars: Vars = {}): string {
  if (template === undefined) return '';
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
