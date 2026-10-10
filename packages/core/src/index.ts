// Server-side entry. Browser code imports from '@domains-all/core/client' (no Node APIs).
export * from './client';
export * from './intake/request';
export * from './intake/ids';
export * from './features/interpret';
export * from './features/mock-hint';
export * from './features/rules';
export * from './safety/gate';
export { setPopularBrands } from './safety/brand-risk';
export * from './pipeline/s1';
export * from './pipeline/names';
export * from './pipeline/verify';
export { isWord } from './generation/lexicon';
export { segment } from './generation/quality';
export { MemoryWordCache, type WordCache } from './generation/related';
export type { Idea, Reason } from './ranking/score';
