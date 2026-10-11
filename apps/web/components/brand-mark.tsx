// The Domain Trail mark (logos/final, concept "Path Cut"): a bold D and T cut by one rising path that ends at an
// amber point. The cut is a real gap (an SVG mask), so the background shows through on any colour.
import type { SVGProps } from 'react';

const VIEW_BOX = '9.8 0.6 108 108';
const D = 'M12 22H38A38 38 0 0 1 38 98H12Z';
const T = 'M70 22H112V40H100V98H82V40H70Z';
const CUT =
  'M2.28 107.58 L4.15 107.28 L6.02 106.94 L7.88 106.54 L9.75 106.11 L11.61 105.62 L13.47 105.09 L15.34 104.52 L17.2 103.89 L19.06 103.23 L20.92 102.51 L22.78 101.75 L24.64 100.95 L26.5 100.1 L28.36 99.21 L30.22 98.27 L32.08 97.29 L33.95 96.26 L35.81 95.19 L37.67 94.08 L39.54 92.93 L41.41 91.73 L43.27 90.49 L45.15 89.21 L47.02 87.89 L48.89 86.52 L50.77 85.12 L52.65 83.67 L54.54 82.18 L56.43 80.66 L58.32 79.09 L60.22 77.48 L62.12 75.83 L64.02 74.14 L65.93 72.41 L67.85 70.65 L69.77 68.84 L71.69 67 L73.63 65.12 L75.56 63.2 L77.51 61.24 L79.46 59.25 L81.42 57.21 L83.38 55.14 L85.36 53.04 L87.34 50.89 L89.33 48.71 L91.32 46.49 L93.33 44.24 L95.35 41.95 L97.37 39.63 L99.4 37.27 L101.45 34.88 L103.5 32.45 L105.56 29.98 L107.64 27.48 L109.72 24.95 A4.75 4.75 0 0 1 102.28 19.05 L102.28 19.05 L100.3 21.63 L98.34 24.17 L96.39 26.67 L94.45 29.14 L92.52 31.57 L90.6 33.97 L88.69 36.34 L86.79 38.66 L84.9 40.95 L83.02 43.2 L81.14 45.42 L79.28 47.6 L77.43 49.74 L75.58 51.85 L73.74 53.92 L71.91 55.95 L70.09 57.94 L68.28 59.9 L66.47 61.81 L64.67 63.69 L62.87 65.53 L61.08 67.33 L59.3 69.09 L57.52 70.82 L55.75 72.5 L53.98 74.15 L52.22 75.75 L50.46 77.32 L48.71 78.84 L46.96 80.33 L45.21 81.77 L43.47 83.18 L41.72 84.54 L39.99 85.87 L38.25 87.15 L36.52 88.39 L34.78 89.59 L33.05 90.75 L31.32 91.87 L29.6 92.95 L27.87 93.99 L26.14 94.98 L24.41 95.93 L22.68 96.84 L20.95 97.71 L19.22 98.54 L17.48 99.32 L15.75 100.06 L14.01 100.76 L12.26 101.41 L10.52 102.02 L8.77 102.59 L7.01 103.12 L5.26 103.6 L3.49 104.03 L1.72 104.42Z';
const DOT = { cx: 109.85, cy: 17.14, r: 6 };

export interface MarkColours {
  d: string;
  t: string;
  point: string;
}

/** Theme-aware colours (globals.css): navy, teal and amber on light; white, light teal and light amber on dark. */
const THEME: MarkColours = { d: 'var(--brand-d)', t: 'var(--brand-t)', point: 'var(--brand-point)' };

export function BrandMark({ maskId = 'brand-cut', ...props }: SVGProps<SVGSVGElement> & { maskId?: string }) {
  return (
    <svg viewBox={VIEW_BOX} aria-hidden="true" focusable="false" {...props}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <rect width="120" height="120" fill="#fff" />
          <path d={CUT} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <path d={D} fill={THEME.d} />
        <path d={T} fill={THEME.t} />
      </g>
      <circle {...DOT} fill={THEME.point} />
    </svg>
  );
}

/** The mark as a standalone SVG document with fixed colours (social preview image). */
export function brandMarkSvg(c: MarkColours): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}">` +
    `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">` +
    `<rect width="120" height="120" fill="#fff"/><path d="${CUT}" fill="#000"/></mask></defs>` +
    `<g mask="url(#m)"><path d="${D}" fill="${c.d}"/><path d="${T}" fill="${c.t}"/></g>` +
    `<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${c.point}"/></svg>`
  );
}
