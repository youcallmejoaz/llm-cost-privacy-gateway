import type { NormalisedRequest, NormalisedResponse, ProviderId } from '../types.js';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly retryable: boolean,
    readonly kind: 'error' | 'timeout' = 'error',
  ) {
    super(message);
  }
}

/** The single interface every AI vendor sits behind. */
export interface Provider {
  readonly id: ProviderId;
  readonly mock: boolean;
  chat(model: string, req: NormalisedRequest, signal: AbortSignal): Promise<NormalisedResponse>;
}
