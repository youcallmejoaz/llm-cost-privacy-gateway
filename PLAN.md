# PLAN: LLM Cost and Privacy Gateway

One gateway between a company's apps and OpenAI, Anthropic and Google that cuts AI spend with routing and caching, strips personal data before it leaves, and gives every team a budget and an audit trail.

## 1. Architecture

```
 Apps (OpenAI SDK / Anthropic SDK, base URL changed)
        |
        v
 +------------------------- Gateway (Fastify, TypeScript) --------------------------+
 | 1 auth: virtual key -> team                                                       |
 | 2 rate limit (per key, per minute)                                                |
 | 3 allowed models check                                                            |
 | 4 PII: detect -> block (policy) or replace with tokens [EMAIL_1]                  |
 | 5 classify task (rules, optional cheap LLM classifier) -> routing rules (data)    |
 | 6 cache lookup (exact on normalised redacted request; semantic behind a flag)     |
 | 7 budget: reserve estimated cost BEFORE the call, 429 if it would go over         |
 | 8 provider call with fallback chain (error or timeout -> next provider)           |
 | 9 cost from price table, ledger + audit row (counts only, no prompt text)         |
 | 10 restore tokens in the reply, return in the caller's format                     |
 +-----------------------------------------------------------------------------------+
        |                         |                         |
   OpenAI SDK               Anthropic SDK             Google Gen AI SDK
   (or mock in demo)        (or mock in demo)         (or mock in demo)

 Redis: cache, rate limit windows, budget counters (in-memory fallback)
 Postgres: teams, virtual keys (hashed), request ledger / audit log (in-memory fallback)
 Next.js dashboard: spend, savings, redactions, errors, fallbacks, audit log, demo client app
```

One provider interface (`Provider.chat(normalisedRequest)`) hides the three SDKs, so a new model is a config change.

## 2. Data model

- `teams`: id, name, monthly_budget_usd, rpm_limit, allowed_models[], default_model, pii_mode (`redact` | `block` | `off`), pii_block_types[]
- `virtual_keys`: id, team_id, key_hash (sha256, raw key shown once), label, created_at, revoked_at
- `requests` (ledger and audit log): id, ts, team_id, key_id, endpoint, requested_model, routed_model, provider, route_rule, task, input_tokens, output_tokens, cost_usd, baseline_cost_usd, saved_usd, cache (`miss` | `exact` | `semantic`), redactions (counts by type), policy (decisions), status, http_status, attempts (provider, outcome, ms), fallback_used, latency_ms. No prompt text.
- Redis keys: `spend:{team}:{yyyymm}` (micro dollars), `rl:{key}:{minute}`, `cache:{scope}:{sha256}`

## 3. Folder layout

```
config/        prices.json (sample prices), models.json, routing.json, teams.json
src/           gateway source (app, pipeline, pii, routing, providers, cache, budget, ledger, routes)
test/          Vitest suites
fixtures/      recorded mock replies for demo mode
demo/          200 sample requests, traffic sender, outage simulator
dashboard/     Next.js dashboard and demo client app
scripts/       load test, character counter, helpers
clips/         Playwright recorder, cards, rendered MP4s
docs/          portfolio text, cover images
```

## 4. Features mapped to evidence

| Feature | Evidence |
|---|---|
| OpenAI compatible `/v1/chat/completions` + Anthropic `/v1/messages` passthrough | Oct 24 post: gateway between client apps and OpenAI, Anthropic, Google |
| Virtual keys, budgets, rate limits, allowed models, friendly 429 | Oct 24 post: reduce costs; Oct 25 post: real production traffic |
| Routing rules as data, fallback | Oct 24 post: cost reduction; S3: model agnostic |
| Exact cache (+ semantic flag), savings recorded | Oct 24 post: reduce costs; S3: cache shared prompts |
| PII redaction (email, phone, NI number, card + Luhn, IBAN, postcode) | Oct 24 post: protect personal data, UK companies, GDPR |
| Cost ledger and dashboard | Oct 24 post: reduce costs (needs proof) |
| Audit log, lockfile, `npm ci`, SBOM in CI | S1: poisoned gateway library release |
| Postgres, Redis, Docker Compose | Both posts list these skills |

## 5. Test plan (Vitest, `fastify.inject`, spy mock provider)

1. Every seeded PII pattern redacted before the provider call, restored in the reply, absent from logs and ledger.
2. Over-budget team gets 429 and the provider spy records zero calls.
3. Seeded simple requests go to the small model, complex ones to the large model.
4. Second identical request is a cache hit costing zero.
5. Primary mock provider failing -> request succeeds via fallback.
6. Ledger totals equal price table maths.
7. Demo mode end to end with no keys (spawned server + sample traffic).
8. Unit tests: Luhn, IBAN mod 97, NI number rules, rule matching, price maths, rate limit.

## 6. Build order

1. Config, price table, types, PII redactor + tests
2. Providers (mock, OpenAI, Anthropic, Google) + fallback registry
3. Routing rules + classifier + tests
4. Stores (memory, Redis, Postgres), cache, budget, rate limit, ledger
5. Pipeline + routes + admin API + integration tests
6. Demo data, traffic sender, outage simulator, load test
7. Dashboard + demo client app
8. Docker Compose, CI with SBOM, README
9. Clips, proposal cut, portfolio, cover

## Later (not in this build)

- Real streaming passthrough (this build emulates SSE from a full reply)
- Tool / function calling and images through the redactor
- NER model for names and free-text addresses
- Semantic cache in Redis (this build keeps it in process memory)
- SSO for the dashboard, per-user keys, multi-region
