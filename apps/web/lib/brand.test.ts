import { describe, expect, it } from 'vitest';
import { wordmarkParts } from './brand';

describe('wordmarkParts', () => {
  it('gives the last word its own colour', () => {
    expect(wordmarkParts('Domain Trail')).toEqual(['Domain ', 'Trail']);
    expect(wordmarkParts('My Great Site')).toEqual(['My Great ', 'Site']);
  });

  it('keeps a one-word name whole', () => {
    expect(wordmarkParts('Domain_Trail')).toEqual(['Domain_Trail', '']);
    expect(wordmarkParts('  Trail ')).toEqual(['Trail', '']);
  });
});
