import { describe, expect, it } from 'vitest';
import { EnvError, jevKey, missingForLive, parseServerEnv } from '../src/env';
import { absoluteUrl, siteIdentity } from '../src/site';

const OWNER = '0190f5a8-0000-7000-8000-000000000001';

describe('server env', () => {
  it('starts in mock mode with e-mail off and the pinned Jev model', () => {
    const env = parseServerEnv({});
    expect(env.MOCK_EXTERNALS).toBe(true);
    expect(env.EMAIL_MODE).toBe('off');
    expect(env.JEV_MODEL).toBe('jev-1.13.0');
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
    expect(env.PRICE_PROVIDERS).toEqual(['porkbun-pricing']);
  });

  it('reads booleans the way hosting dashboards store them', () => {
    expect(parseServerEnv({ MOCK_EXTERNALS: '0' }).MOCK_EXTERNALS).toBe(false);
    expect(parseServerEnv({ MOCK_EXTERNALS: 'false' }).MOCK_EXTERNALS).toBe(false);
    expect(parseServerEnv({ MOCK_EXTERNALS: '1' }).MOCK_EXTERNALS).toBe(true);
  });

  it('treats empty strings as unset', () => {
    const env = parseServerEnv({ NEXT_PUBLIC_SITE_URL: '', OWNER_ALERT_EMAIL: '  ' });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
    expect(env.OWNER_ALERT_EMAIL).toBeUndefined();
  });

  it('rejects a moving model alias (FR-JEV-003)', () => {
    expect(() => parseServerEnv({ JEV_MODEL: 'latest' })).toThrow(EnvError);
  });

  it('defaults the admin list to the owner (spec 011 §5.8)', () => {
    expect(parseServerEnv({ OWNER_USER_ID: OWNER }).ADMIN_USER_IDS).toEqual([OWNER]);
    expect(parseServerEnv({}).ADMIN_USER_IDS).toEqual([]);
  });

  it('names the variable but never echoes its value', () => {
    const value = 'short-secret-value';
    try {
      parseServerEnv({ SEARCH_LINK_SECRET: value });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as Error).message).toContain('SEARCH_LINK_SECRET');
      expect((e as Error).message).not.toContain(value);
    }
  });

  it('lists what live mode still needs', () => {
    const missing = missingForLive(parseServerEnv({ MOCK_EXTERNALS: '0' }));
    expect(missing).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(missing).toContain('AI_GATEWAY_API_KEY');
    expect(missing).not.toContain('RESEND_API_KEY');
    expect(missingForLive(parseServerEnv({ EMAIL_MODE: 'on' }))).toContain('RESEND_API_KEY');
  });

  it('asks for the Jev key that belongs to the chosen route', () => {
    expect(jevKey(parseServerEnv({}))[0]).toBe('AI_GATEWAY_API_KEY');
    expect(jevKey(parseServerEnv({ JEV_ROUTE: 'ngrok', NGROK_AI_API_KEY: 'k' }))).toEqual([
      'NGROK_AI_API_KEY',
      'k',
    ]);
    expect(missingForLive(parseServerEnv({ MOCK_EXTERNALS: '0', JEV_ROUTE: 'ngrok' }))).toContain(
      'NGROK_AI_API_KEY',
    );
  });

  it('keeps the grievance contact decided by the owner (FR-PRIV-007)', () => {
    const env = parseServerEnv({});
    expect(env.GRIEVANCE_NAME).toBe('Priyansh K');
    expect(env.GRIEVANCE_EMAIL).toBe('priyansh1210@gmail.com');
  });
});

describe('site identity (FR-SYS-011)', () => {
  it('builds absolute links from the configured address only', () => {
    const env = { NEXT_PUBLIC_SITE_NAME: 'Example', NEXT_PUBLIC_SITE_URL: 'https://example.test/' };
    expect(siteIdentity(env)).toMatchObject({ name: 'Example', origin: 'https://example.test' });
    expect(absoluteUrl('/s/abc', env)).toBe('https://example.test/s/abc');
  });
});
