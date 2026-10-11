// How the site name is set beside the logo mark. The name itself is configuration (FR-SYS-011); the logo only
// decides how it is coloured: its last word takes the brand teal, as in the logo files.

/** "Domain Trail" → ["Domain ", "Trail"]; a one-word name stays whole. */
export function wordmarkParts(name: string): [string, string] {
  const trimmed = name.trim();
  const i = trimmed.lastIndexOf(' ');
  return i > 0 ? [trimmed.slice(0, i + 1), trimmed.slice(i + 1)] : [trimmed, ''];
}

/** Logo colours on a light background (logos/final/brand.html). */
export const BRAND_LIGHT = { d: '#0f1e33', t: '#0b6a88', point: '#e9a23b' } as const;
