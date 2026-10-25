# Clip manifest

All clips: 1920 x 1080, H.264, yuv420p, 30 fps, no audio. Recorded in demo mode with the seeded sample data (`node clips/record.mjs`), so every number is repeatable. One still per clip is in [`frames/`](frames/); PNG stills of the explainer cards are in [`stills/`](stills/).

| Clip | Type | File | Length | What it shows | Video section |
|---|---|---|---|---|---|
| K01 | CARD | [`K01_problem.mp4`](K01_problem.mp4) | 6.9 s | The problem: AI bills growing, personal data sent to three vendors, no idea which team spends what | Intro / problem |
| P01 | PROMPT | [`P01_prompt_build.mp4`](P01_prompt_build.mp4) | 10.3 s | SHOW prompt 1 typed in a terminal, the plan summary appears | Build |
| C01 | UI | [`C01_client_burst.mp4`](C01_client_burst.mp4) | 13.2 s | Demo client app sends the 200 sample requests; live gateway counters start moving | Result: it works |
| C02 | UI | [`C02_dashboard_spend.mp4`](C02_dashboard_spend.mp4) | 13.4 s | Dashboard while traffic flows: spend by team against budget, spend by model, savings tile growing | Result: cost control |
| C03 | UI | [`C03_routed_small_saving.mp4`](C03_routed_small_saving.mp4) | 6.4 s | Latest requests table: hover a request routed to the small model with its saving | Result: routing |
| C03 CLOSE | UI CLOSE | [`C03_CLOSE_routed_small_saving.mp4`](C03_CLOSE_routed_small_saving.mp4) | 8.8 s | Close up of that row: Small model, cache miss, cost $0.00004, saved $0.00073 (captured at 2x, sharp) | Result: routing |
| C04 | UI | [`C04_cache_hit.mp4`](C04_cache_hit.mp4) | 10.8 s | Same request sent twice: first is a cache miss with a cost, second is a cache hit costing $0.0000 | Result: caching |
| C05 | UI | [`C05_redaction_view.mp4`](C05_redaction_view.mp4) | 14.7 s | What the app sent (fake card, email, IBAN, NI, phone, postcode) next to what the provider received; a new card and email are typed and redacted live | Result: privacy |
| K02 | CARD | [`K02_flow.mp4`](K02_flow.mp4) | 8.6 s | Flow: your apps, gateway (remove personal data, check budget, cheapest model, cache), OpenAI / Claude / Gemini, answer back | How it works |
| C06 | UI | [`C06_budget_429.mp4`](C06_budget_429.mp4) | 9.1 s | Marketing has used its demo budget; the client app shows the friendly 429 message, nothing sent to a provider | Safeguards: budgets |
| P02 | PROMPT | [`P02_prompt_outage.mp4`](P02_prompt_outage.mp4) | 9.3 s | SHOW prompt 3 typed, then the real output of npm run demo:outage: every request answered via the fallback | Reliability |
| C07 | UI | [`C07_provider_outage.mp4`](C07_provider_outage.mp4) | 14.9 s | Live traffic, then a simulated Anthropic outage: failed calls on the primary, OpenAI takes over, apps see 0 failures | Reliability |
| C08 | UI | [`C08_audit_log.mp4`](C08_audit_log.mp4) | 5.4 s | Audit log filtered to the Data team: team, model, cost, decisions, no prompt text | Safeguards: audit |
| K03 | CARD | [`K03_safeguards.mp4`](K03_safeguards.mp4) | 7.1 s | Safeguards: no raw personal data leaves, budgets before calls, official keys only, pinned dependencies and audit log | Safeguards |
| K04 | CARD | [`K04_pilot.mp4`](K04_pilot.mp4) | 7.2 s | What a pilot includes, built in a week, running cost labelled as an estimate | Offer |

Notes:

- UI clips are scripted actions with a visible cursor and a ring on every click, 600 to 900 ms pauses and typing at about 12 characters per second.
- Prompt clips (P01, P02) are terminal style replays typed at about 22 characters per second so they stay near their target length. P02 shows output captured from a real `npm run demo:outage` run.
- Some UI clips run longer than their target so each action is visible; the proposal cut trims them.
- The proposal cut is [`proposal_cut.mp4`](proposal_cut.mp4); its script is [`proposal_cut_script.md`](proposal_cut_script.md).
