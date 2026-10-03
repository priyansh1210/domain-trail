// Public surface of the free-domains package (spec 007).
export { createFreeChecker, type FreeChecker, type FreeStatus, parseTakenList } from './check';
export {
  type Eligibility,
  eligible,
  type FreeProvider,
  type ProfileForFree,
  type ProviderKind,
  PROVIDERS,
  PROVIDERS_REVIEWED_AT,
  selectProviders,
} from './providers';
export { findFreeNames, type FreeLabel, type FreeResult } from './rank';
