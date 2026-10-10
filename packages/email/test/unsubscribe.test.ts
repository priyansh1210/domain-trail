// Spec 011 tech §11 `unsubscribe.test.ts`: token sign/verify (FR-ACC-009, NFR-ACC-005).
import { describe, expect, it } from 'vitest';
import { unsubscribeToken, verifyUnsubscribeToken } from '../src';

const USER = '0190f5a8-0000-7000-8000-00000000a001';
const SECRET = 'x'.repeat(32);

describe('unsubscribe tokens', () => {
  it('round-trips the user id', () => {
    expect(verifyUnsubscribeToken(unsubscribeToken(USER, SECRET), SECRET)).toBe(USER);
  });

  it('rejects tampered tokens and other secrets', () => {
    const token = unsubscribeToken(USER, SECRET);
    expect(verifyUnsubscribeToken(token, 'y'.repeat(32))).toBeNull();
    expect(verifyUnsubscribeToken(`${token.slice(0, -1)}A`, SECRET)).toBeNull();
    const other = Buffer.from('0190f5a8-0000-7000-8000-00000000a002').toString('base64url');
    expect(verifyUnsubscribeToken(`${other}.${token.split('.')[1]}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('garbage', SECRET)).toBeNull();
  });
});
