import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Gateway } from '../pipeline.js';
import { modelName } from '../providers/registry.js';
import type { ChatMessage } from '../types.js';
import { bearer, setMetaHeaders } from './openai.js';

const Block = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const Content = z.union([z.string(), z.array(Block)]);

const MessagesBody = z
  .object({
    model: z.string().default('auto'),
    max_tokens: z.number().int().positive(),
    system: Content.optional(),
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: Content })).min(1),
    stream: z.boolean().optional(),
    tools: z.array(z.unknown()).optional(),
  })
  .passthrough();

const DROPPED = ['temperature', 'top_p', 'top_k'];

function textOf(c: z.infer<typeof Content> | undefined): string {
  if (!c) return '';
  if (typeof c === 'string') return c;
  return c.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n');
}

/**
 * Anthropic Messages format in and out, so apps using the Anthropic SDK only
 * change their base URL. Traffic stays on Anthropic models; text blocks are
 * redacted and restored like every other request.
 */
export function registerAnthropicRoutes(app: FastifyInstance, gw: Gateway): void {
  app.post('/v1/messages', async (req, reply) => {
    const parsed = MessagesBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ type: 'error', error: { type: 'invalid_request_error', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    }
    const body = parsed.data;
    const blocks = [body.system, ...body.messages.map((m) => m.content)].flatMap((c) => (Array.isArray(c) ? c : []));
    if (body.tools?.length || blocks.some((b) => b.type !== 'text')) {
      return reply.code(400).send({ type: 'error', error: { type: 'invalid_request_error', message: 'This gateway build passes through text content only. Tools, images and documents are not supported yet.' } });
    }
    if (body.stream) {
      return reply.code(400).send({ type: 'error', error: { type: 'invalid_request_error', message: 'Streaming on /v1/messages is not supported by this build. Send stream: false.' } });
    }
    const dropped = DROPPED.filter((k) => k in body);
    if (dropped.length) reply.header('x-gateway-dropped-params', dropped.join(','));

    const messages: ChatMessage[] = [];
    const system = textOf(body.system);
    if (system) messages.push({ role: 'system', content: system });
    for (const m of body.messages) messages.push({ role: m.role, content: textOf(m.content) });

    const result = await gw.handle({
      endpoint: 'anthropic',
      rawKey: bearer(req),
      requestedModel: body.model,
      req: { messages, maxTokens: body.max_tokens },
      onlyProvider: 'anthropic',
      cacheEnabled: req.headers['x-gateway-cache'] !== 'off',
    });
    setMetaHeaders(reply, result.meta);
    if (!result.ok) {
      if (result.retryAfterSeconds) reply.header('retry-after', String(result.retryAfterSeconds));
      return reply.code(result.status).send({ type: 'error', error: { type: result.type, message: result.message } });
    }
    return reply.send({
      id: `msg_${result.meta.requestId.slice(4)}`,
      type: 'message',
      role: 'assistant',
      model: result.meta.model ? modelName(result.meta.model) : body.model,
      content: [{ type: 'text', text: result.text }],
      stop_reason: result.finishReason === 'length' ? 'max_tokens' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
    });
  });
}
