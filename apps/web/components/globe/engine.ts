// The search globe, drawn on a 2D canvas (no library): a glassy Earth with dotted continents and an atmosphere,
// registry cities that pulse bright and dull, network routes carrying signals, and satellites with light trails
// that beam down to cities. While a search runs ("active") the visitor's side of the world sends a signal to each
// registry city in turn; every hit lands with a ripple and an amber answer travels back.
import { LAND } from './land';

type V3 = [number, number, number];
type P2 = [number, number];

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const TILT = 0.36; // north pole leans towards the viewer, so India sits near the middle
const F = 6; // gentle perspective

// Cities with domain registries and big internet exchanges. Searches start from the first one.
const CITIES: Array<[number, number]> = [
  [18.52, 73.86],
  [19.08, 72.88],
  [28.61, 77.21],
  [12.97, 77.59],
  [38.96, -77.36],
  [35.68, 139.69],
  [4.71, -74.07],
  [25.2, 55.27],
  [50.11, 8.68],
  [51.51, -0.13],
  [1.35, 103.82],
  [-33.87, 151.21],
  [52.37, 4.9],
  [-26.2, 28.05],
  [43.65, -79.38],
  [37.57, 126.98],
  [37.77, -122.42],
  [-23.55, -46.63],
  [-1.29, 36.82],
  [22.32, 114.17],
  [59.33, 18.07],
  [19.43, -99.13],
  [6.52, 3.38],
  [-6.21, 106.85],
  [13.08, 80.27],
  [17.39, 78.49],
  [34.05, -118.24],
  [41.88, -87.63],
  [40.42, -3.7],
  [41.01, 28.98],
  [13.76, 100.5],
  [-37.81, 144.96],
  [-34.6, -58.38],
  [30.04, 31.24],
  [24.71, 46.68],
  [14.6, 120.98],
];
const QUERY_TARGETS = [4, 5, 7, 6, 8, 10, 26, 9, 11, 15, 12, 27, 13, 19, 14, 28, 17, 16, 30];
const ROUTES: Array<[number, number]> = [
  [1, 4],
  [1, 8],
  [1, 10],
  [7, 9],
  [9, 4],
  [8, 13],
  [10, 5],
  [5, 16],
  [10, 11],
  [4, 17],
  [9, 14],
  [19, 23],
  [8, 20],
  [22, 17],
  [18, 7],
  [21, 4],
  [0, 7],
  [2, 8],
  [3, 10],
  [24, 10],
  [25, 7],
  [2, 19],
  [26, 5],
  [27, 9],
  [26, 27],
  [28, 17],
  [29, 8],
  [30, 10],
  [31, 11],
  [32, 17],
  [33, 7],
  [34, 1],
  [35, 19],
  [23, 31],
  [14, 27],
  [12, 20],
  [9, 28],
  [13, 22],
  [18, 33],
  [15, 35],
];
/** [radius, inclination, node, speed, satellites] */
const ORBITS: Array<[number, number, number, number, number]> = [
  [1.42, 1.12, 0.5, 0.36, 2],
  [1.58, 1.98, 2.4, -0.26, 2],
  [1.27, 0.62, 4.2, 0.48, 1],
];

export type GlobeMode = 'calm' | 'active';
export interface GlobeOptions {
  /** Points tried on the sphere for the dotted land (about a fifth land on continents). */
  density: number;
  cities: boolean;
  satellites: number;
  /** Radius of the globe as a fraction of half the canvas. */
  fit: number;
  shadow: boolean;
  seed: number;
  mode: GlobeMode;
}
export interface Globe {
  start(): void;
  stop(): void;
  setMode(m: GlobeMode): void;
  readonly running: boolean;
  destroy(): void;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const ll = (lat: number, lon: number): V3 => [
  Math.cos(lat * RAD) * Math.sin(lon * RAD),
  Math.sin(lat * RAD),
  Math.cos(lat * RAD) * Math.cos(lon * RAD),
];
const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

function isLand(lat: number, lon: number): boolean {
  const r = Math.max(0, Math.min(89, Math.round((89 - lat) / 2)));
  const c = (((Math.round((lon + 179) / 2) % 180) + 180) % 180) as number;
  return ((parseInt(LAND[r * 45 + (c >> 2)]!, 16) >> (3 - (c & 3))) & 1) === 1;
}

function fibonacci(n: number): V3[] {
  const out: V3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]);
  }
  return out;
}

function arcBetween(a: V3, b: V3, n: number): V3[] {
  const d = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const alt = 0.035 + 0.27 * (d / Math.PI);
  const pts: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const sa = Math.sin((1 - s) * d) / Math.sin(d);
    const sb = Math.sin(s * d) / Math.sin(d);
    const lift = 1 + alt * Math.sin(Math.PI * s);
    pts.push([
      (a[0] * sa + b[0] * sb) * lift,
      (a[1] * sa + b[1] * sb) * lift,
      (a[2] * sa + b[2] * sb) * lift,
    ]);
  }
  return pts;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createGlobe(canvas: HTMLCanvasElement, o: GlobeOptions): Globe {
  const ctx = canvas.getContext('2d')!;
  const rand = rng(o.seed);
  const css = getComputedStyle(canvas);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const col = {
    ink: hexRgb(token('--brand-d', '#0f1e33')),
    accent: hexRgb(token('--accent', '#0b6a88')),
    signal: hexRgb(token('--signal', '#1aa9d6')),
    found: hexRgb(token('--found', '#e9a23b')),
    surface: hexRgb(token('--surface', '#ffffff')),
  };
  const rgba = (c: [number, number, number], a: number) =>
    `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const mixRgb = (a: [number, number, number], b: [number, number, number], k: number) =>
    `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(',')})`;
  const body = [
    rgba(col.surface, 1),
    mixRgb(col.surface, col.signal, 0.1),
    mixRgb(col.surface, col.accent, 0.3),
  ];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const land = fibonacci(o.density)
    .filter((p) => isLand(Math.asin(p[1]) / RAD, Math.atan2(p[0], p[2]) / RAD))
    .map((p) => ({ p, tw: rand() < 0.07 ? { at: rand() * TAU, w: 0.5 + rand() * 1.6 } : null }));
  const cities = o.cities
    ? CITIES.map(([lat, lon]) => ({ p: ll(lat, lon), at: rand() * TAU, flash: 0, s: null as V3 | null }))
    : [];
  const net = o.cities
    ? ROUTES.map(([a, b]) => ({
        pts: arcBetween(cities[a]!.p, cities[b]!.p, 48),
        at: rand(),
        sp: 0.1 + rand() * 0.16,
      }))
    : [];
  const grid: V3[][] = [];
  for (let m = 0; m < 6; m++) {
    const lon = (m / 6) * Math.PI;
    const pts: V3[] = [];
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * TAU;
      pts.push([Math.cos(a) * Math.cos(lon), Math.sin(a), Math.cos(a) * Math.sin(lon)]);
    }
    grid.push(pts);
  }
  for (const lat of [-60, -30, 0, 30, 60]) {
    const phi = lat * RAD;
    const pts: V3[] = [];
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * TAU;
      pts.push([Math.cos(phi) * Math.sin(a), Math.sin(phi), Math.cos(phi) * Math.cos(a)]);
    }
    grid.push(pts);
  }
  const orbits = ORBITS.slice(0, Math.max(0, Math.min(3, o.satellites))).map(
    ([r, inc, node, speed, count]) => {
      const n = norm([Math.sin(inc) * Math.cos(node), Math.cos(inc), Math.sin(inc) * Math.sin(node)]);
      const u = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]));
      const v = cross(n, u);
      const sats = Array.from({ length: o.satellites < 3 ? 1 : count }, (_, k) => (k / count) * TAU);
      return { r, u, v, speed, phase: rand() * TAU, sats, pos: [] as V3[] };
    },
  );

  let W = 0;
  let H = 0;
  let R = 0;
  let cx = 0;
  let cy = 0;
  let dpr = 1;
  let t = 0;
  let spin = -73.86 * RAD - 0.45; // the visitor's part of the world comes round first
  let last: number | null = null;
  let raf = 0;
  let running = false;
  let mode: GlobeMode = o.mode;
  let energy = mode === 'active' ? 1 : 0;
  let beams: Array<{ oi: number; si: number; city: number; born: number; life: number }> = [];
  let ripples: Array<{ p: V3; color: [number, number, number]; size: number; life: number; born: number }> =
    [];
  let queries: Array<{ pts: V3[]; target: number; born: number; landed?: boolean; answered?: boolean }> = [];
  let nextBeam = 1.2;
  let nextQuery = 0.4;
  let nextPing = 0;
  let qi = 0;

  const tiltX = (p: V3): V3 => {
    const c = Math.cos(TILT);
    const s = Math.sin(TILT);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  };
  const turn = (p: V3, c: number, s: number) => tiltX([p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]);
  const scr = (p: V3): P2 => {
    const k = F / (F - p[2]);
    return [cx + p[0] * R * k, cy - p[1] * R * k];
  };
  const hidden = (p: V3) => p[2] < 0 && p[0] * p[0] + p[1] * p[1] < 1;
  const orbitPoint = (ob: (typeof orbits)[number], a: number) =>
    tiltX([
      ob.r * (Math.cos(a) * ob.u[0] + Math.sin(a) * ob.v[0]),
      ob.r * (Math.cos(a) * ob.u[1] + Math.sin(a) * ob.v[1]),
      ob.r * (Math.cos(a) * ob.u[2] + Math.sin(a) * ob.v[2]),
    ]);

  function strokeSegments(pts: V3[], test: (p: V3) => boolean, style: string, width: number) {
    ctx.beginPath();
    let open = false;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      if (test([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])) {
        const sa = scr(a);
        const sb = scr(b);
        if (!open) {
          ctx.moveTo(sa[0], sa[1]);
          open = true;
        }
        ctx.lineTo(sb[0], sb[1]);
      } else open = false;
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  function glow(x: number, y: number, r: number, c: [number, number, number], a: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  /** A bright head with a fading tail along `pts`, the head at fraction `head`. */
  function comet(
    pts: V3[],
    head: number,
    c: [number, number, number],
    alpha: number,
    len: number,
    width: number,
  ) {
    const hi = Math.min(pts.length - 1, Math.floor(head * (pts.length - 1)));
    ctx.lineCap = 'round';
    for (let k = Math.max(0, hi - len); k < hi; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      if (hidden(a) || hidden(b)) continue;
      const sa = scr(a);
      const sb = scr(b);
      ctx.strokeStyle = rgba(c, Math.pow((k - (hi - len) + 1) / len, 1.5) * alpha);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(sa[0], sa[1]);
      ctx.lineTo(sb[0], sb[1]);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    const p = pts[hi]!;
    if (!hidden(p)) {
      const q = scr(p);
      glow(q[0], q[1], width * 4, c, alpha * 0.8);
      ctx.fillStyle = rgba(col.surface, alpha);
      ctx.beginPath();
      ctx.arc(q[0], q[1], width * 0.7, 0, TAU);
      ctx.fill();
    }
  }
  const ripple = (p: V3, color: [number, number, number], size: number, life: number) =>
    ripples.push({ p, color, size, life, born: t });

  function drawSatellites(front: boolean, lw: number) {
    const TRAIL = 1.1;
    const STEPS = 16;
    for (const ob of orbits) {
      for (const a of ob.sats) {
        const ang = a + ob.phase;
        ctx.lineCap = 'round';
        for (let k = 0; k < STEPS; k++) {
          const p0 = orbitPoint(ob, ang - TRAIL * (1 - k / STEPS));
          const p1 = orbitPoint(ob, ang - TRAIL * (1 - (k + 1) / STEPS));
          if (hidden([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2]) === front) continue;
          const s0 = scr(p0);
          const s1 = scr(p1);
          ctx.strokeStyle = rgba(col.found, Math.pow((k + 1) / STEPS, 1.8) * (front ? 0.85 : 0.22));
          ctx.lineWidth = lw * 1.5;
          ctx.beginPath();
          ctx.moveTo(s0[0], s0[1]);
          ctx.lineTo(s1[0], s1[1]);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        const p = orbitPoint(ob, ang);
        if (hidden(p) === front) continue;
        const q = scr(p);
        const q2 = scr(orbitPoint(ob, ang + 0.04));
        const dl = Math.hypot(q2[0] - q[0], q2[1] - q[1]) || 1;
        const px = -(q2[1] - q[1]) / dl;
        const py = (q2[0] - q[0]) / dl;
        const fade = front ? 1 : 0.3;
        if (front) glow(q[0], q[1], lw * 9, col.found, 0.32);
        ctx.strokeStyle = rgba(col.accent, 0.9 * fade);
        ctx.lineWidth = lw * 1.8;
        ctx.beginPath();
        ctx.moveTo(q[0] + px * lw * 1.6, q[1] + py * lw * 1.6);
        ctx.lineTo(q[0] + px * lw * 4.6, q[1] + py * lw * 4.6);
        ctx.moveTo(q[0] - px * lw * 1.6, q[1] - py * lw * 1.6);
        ctx.lineTo(q[0] - px * lw * 4.6, q[1] - py * lw * 4.6);
        ctx.stroke();
        ctx.fillStyle = rgba(col.found, fade);
        ctx.beginPath();
        ctx.arc(q[0], q[1], lw * 1.7, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(col.surface, fade);
        ctx.beginPath();
        ctx.arc(q[0], q[1], lw * 0.7, 0, TAU);
        ctx.fill();
      }
    }
  }

  function draw(dt: number) {
    energy += ((mode === 'active' ? 1 : 0) - energy) * Math.min(1, dt * 1.6);
    const e = energy;
    const mix = (a: number, b: number) => a + (b - a) * e;
    t += dt;
    spin += dt * mix(0.09, 0.22);
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    const lw = Math.max(0.55, R / 130);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // soft shadow under the globe and the atmosphere around it
    if (o.shadow) {
      const sy = cy + R * 1.62;
      ctx.save();
      ctx.translate(cx, sy);
      ctx.scale(1, 0.14);
      ctx.translate(-cx, -sy);
      glow(cx, sy, R * 0.95, col.ink, 0.12);
      ctx.restore();
    }
    let g = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.34);
    g.addColorStop(0, rgba(col.signal, mix(0.24, 0.34)));
    g.addColorStop(0.3, rgba(col.signal, mix(0.08, 0.12)));
    g.addColorStop(1, rgba(col.signal, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.34, 0, TAU);
    ctx.fill();

    // orbits: move the satellites, draw the far half first
    const rings = orbits.map((ob) => {
      ob.phase += dt * ob.speed * mix(1, 1.9);
      const pts: V3[] = [];
      for (let k = 0; k <= 120; k++) pts.push(orbitPoint(ob, (k / 120) * TAU));
      ob.pos = ob.sats.map((a) => orbitPoint(ob, a + ob.phase));
      return pts;
    });
    rings.forEach((pts) => strokeSegments(pts, hidden, rgba(col.accent, 0.07), lw));
    drawSatellites(false, lw);

    // the ball: lit glass with a bright rim and a highlight
    g = ctx.createRadialGradient(cx - R * 0.42, cy - R * 0.48, R * 0.04, cx, cy, R * 1.02);
    g.addColorStop(0, body[0]!);
    g.addColorStop(0.55, body[1]!);
    g.addColorStop(1, body[2]!);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    g = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    g.addColorStop(0, rgba(col.signal, 0));
    g.addColorStop(1, rgba(col.signal, 0.3));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    glow(cx - R * 0.42, cy - R * 0.5, R * 0.42, col.surface, 0.75);
    ctx.strokeStyle = rgba(col.accent, 0.28);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    // faint grid, then the dotted continents (near half), some of them twinkling
    const near = (p: V3) => p[2] > 0;
    grid.forEach((pts) =>
      strokeSegments(
        pts.map((p) => turn(p, c, s)),
        near,
        rgba(col.accent, 0.06),
        lw * 0.8,
      ),
    );
    const dotR = lw * 0.78;
    const buckets: P2[][] = [[], [], [], [], []];
    const sparks: Array<[P2, number]> = [];
    for (const d of land) {
      const p = turn(d.p, c, s);
      if (p[2] <= 0.03) continue;
      const q = scr(p);
      if (d.tw) {
        d.tw.at += dt * d.tw.w * mix(1, 2.2);
        const b = Math.pow(0.5 + 0.5 * Math.sin(d.tw.at), 8);
        if (b > 0.08) {
          sparks.push([q, b * Math.sqrt(p[2])]);
          continue;
        }
      }
      buckets[Math.min(4, Math.floor(Math.sqrt(p[2]) * 5))]!.push(q);
    }
    ctx.fillStyle = rgba(col.accent, 1);
    buckets.forEach((qs, i) => {
      ctx.globalAlpha = 0.18 + i * 0.13;
      ctx.beginPath();
      for (const q of qs) {
        ctx.moveTo(q[0] + dotR, q[1]);
        ctx.arc(q[0], q[1], dotR, 0, TAU);
      }
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    for (const [q, b] of sparks) {
      glow(q[0], q[1], dotR * 6, col.signal, b * 0.6);
      ctx.fillStyle = rgba(col.signal, 0.5 + 0.5 * b);
      ctx.beginPath();
      ctx.arc(q[0], q[1], dotR * 1.3, 0, TAU);
      ctx.fill();
    }

    // network routes with travelling signals
    for (const a of net) {
      const pts = a.pts.map((p) => turn(p, c, s));
      strokeSegments(pts, (p) => !hidden(p), rgba(col.accent, mix(0.18, 0.12)), lw * 0.85);
      a.at = (a.at + dt * a.sp * mix(1, 1.7)) % 1;
      comet(pts, a.at, col.signal, mix(0.6, 0.45), 8, lw * 1.5);
    }

    // a search: the visitor's city asks each registry, the answer comes back in amber
    if (o.cities && e > 0.6 && t >= nextQuery) {
      const target = QUERY_TARGETS[qi++ % QUERY_TARGETS.length]!;
      queries.push({ pts: arcBetween(cities[0]!.p, cities[target]!.p, 60), target, born: t });
      nextQuery = t + 0.4;
    }
    if (o.cities && e > 0.6 && t >= nextPing) {
      ripple(cities[0]!.p, col.signal, 16, 1.3);
      nextPing = t + 1.1;
    }
    const OUT = 0.95;
    const BACK = 0.85;
    const FADE = 0.7;
    queries = queries.filter((qy) => {
      const age = t - qy.born;
      if (age > OUT + BACK + FADE) return false;
      const pts = qy.pts.map((p) => turn(p, c, s));
      if (age < OUT) {
        const k = 1 - Math.pow(1 - age / OUT, 3);
        const hi = Math.max(1, Math.floor(k * (pts.length - 1)));
        strokeSegments(pts.slice(0, hi + 1), (p) => !hidden(p), rgba(col.signal, 0.55), lw * 1.3);
        comet(pts, k, col.signal, 1, 10, lw * 1.9);
      } else {
        if (!qy.landed) {
          qy.landed = true;
          ripple(cities[qy.target]!.p, col.signal, 20, 1.1);
          cities[qy.target]!.flash = 1;
        }
        const base = age < OUT + BACK ? 0.5 : 0.5 * (1 - (age - OUT - BACK) / FADE);
        strokeSegments(pts, (p) => !hidden(p), rgba(col.signal, base * 0.7), lw * 1.1);
        if (age < OUT + BACK) comet(pts.slice().reverse(), (age - OUT) / BACK, col.found, 1, 9, lw * 1.7);
        else if (!qy.answered) {
          qy.answered = true;
          ripple(cities[0]!.p, col.found, 12, 0.9);
        }
      }
      return true;
    });

    // cities: bright and dull, flashing amber when an answer lands
    cities.forEach((cty, i) => {
      const p = turn(cty.p, c, s);
      cty.s = p;
      cty.flash = Math.max(0, cty.flash - dt / 1.6);
      if (p[2] <= 0.04) return;
      const q = scr(p);
      const depth = 0.35 + 0.65 * p[2];
      cty.at += dt * mix(0.9, 2);
      const b = Math.pow(0.5 + 0.5 * Math.sin(cty.at), 5);
      const heat = Math.max(b * 0.75, cty.flash);
      glow(
        q[0],
        q[1],
        lw * (5 + 7 * heat),
        cty.flash > 0.05 ? col.found : col.signal,
        (0.18 + 0.4 * heat) * depth,
      );
      if (i === 0) {
        ctx.fillStyle = rgba(col.surface, depth);
        ctx.beginPath();
        ctx.arc(q[0], q[1], lw * 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(col.found, depth);
        ctx.beginPath();
        ctx.arc(q[0], q[1], lw * 2, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = rgba(cty.flash > 0.05 ? col.found : col.accent, (0.55 + 0.45 * heat) * depth);
        ctx.beginPath();
        ctx.arc(q[0], q[1], lw * (1.3 + 0.9 * heat), 0, TAU);
        ctx.fill();
      }
    });

    // ripples lie on the surface, so they flatten towards the edge of the globe
    ripples = ripples.filter((rp) => {
      const k = (t - rp.born) / rp.life;
      if (k >= 1) return false;
      const p = turn(rp.p, c, s);
      if (p[2] <= 0.05) return true;
      const q = scr(p);
      const rad = lw * (2 + rp.size * (1 - Math.pow(1 - k, 2)));
      ctx.strokeStyle = rgba(rp.color, (1 - k) * 0.75);
      ctx.lineWidth = lw * 1.2;
      ctx.beginPath();
      ctx.ellipse(q[0], q[1], Math.max(0.1, rad * p[2]), rad, Math.atan2(q[1] - cy, q[0] - cx), 0, TAU);
      ctx.stroke();
      return true;
    });

    // near half of the orbits, satellites, and their beams down to cities
    rings.forEach((pts) => strokeSegments(pts, (p) => !hidden(p), rgba(col.accent, 0.2), lw));
    if (cities.length && t >= nextBeam) {
      const cands: Array<[number, number]> = [];
      orbits.forEach((ob, oi) =>
        ob.pos.forEach((p, si) => {
          if (!hidden(p)) cands.push([oi, si]);
        }),
      );
      if (cands.length) {
        const [oi, si] = cands[Math.floor(rand() * cands.length)]!;
        const dir = norm(orbits[oi]!.pos[si]!);
        let best = -1;
        let score = 0.3;
        cities.forEach((cty, i) => {
          if (cty.s && cty.s[2] > 0.2) {
            const dd = dot(dir, cty.s);
            if (dd > score) {
              score = dd;
              best = i;
            }
          }
        });
        if (best >= 0) beams.push({ oi, si, city: best, born: t, life: mix(1.1, 0.7) });
      }
      nextBeam = t + mix(2.2, 0.6) * (0.6 + rand() * 0.8);
    }
    beams = beams.filter((bm) => {
      const age = (t - bm.born) / bm.life;
      const cty = cities[bm.city]!;
      if (age >= 1) {
        cty.flash = Math.max(cty.flash, 0.8);
        ripple(cty.p, col.found, 12, 0.9);
        return false;
      }
      if (!cty.s) return true;
      const a = scr(orbits[bm.oi]!.pos[bm.si]!);
      const b = scr(cty.s);
      const reach = Math.min(1, age * 1.5);
      const ex = a[0] + (b[0] - a[0]) * reach;
      const ey = a[1] + (b[1] - a[1]) * reach;
      const lg = ctx.createLinearGradient(a[0], a[1], ex, ey);
      const alpha = Math.sin(Math.PI * age);
      lg.addColorStop(0, rgba(col.found, 0.9 * alpha));
      lg.addColorStop(1, rgba(col.signal, 0.5 * alpha));
      ctx.strokeStyle = lg;
      ctx.lineWidth = lw * 1.2;
      ctx.setLineDash([lw * 2.5, lw * 2.5]);
      ctx.lineDashOffset = -t * 30;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      return true;
    });
    drawSatellites(true, lw);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    R = Math.min(W, H) / (2 * o.fit);
    cx = W / 2;
    cy = H / 2 - (o.shadow ? R * 0.06 : 0);
    if (!running) draw(0);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  function loop(ts: number) {
    if (!running) return;
    const dt = last == null ? 0.016 : Math.min(0.05, (ts - last) / 1000);
    last = ts;
    draw(dt);
    raf = requestAnimationFrame(loop);
  }

  return {
    start() {
      resize();
      if (reduceMotion.matches || running) return; // still picture for "reduce motion"
      running = true;
      last = null;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    setMode(m) {
      mode = m;
    },
    get running() {
      return running;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
  };
}
