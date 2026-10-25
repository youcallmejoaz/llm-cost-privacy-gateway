export type ProviderId = 'openai' | 'anthropic' | 'google';

/** A model reference in the form "provider:model", e.g. "anthropic:claude-haiku-5-5". */
export type ModelRef = `${ProviderId}:${string}`;

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** Provider-neutral request that every provider adapter accepts. */
export interface NormalisedRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  responseFormatJson?: boolean;
}

export interface NormalisedResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: 'stop' | 'length' | 'other';
}

export type Task = 'classification' | 'extraction' | 'summary' | 'draft' | 'analysis' | 'chat';

export type PiiType = 'email' | 'phone' | 'ni_number' | 'card' | 'iban' | 'postcode';

export type PiiMode = 'redact' | 'block' | 'off';

export interface Team {
  id: string;
  name: string;
  monthlyBudgetUsd: number;
  rpmLimit: number;
  allowedModels: string[];
  defaultModel: ModelRef;
  pii: { mode: PiiMode; blockTypes: PiiType[] };
}

export type CacheOutcome = 'miss' | 'exact' | 'semantic' | 'skipped';

export type RequestStatus = 'ok' | 'blocked_budget' | 'blocked_pii' | 'rate_limited' | 'forbidden_model' | 'error';

export interface Attempt {
  model: ModelRef;
  outcome: 'ok' | 'error' | 'timeout' | 'skipped';
  ms: number;
  error?: string;
}

/** One row in the ledger and audit log. Never holds prompt or reply text. */
export interface LedgerEntry {
  id: string;
  ts: string;
  teamId: string;
  keyId: string;
  endpoint: 'openai' | 'anthropic';
  requestedModel: string;
  routedModel: ModelRef | null;
  routeRule: string;
  task: Task;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  baselineModel: ModelRef;
  baselineCostUsd: number;
  savedUsd: number;
  cache: CacheOutcome;
  redactions: Partial<Record<PiiType, number>>;
  policy: string[];
  status: RequestStatus;
  httpStatus: number;
  attempts: Attempt[];
  fallbackUsed: boolean;
  latencyMs: number;
  /** Only filled when AUDIT_STORE_REDACTED_PROMPTS=1, and only with redacted text. */
  redactedPrompt?: string;
}
