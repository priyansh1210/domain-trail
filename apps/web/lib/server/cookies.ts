// Cookies read from a request and written to its response. Route handlers take the Request and return a Response,
// so they stay testable without the framework's request context; pages pass the cookies they can read.

export interface CookieOptions {
  path?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none' | boolean;
  expires?: Date;
  domain?: string;
}

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    try {
      out.set(name, decodeURIComponent(raw));
    } catch {
      out.set(name, raw);
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`);
  if (o.domain) parts.push(`Domain=${o.domain}`);
  if (o.httpOnly !== false) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  const same = o.sameSite === true ? 'Strict' : o.sameSite === false ? undefined : (o.sameSite ?? 'lax');
  if (same) parts.push(`SameSite=${same[0]!.toUpperCase()}${same.slice(1)}`);
  return parts.join('; ');
}

export class CookieJar {
  private readonly values: Map<string, string>;
  private readonly outgoing = new Map<string, string>();

  constructor(
    header: string | null,
    /** Secure cookies everywhere except plain-HTTP local development and tests. */
    private readonly secure = false,
  ) {
    this.values = parseCookies(header);
  }

  static from(req: Request, secure = new URL(req.url).protocol === 'https:'): CookieJar {
    return new CookieJar(req.headers.get('cookie'), secure);
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  getAll(): Array<{ name: string; value: string }> {
    return [...this.values].map(([name, value]) => ({ name, value }));
  }

  set(name: string, value: string, options: CookieOptions = {}): void {
    if (value === '' || options.maxAge === 0) this.values.delete(name);
    else this.values.set(name, value);
    this.outgoing.set(name, serializeCookie(name, value, { secure: this.secure, ...options }));
  }

  delete(name: string): void {
    this.set(name, '', { maxAge: 0 });
  }

  /** Adds the Set-Cookie headers collected so far to a response. */
  apply<T extends Response>(res: T): T {
    for (const c of this.outgoing.values()) res.headers.append('set-cookie', c);
    return res;
  }
}
