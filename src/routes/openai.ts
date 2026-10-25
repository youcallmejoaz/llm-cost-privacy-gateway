import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Gateway, GatewayMeta, PipelineResult } from '../pipeline.js';
import { modelName } from '../providers/registry.js';
import type { ChatMessage } from '../types.js';

const Content = z.union([
  z.string(),
  z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
]);

const ChatBody = z
  .object({
    model: z.string().default('auto'),
    messages: z
      .array(z.object({ role: z.enum(['system', 'developer', 'user', 'assistant']), content: Content.nullable() }).passthrough())
      .min(1),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    response_format: z.object({ type: z.string() }).passthrough().optional(),
    tools: z.array(z.unknown()).optional(),
  })
  .passthrough();

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const x = req.headers['x-api-key'];
  return typeof x === 'string' ? x : undefined;
}

export function setMetaHeaders(reply: FastifyReply, meta: Partial<GatewayMeta> | undefined): void {
  if (!meta) return;
  if (meta.requestId) reply.header('x-gateway-request-id', meta.requestId);
  if (meta.model) reply.header('x-gateway-model', meta.model);
  if (meta.rule) reply.header('x-gateway-route', meta.rule);
  if (meta.cache) reply.header('x-gateway-cache', meta.cache);
  if (meta.costUsd !== undefined) reply.header('x-gateway-cost-usd', meta.costUsd.toFixed(6));
  if (meta.savedUsd !== undefined) reply.header('x-gateway-saved-usd', meta.savedUsd.toFixed(6));
  if (meta.redactions !== undefined) reply.header('x-gateway-redactions', String(meta.redactions));
  if (meta.fallback !== undefined) reply.header('x-gateway-fallback', String(meta.fallback));
}

function textOf(content: z.infer<typeof Content> | null): string {
  if (content === null) return '';
  if (typeof content === 'string') return content;
  return content.map((p) => (p.type === 'text' ? p.text ?? '' : '')).join('');
}

export function registerOpenAIRoutes(app: FastifyInstance, gw: Gateway): void {
  app.post('/v1/chat/completions', async (req, reply) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    }
    const body = parsed.data;
    if (body.tools?.length) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Tool calling is not supported by this gateway build yet.' } });
    }
    if (body.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type !== 'text'))) {
      return reply.code(400).send({ error: { type: 'invalid_request_error', message: 'Only text content is supported by this gateway build (images and files are not yet redacted, so they are refused).' } });
    }
    const messages: ChatMessage[] = body.messages.map((m) => ({ role: m.role === 'developer' ? 'system' : m.role, content: textOf(m.content) }));
    const result = await gw.handle({
      endpoint: 'openai',
      rawKey: bearer(req),
      requestedModel: body.model,
      req: {
        messages,
        maxTokens: body.max_completion_tokens ?? body.max_tokens,
        temperature: body.temperature,
        responseFormatJson: body.response_format?.type === 'json_object' || body.response_format?.type === 'json_schema',
      },
      cacheEnabled: req.headers['x-gateway-cache'] !== 'off',
    });
    return sendOpenAI(reply, result, body.stream === true);
  });

  app.get('/v1/models', async () => ({
    object: 'list',
    data: ['auto', 'small', 'large', 'cheapest', ...Object.keys(gw.cfg.prices.models)].map((id) => ({ id, object: 'model', owned_by: 'gateway' })),
  }));
}

function sendOpenAI(reply: FastifyReply, result: PipelineResult, stream: boolean) {
  setMetaHeaders(reply, result.meta);
  if (!result.ok) {
    if (result.retryAfterSeconds) reply.header('retry-after', String(result.retryAfterSeconds));
    return reply.code(result.status).send({ error: { type: result.type, code: result.type, message: result.message }, gateway: result.meta });
  }
  const id = `chatcmpl-${result.meta.requestId.slice(4)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = result.meta.model ? modelName(result.meta.model) : 'unknown';
  const finish = result.finishReason === 'length' ? 'length' : 'stop';
  if (!stream) {
    return reply.send({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: finish }],
      usage: { prompt_tokens: result.inputTokens, completion_tokens: result.outputTokens, total_tokens: result.inputTokens + result.outputTokens },
      gateway: result.meta,
    });
  }
  // Streaming is emulated: the full reply is fetched (so tokens can be restored safely), then sent in chunks.
  reply.raw.writeHead(200, { ...(reply.getHeaders() as Record<string, string>), 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const chunk = (delta: object, finish_reason: string | null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  reply.raw.write(chunk({ role: 'assistant', content: '' }, null));
  for (const piece of result.text.match(/[\s\S]{1,24}/g) ?? []) reply.raw.write(chunk({ content: piece }, null));
  reply.raw.write(chunk({}, finish));
  reply.raw.write('data: [DONE]\n\n');
  reply.raw.end();
  return reply;
}
