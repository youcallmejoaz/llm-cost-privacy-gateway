import { GoogleGenAI } from '@google/genai';
import type { NormalisedRequest, NormalisedResponse } from '../types.js';
import { ProviderError, type Provider } from './types.js';

export class GoogleProvider implements Provider {
  readonly id = 'google' as const;
  readonly mock = false;
  private client: GoogleGenAI;

  constructor(apiKey: string, private timeoutMs: number) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(model: string, req: NormalisedRequest, signal: AbortSignal): Promise<NormalisedResponse> {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    try {
      const res = await this.client.models.generateContent({
        model,
        contents,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.responseFormatJson ? { responseMimeType: 'application/json' } : {}),
          abortSignal: signal,
          httpOptions: { timeout: this.timeoutMs },
        },
      });
      const finish = res.candidates?.[0]?.finishReason;
      return {
        text: res.text ?? '',
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
        finishReason: finish === 'MAX_TOKENS' ? 'length' : finish === 'STOP' ? 'stop' : 'other',
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new ProviderError(`google error ${status ?? ''}: ${(err as Error)?.message ?? 'unknown'}`, 'google', status === undefined || status >= 500 || status === 429);
    }
  }
}
