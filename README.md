# LLM Cost and Privacy Gateway

One gateway between your company's apps and OpenAI, Anthropic and Google. It cuts AI spend with smart routing and caching, removes personal data before anything leaves, and gives every team a budget and an audit trail.

## The problem

- AI bills grow every month, and nobody can say which team or feature is spending what.
- Every app sends customer emails, phone numbers and card numbers straight to one or more AI vendors.
- Each app is wired to one vendor, so a vendor outage takes your features down, and switching is a rewrite.

## What it does

- **One address for every AI vendor.** Apps keep using the OpenAI or Anthropic SDK they already use and change one setting (the base URL).
- **Cheaper model when it is enough.** Simple jobs such as classifying a ticket or pulling fields out of a form go to a small, cheap model. Long analyses and drafts go to a large model. The rules are a plain file you can edit.
- **Repeated questions come from cache** at zero cost, and the saving is recorded.
- **Personal data is removed before it leaves.** Emails, phone numbers, UK National Insurance numbers, card numbers (checked with the Luhn checksum), IBANs (checked with the bank checksum) and postcodes are swapped for tokens like `[EMAIL_1]`, and the real values are put back into the answer. A team policy can block a request instead.
- **Every team has a budget.** It is checked before money is spent. When a team runs out, its apps get a clear message and no call is made.
- **If a vendor goes down, requests switch to another one**, so your apps keep working.
- **Finance and compliance get a dashboard and an audit log**: spend by team and model, savings, redactions, errors and fallbacks. No prompt text is stored.

## How it works, in 4 steps

1. Your apps send AI requests to the gateway instead of straight to each vendor.
2. The gateway removes personal data, checks the team's budget, and picks the cheapest model that can do the job, or answers from cache.
3. If a vendor fails or is slow, it quietly switches to another.
4. Finance sees spend and savings per team, and compliance sees what was removed, without anyone seeing private data.

## Safeguards

- Raw personal data never reaches a vendor or the logs when redaction is on. Tests prove it with seeded fake values (`test/privacy.test.ts`).
- Budgets are enforced before the call, not after. Concurrent requests cannot push a team past its budget (tested).
- Only official API keys. No consumer subscription accounts and no sharing of vendor keys: each team gets its own virtual key, stored only as a hash.
- Request and response bodies are never logged. The audit log holds team, model, tokens, cost and policy decisions.
- Supply chain: every dependency pinned to an exact version, lockfile committed, `npm ci` only, install scripts disabled, GitHub Actions pinned to commit hashes, a production dependency audit and a CycloneDX SBOM generated in CI.

## Demo

- Proposal cut (61 seconds, voiceover, no captions): [`clips/proposal_cut.mp4`](clips/proposal_cut.mp4)
- Full walkthrough on YouTube: _link coming soon_
- All clips: [`clips/MANIFEST.md`](clips/MANIFEST.md)

### Results on the sample traffic

These numbers come from `npm run seed` (200 sample requests from three demo teams, mock providers, sample prices). Your savings depend on your own traffic; the dashboard shows real numbers from your own logs.

| | |
|---|---|
| Requests | 200 (Support 91, Marketing 49, Data 60) |
| Spend | $0.2490 at sample prices |
| Same traffic sent to each team's default large model | $0.3066 |
| Saved | $0.0576 (19 percent): $0.0540 from routing, $0.0036 from cache |
| Personal data items removed | 286 |
| Stopped by policy | 8 over budget (Marketing), 2 card numbers blocked by Marketing's policy |

Most of the sample spend is long analyses and drafts, which correctly stay on the large model, so routing saves on the high volume small jobs. Traffic with more classification and extraction saves more.

## Setup

Requirements: Node 22. Docker is optional.

```bash
git clone https://github.com/youcallmejoaz/llm-cost-privacy-gateway.git
cd llm-cost-privacy-gateway
npm ci
npm run dev          # gateway on :8787, dashboard on http://localhost:3000 (demo mode, no keys)
npm run seed         # in a second terminal: replay the 200 sample requests
```

Or the full stack with Redis and Postgres:

```bash
docker compose up
npm run seed
```

### Point an app at the gateway

```ts
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://localhost:8787/v1', apiKey: 'demo-key-support' });
await client.chat.completions.create({ model: 'auto', messages: [{ role: 'user', content: 'Classify this ticket: ...' }] });
```

```ts
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ baseURL: 'http://localhost:8787', apiKey: 'demo-key-data' });
await client.messages.create({ model: 'auto', max_tokens: 500, messages: [{ role: 'user', content: 'Summarise: ...' }] });
```

`model` can be `auto` (routing rules decide), `small`, `large`, `cheapest`, or an exact model such as `claude-haiku-5-5`. Every response carries `x-gateway-model`, `x-gateway-cost-usd`, `x-gateway-saved-usd`, `x-gateway-cache` and `x-gateway-redactions` headers.

### Real providers

```bash
cp .env.example .env
# set DEMO_MODE=0, ADMIN_TOKEN, and at least ANTHROPIC_API_KEY (OPENAI_API_KEY and GOOGLE_API_KEY are optional)
npm run dev
npm run keys:create -- support "helpdesk app"   # prints a virtual key once
```

Providers without a key are skipped in routing and fallback. Demo keys (`demo-key-*`) only work in demo mode.

### Change the rules

Rules, prices, tiers and team budgets are files in `config/`. The gateway reloads them when you save. For example, to send Support's classifications to the cheapest model, add this as the first rule in `config/routing.json`:

```json
{ "name": "support-classification-cheapest", "when": { "team": "support", "task": ["classification"] }, "route": "cheapest" }
```

Prices in `config/prices.json` are **sample prices**: Anthropic rows match the public list price in October 2026, OpenAI and Google rows are examples. Edit them to your contract rates.

## Architecture

```
apps (OpenAI or Anthropic SDK)
   |
   v
gateway (Fastify, TypeScript)
   auth (virtual key) -> rate limit -> allowed models -> personal data (redact or block)
   -> classify job -> routing rules -> cache -> budget reserve -> provider call with fallback
   -> cost from price table -> ledger and audit row -> restore personal data -> reply
   |
   +-- Anthropic SDK / OpenAI SDK / Google Gen AI SDK (or deterministic mocks in demo mode)
   +-- Redis: cache, budget counters, rate limit windows (in-memory fallback)
   +-- Postgres: teams, hashed virtual keys, request ledger (in-memory fallback)

dashboard (Next.js) -> server side proxy -> gateway admin API
```

See [`PLAN.md`](PLAN.md) for the data model and build plan, and [`CLAUDE.md`](CLAUDE.md) for the hard rules.

## Tests

```bash
npm test
```

54 tests (Vitest). The Postgres and Redis suite runs when `TEST_DATABASE_URL` and `TEST_REDIS_URL` are set, as in CI.

- Every seeded personal data pattern is redacted before the provider call and restored in the reply; none appear in logs, the ledger, the audit API or the cache.
- A team over budget gets a 429 and no provider call is made; concurrent requests never overspend.
- All 198 routable sample requests go to the expected small or large model.
- A second identical request is a cache hit costing zero.
- When the primary provider returns errors or times out, the request succeeds through the fallback.
- Ledger totals match the price table maths.
- `DEMO_MODE=1` runs end to end with no keys (spawns the real server and the seed script).
- The real Anthropic adapter is tested against a local stand-in API (request shape, no sampling parameters, error mapping).

Load test (`npm run loadtest`, gateway only, mock provider answering instantly, in-memory stores, 10 connections): about 4,000 requests per second, p50 1 ms, p99 6 ms added per call.

## Honest limits

- Savings depend on your traffic. Demo numbers come from sample traffic and sample prices.
- Regex and checksum redaction catches structured data well. Names and free text addresses need an optional NER model and are still not perfect. Images, files and tool calls are refused rather than sent unredacted.
- Streaming on `/v1/chat/completions` is emulated: the full answer is fetched (so personal data can be restored safely) and then sent in chunks.
- The semantic cache is optional, in-process, and matches near duplicates, not paraphrases.
- Running cost estimate: one small container plus Redis and Postgres.
