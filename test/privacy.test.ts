import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_PII, testApp } from './helpers.js';

const prompt = `Summarise this note for the account file. Customer details: ${FAKE_PII.join('; ')}. They called about a refund.`;

describe('personal data never leaves and is never logged', () => {
  let ctx: Awaited<ReturnType<typeof testApp>>;
  afterEach(async () => ctx.app.close());

  it('redacts every seeded pattern before the provider call and restores it in the reply (OpenAI format)', async () => {
    ctx = await testApp();
    const res = await ctx.chat('support', { model: 'auto', messages: [{ role: 'user', content: prompt }] });
    expect(res.statusCode).toBe(200);

    const sent = JSON.stringify(ctx.allReceived());
    expect(ctx.allReceived()).toHaveLength(1);
    for (const v of FAKE_PII) expect(sent).not.toContain(v);
    expect(sent).toContain('[EMAIL_1]');
    expect(sent).toContain('[CARD_1]');
    expect(sent).toContain('[NI_NUMBER_1]');
    expect(sent).toContain('[IBAN_1]');
    expect(sent).toContain('[POSTCODE_1]');
    expect(sent).toContain('[PHONE_1]');

    // The mock echoes every token it saw, so the reply must contain every original value again.
    const reply = res.json().choices[0].message.content as string;
    for (const v of FAKE_PII) expect(reply).toContain(v);
    expect(reply).not.toMatch(/\[(EMAIL|CARD|PHONE|IBAN|POSTCODE|NI_NUMBER)_\d+\]/);
    expect(Number(res.headers['x-gateway-redactions'])).toBe(FAKE_PII.length);
  });

  it('keeps raw values out of logs, the ledger, the audit API and the cache', async () => {
    ctx = await testApp({ env: { AUDIT_STORE_REDACTED_PROMPTS: '1' } });
    await ctx.chat('support', { model: 'auto', messages: [{ role: 'user', content: prompt }] });
    await ctx.chat('support', { model: 'auto', messages: [{ role: 'user', content: prompt }] }); // cache hit path

    const rows = await ctx.gw.store.list({});
    const audit = (await ctx.admin('GET', '/admin/requests')).body;
    const summary = (await ctx.admin('GET', '/admin/summary')).body;
    const cacheDump = JSON.stringify([...(ctx.gw.kv as unknown as { data: Map<string, unknown> }).data]);
    const haystacks = { logs: ctx.logs.join('\n'), ledger: JSON.stringify(rows), audit, summary, cache: cacheDump };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const v of FAKE_PII) expect(text, `${v} found in ${where}`).not.toContain(v);
    }
    expect(ctx.logs.length).toBeGreaterThan(0);
    expect(cacheDump).toContain('[EMAIL_1]'); // the cache holds the redacted reply only
    expect(rows[0].redactions).toMatchObject({ email: 3, card: 3, iban: 2, ni_number: 2, postcode: 3, phone: 4 });
    expect(rows[0].redactedPrompt).toContain('[EMAIL_1]');
    // The audit API never exposes prompt text, even redacted.
    expect(audit).not.toContain('Summarise this note');
  });

  it('redacts and restores on the Anthropic Messages passthrough', async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': 'demo-key-data' },
      payload: { model: 'claude-haiku-5-5', max_tokens: 300, system: `Account owner ${FAKE_PII[0]}`, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] },
    });
    expect(res.statusCode).toBe(200);
    const sent = JSON.stringify(ctx.mock('anthropic').received);
    for (const v of FAKE_PII) expect(sent).not.toContain(v);
    expect(res.json().content[0].text).toContain(FAKE_PII[1]);
    expect(res.json().type).toBe('message');
  });

  it('blocks instead of redacting when team policy says so, with no provider call', async () => {
    ctx = await testApp();
    const res = await ctx.chat('marketing', { model: 'auto', messages: [{ role: 'user', content: 'Draft a thank you to the buyer on card 4111 1111 1111 1111' }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.type).toBe('pii_blocked');
    expect(res.json().error.message).toContain('card number');
    expect(ctx.allReceived()).toHaveLength(0);
    expect(res.body).not.toContain('4111');
  });

  it('can block all personal data for a team in block mode', async () => {
    ctx = await testApp({ config: (c) => (c.teams.find((t) => t.id === 'data')!.pii.mode = 'block') });
    const res = await ctx.chat('data', { model: 'auto', messages: [{ role: 'user', content: 'Extract fields from: jane.doe@example.com' }] });
    expect(res.statusCode).toBe(422);
    expect(ctx.allReceived()).toHaveLength(0);
  });
});
