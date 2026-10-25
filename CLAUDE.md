# CLAUDE.md

## What this is

An LLM cost and privacy gateway. Company apps send AI requests here instead of straight to OpenAI, Anthropic or Google. The gateway removes personal data, enforces team budgets and rate limits, routes each request to the cheapest model that can do the job, answers repeats from cache, falls back to another provider on failure, and records cost and policy decisions in a ledger. A Next.js dashboard shows spend, savings, redactions, errors and fallbacks.

## Folder map

| Path | What |
|---|---|
| `src/app.ts` | Fastify app wiring, store selection (Redis/Postgres or in-memory) |
| `src/pipeline.ts` | The request pipeline: auth, rate limit, allowed models, PII, routing, cache, budget, provider call, ledger |
| `src/pii/` | Detectors (email, phone, NI number, card + Luhn, IBAN + mod 97, postcode) and the per-request `Redactor` |
| `src/routing/` | Rule based task classifier and the data driven `Router` |
| `src/providers/` | One `Provider` interface; OpenAI, Anthropic, Google adapters, deterministic mock, fallback registry with circuit breaker |
| `src/store/` | KV (Redis or memory) and Store (Postgres or memory), SQL schema |
| `src/routes/` | `/v1/chat/completions`, `/v1/messages`, `/admin/*` |
| `config/` | Data, not code: `prices.json` (sample prices), `models.json` (tiers and fallbacks), `routing.json` (rules), `teams.json` |
| `fixtures/` | Recorded mock replies and the fake personal data used by tests and demo traffic |
| `demo/` | 200 sample requests, `seed.ts`, `outage.ts` |
| `dashboard/` | Next.js dashboard and demo client app (talks to the gateway through a server side proxy) |
| `test/` | Vitest suites |
| `clips/`, `docs/` | Video clips and portfolio material |

## Commands

```bash
npm ci                  # lockfile install only (install scripts disabled in .npmrc)
npm run dev             # gateway :8787 + dashboard :3000, demo mode, no keys needed
npm run seed            # reset demo data and replay the 200 sample requests
npm run demo:outage     # simulate an Anthropic outage and show what apps see
npm test                # all tests (Postgres/Redis tests run when TEST_DATABASE_URL and TEST_REDIS_URL are set)
npm run typecheck
npm run loadtest        # gateway overhead with an instant mock provider
npm run check:hygiene   # no keys, .env files or personal emails in tracked files
docker compose up       # full stack with Redis and Postgres
```

## Conventions

- TypeScript, ESM, strict. Zod for every external input (env, config files, request bodies).
- Routing rules, prices, tiers and teams live in `config/*.json`. Change behaviour there first; the running gateway reloads them on save.
- Every model the gateway can route to must have a price (`validateConfig` enforces it).
- Money is rounded to millionths of a dollar; budget counters are integer micro dollars.
- New provider: implement `Provider` in `src/providers/`, register it in `registry.ts`, add prices and tier entries.
- Tests use `test/helpers.ts` (`testApp`) with the mock provider; assert on what the mock `received`.
- Writing for humans (README, dashboard copy): plain words, no em dashes, no emojis, no claims the code does not prove.

## Hard rules (guardrails)

1. Raw personal data never reaches a provider or the logs when redaction is on. Redact before routing, caching and the provider call; the ledger stores counts only. `test/privacy.test.ts` must keep passing.
2. Never log request or response bodies. Do not add body logging, debug dumps of prompts, or prompt text to the audit API.
3. Budgets are enforced before the provider call (reserve, then settle). Never move the check after the call.
4. Only official API keys. No consumer subscription accounts, no pooling or sharing of provider keys; teams get virtual keys (stored as SHA-256 hashes).
5. Pinned dependencies (exact versions), lockfile committed, installs with `npm ci` only. Do not add a dependency without pinning it and checking `npm audit --omit=dev`.
6. Never commit secrets: no `.env`, no API keys, no real personal data. Demo data comes from `fixtures/fake-pii.json` only.
7. Demo mode (`DEMO_MODE=1`) must keep working on a fresh clone with zero keys.
