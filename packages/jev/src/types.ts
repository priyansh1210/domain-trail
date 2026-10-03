// Types for the Jev decision service (spec 002 tech §4) and the wire contract
// (specs/002-jev-integration/contracts/jev-systemone.schema.json).

export type QuestionType = 'choice' | 'score' | 'noul';
export type QuestionGroup = 'safety' | 'features' | 'keywords' | 'rank_r1' | 'rank_r2' | 'tld_fit';

interface BaseDef {
  id: string;
  version: number;
  group: QuestionGroup;
  /** May contain {placeholders} filled from `vars` at ask time. */
  instructions: string;
}

export interface ChoiceDef extends BaseDef {
  type: 'choice';
  /** Option key → description; 'runtime' when options are built per request (e.g. keyword lists). */
  criteria: Record<string, string> | 'runtime';
}

export interface ScoreDef extends BaseDef {
  type: 'score';
  /** Ordered rubric levels, lowest first. */
  criteria: string[];
}

export interface NoulDef extends BaseDef {
  type: 'noul';
}

export type QuestionDef = ChoiceDef | ScoreDef | NoulDef;

/** `id@version`, stored with answers so old results stay interpretable (tech §5.9). */
export const refOf = (def: QuestionDef): string => `${def.id}@${def.version}`;

// ----- wire format -----

export type WireQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };

export interface SystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, WireQuestion>;
}

export type Answer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: 'score';
      score: number;
      probabilities: number[];
      legend?: Record<string, string>;
      confidence: number;
    }
  | { type: 'noul'; noul: number };

export interface SystemOneResponse {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens?: number };
}

// ----- service interface -----

export interface AskQuestion {
  /** Name sent to Jev: `id` or `id__n` for per-candidate questions. */
  name: string;
  def: QuestionDef;
  vars?: Record<string, string>;
  criteriaOverride?: Record<string, string> | string[];
}

export type DegradedReason = 'jev_unavailable' | 'budget';

export interface AskResult {
  answers: Record<string, Answer>;
  /** Question names that need the fallback. */
  failed: string[];
  usage: { inputTokens: number; requests: number };
  requestIds: string[];
  degraded: boolean;
  degradedReason?: DegradedReason;
  modelVersion: string;
  /** `name → id@version` for every answered question. */
  refs: Record<string, string>;
}

export interface AskParams {
  state: unknown;
  questions: AskQuestion[];
  /** Absolute deadline (epoch ms) for this pipeline stage. */
  deadline: number;
  searchId: string;
}
