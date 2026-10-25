import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { ProviderError } from '../src/providers/types.js';

// A local stand-in for the Anthropic API, so the real SDK adapter is tested without a key or network.
describe('real Anthropic adapter (DEMO_MODE=0 path)', () => {
  const seen: any[] = [];
  const fake = Fastify();
  let url = '';
  beforeAll(async () => {
    fake.post('/v1/messages', async (req, reply) => {
      seen.push({ body: req.body, headers: req.headers });
      if ((req.body as any).model === 'overloaded') return reply.code(529).send({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
      return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Hello [EMAIL_1]' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 4 } };
    });
    url = await fake.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => fake.close());

  it('sends system separately, never sends sampling params, and maps usage', async () => {
    const p = new AnthropicProvider('test-key-not-real', 5000, url);
    const res = await p.chat('claude-haiku-5-5', { messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hi [EMAIL_1]' }], maxTokens: 100, temperature: 0.7 }, new AbortController().signal);
    expect(res).toEqual({ text: 'Hello [EMAIL_1]', inputTokens: 12, outputTokens: 4, finishReason: 'stop' });
    const body = seen[0].body;
    expect(body.system).toBe('Be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi [EMAIL_1]' }]);
    expect(body.max_tokens).toBe(100);
    expect(body).not.toHaveProperty('temperature');
    expect(seen[0].headers['x-api-key']).toBe('test-key-not-real');
  });

  it('turns server errors into retryable provider errors so the gateway falls back', async () => {
    const p = new AnthropicProvider('test-key-not-real', 5000, url);
    const err = await p.chat('overloaded', { messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
  });
});
