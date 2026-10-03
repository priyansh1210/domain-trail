// Shared generator input for the strategy tests.
import type { GenInput } from '../../src/generation/strategies';

export const INPUT: GenInput = {
  words: [
    { word: 'bread', weight: 0.3, core: true },
    { word: 'bakery', weight: 0.25, core: true },
    { word: 'cake', weight: 0.2, core: true },
    { word: 'crust', weight: 0.1, core: false },
    { word: 'loaf', weight: 0.1, core: false },
    { word: 'oven', weight: 0.05, core: false },
    { word: 'cakes', weight: 0.05, core: false },
  ],
  phrases: ['sourdough bread'],
  geoWords: ['pune'],
  actionVerbs: ['order', 'shop'],
  personalNames: ['priya'],
  hackTlds: ['es', 'ly'],
  maxLength: 15,
};
