// Spec 001 tech §11 `search-link.test.ts` (FR-INT-013).
import { describe, expect, it } from 'vitest';
import { newSearchId, parseSearchRef, searchRef } from '../src/intake/ids';

const SECRET = 'x'.repeat(32);

describe('search links', () => {
  it('creates unique UUIDv7 ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, newSearchId));
    expect(ids.size).toBe(1000);
    expect([...ids][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('round-trips a genuine reference and rejects tampered ones', () => {
    const id = newSearchId();
    const ref = searchRef(id, SECRET);
    expect(ref).toMatch(/^.{36}\.[0-9a-f]{8}$/);
    expect(parseSearchRef(ref, SECRET)).toBe(id);
    expect(parseSearchRef(`${id}.00000000`, SECRET)).toBeNull();
    expect(parseSearchRef(ref, 'y'.repeat(32))).toBeNull();
    expect(parseSearchRef(id, SECRET)).toBeNull();
    expect(parseSearchRef('../../etc', SECRET)).toBeNull();
  });
});
