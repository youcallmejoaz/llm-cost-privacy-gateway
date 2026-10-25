import Anthropic from '@anthropic-ai/sdk';
import type { NormalisedRequest, NormalisedResponse } from '../types.js';
import { ProviderError, type Provider } from './types.js';

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic' as const;
  readonly mock = false;
  private client: Anthropic;

  constructor(apiKey: string, timeoutMs: number, baseURL?: string) {
    // Retries are the gateway's job (it falls back across providers), so keep the SDK's low.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1, ...(baseURL ? { baseURL } : {}) });
  }

  async chat(model: string, req: NormalisedRequest, signal: AbortSignal): Promise<NormalisedResponse> {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages: Anthropic.MessageParam[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    try {
      // temperature/top_p/top_k are not sent: the Messages API rejects them on current models.
      const res = await this.client.messages.create(
        { model, max_tokens: req.maxTokens ?? 4096, ...(system ? { system } : {}), messages },
        { signal },
      );
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return {
        text,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        finishReason: res.stop_reason === 'max_tokens' ? 'length' : res.stop_reason === 'end_turn' ? 'stop' : 'other',
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('anthropic timed out', 'anthropic', true, 'timeout');
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('anthropic connection failed', 'anthropic', true);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('anthropic rate limited (429)', 'anthropic', true);
  if (err instanceof Anthropic.InternalServerError) return new ProviderError(`anthropic server error (${err.status})`, 'anthropic', true);
  if (err instanceof Anthropic.APIError) return new ProviderError(`anthropic error ${err.status ?? ''}: ${err.message}`, 'anthropic', (err.status ?? 500) >= 500);
  return new ProviderError(`anthropic: ${(err as Error)?.message ?? 'unknown error'}`, 'anthropic', true);
}
