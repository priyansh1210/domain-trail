// Tunable values taken from the approved specs (2026-10-03). Constitution P8: caps are configuration,
// not numbers buried in feature code — feature code imports from here. Env overrides come in later milestones.

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const PIPELINE_VERSION = '0.1.0';

/** Spec 001 FR-INT-002, FR-INT-004, FR-INT-005, FR-INT-008. */
export const intake = {
  descriptionMin: 20,
  descriptionMax: 2000,
  maxLabelLengthRange: [6, 20] as const,
  preferenceDefaults: {
    maxLength: 15,
    allowHyphens: false,
    allowDigits: true,
    country: 'auto',
    includeFree: true,
  },
  resultCacheTtlSeconds: 24 * HOUR,
} as const;

/** Spec 014 FR-ABU-002, FR-ABU-003, FR-ABU-009. Signed-in means a non-anonymous session. */
export const rateLimits = {
  search: {
    anonymous: { limit: 5, windowSeconds: 10 * 60 },
    signedIn: { limit: 10, windowSeconds: 10 * 60 },
  },
  searchDay: { anonymous: 30, signedIn: 60 },
  moreOrRefineCost: 0.5,
  recheckPerMinute: 10,
  feedbackPerHour: 60,
  eventsPerHour: 120,
  snapshotPerMinute: 60,
  requestBodyMaxBytes: 16 * 1024,
  excludeListMax: 500,
} as const;

/** Spec 005 FR-AVL-005 (freshness windows) and tech §6–7 caps. */
export const availability = {
  ttlSeconds: {
    available: 6 * HOUR,
    likely_available: 6 * HOUR,
    available_premium: 24 * HOUR,
    taken: 7 * DAY,
    dropping_soon: 24 * HOUR,
    unknown: 1 * HOUR,
  },
  rdapRequestsPerSecondPerServer: 5,
  dohMaxPerSearch: 400,
  dohConcurrency: 25,
  rdapDailyCap: 60_000,
  dohDailyCap: 150_000,
} as const;

/** Spec 006 FR-PRC-003, FR-PRC-004, FR-PRC-010, FR-PRC-015, NFR-PRC-002. Money in USD cents. */
export const pricing = {
  sectionUpperBoundsUsdCents: { budget: 10_000, mid: 30_000 },
  sliderMaxUsd: 10_000,
  renewalWarningRatio: 2,
  priceStaleHours: 30,
  displayCurrencies: 'all' as 'all' | readonly string[],
} as const;

/** Spec 007 FR-FREE-007, spec 008 FR-RANK-008/009. */
export const ranking = {
  resultsPerSection: 20,
  maxExtensionsPerNamePerSection: 3,
  maxStyleShare: 0.4,
  freeResultsMax: 15,
} as const;

/** Spec 002 tech §5.5 and §7, spec 015 §5.1. */
export const jev = {
  model: 'jev-1.13.0',
  maxQuestionsPerRequest: 50,
  requestTimeoutMs: 8000,
  tokensPerSearchMax: 25_000,
  monthlyTokenCap: 100_000_000,
  dailyTokenCap: 4_000_000,
  evalMonthlyTokenCap: 10_000_000,
} as const;

/** Spec 003 tech §5.2 thresholds and spec 014 tech §5.3 safety thresholds. */
export const features = {
  flagOn: 0.6,
  unsureConfidence: 0.55,
  alternativesMinP: 0.1,
  alternativesMax: 3,
  clarityVagueBelow: 1.0,
  rulesConfidence: 0.4,
  adultOn: 0.7,
} as const;

export const safety = {
  refuseAt: 0.8, // safety_phishing, safety_illegal
  strictBrandAt: 0.7, // safety_impersonation
} as const;

/** Spec 002 tech §10: per-stage deadlines for Jev decisions. */
export const stageDeadlinesMs = { S1: 4000, S2: 3000, S5: 3000, S6: 4000 } as const;

/** Spec 011 FR-ACC-004/005/008/019. */
export const accounts = {
  savedSearchesMax: 20,
  watchlistMax: 100,
  notificationListDays: 30,
  anonSavedRetentionDays: 90,
  priceChangeAlertRatio: 0.1,
} as const;

/** Spec 012 §3 and tech §5.2–5.3. */
export const retention = {
  anonymousSearchDays: 7,
  resultCacheHours: 24,
  domainCheckGraceDays: 30,
  wordCacheDays: 30,
  keywordTrendDays: 180,
  fxRateDays: 90,
  notificationDays: 90,
  feedbackMonths: 13,
  contactMessageDays: 365,
  emailLogDays: 90,
  jobRunDays: 90,
  backupDays: 28,
  dbSizeLimitMb: 500,
  dbSizeWarnRatio: 0.6,
  dbSizeMaxRatio: 0.7,
} as const;

/** Spec 015 FR-OBS-004, FR-OBS-010, spec 000 NFR-SYS-010. */
export const observability = {
  alertThresholds: [0.5, 0.8, 1] as const,
  alertDedupeSeconds: 6 * HOUR,
  dataStaleWarningHours: 30,
  healthCacheSeconds: 30,
  healthDependencyTimeoutMs: 2000,
} as const;
