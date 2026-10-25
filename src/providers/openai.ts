import OpenAI from 'openai';
import type { NormalisedRequest, NormalisedResponse } from '../types.js';
import { ProviderError, type Provider } from './types.js';

export class OpenAIProvider implements Provider {
  readonly id = 'openai' as const;
  readonly mock = false;
  private client: OpenAI;

  constructor(apiKey: string, timeoutMs: number) {
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async chat(model: string, req: NormalisedRequest, signal: AbortSignal): Promise<NormalisedResponse> {
    try {
      const res = await this.client.chat.completions.create(
        {
          model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.responseFormatJson ? { response_format: { type: 'json_object' as const } } : {}),
        },
        { signal },
      );
      const choice = res.choices[0];
      return {
        text: choice?.message?.content ?? '',
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        finishReason: choice?.finish_reason === 'length' ? 'length' : choice?.finish_reason === 'stop' ? 'stop' : 'other',
      };
    } catch (err) {
      if (err instanceof OpenAI.APIConnectionTimeoutError) throw new ProviderError('openai timed out', 'openai', true, 'timeout');
      if (err instanceof OpenAI.APIConnectionError) throw new ProviderError('openai connection failed', 'openai', true);
      if (err instanceof OpenAI.APIError) throw new ProviderError(`openai error ${err.status ?? ''}: ${err.message}`, 'openai', (err.status ?? 500) >= 500 || err.status === 429);
      throw new ProviderError(`openai: ${(err as Error)?.message ?? 'unknown error'}`, 'openai', true);
    }
  }
}
