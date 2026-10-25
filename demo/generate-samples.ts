/**
 * Generates demo/sample-requests.json: 200 realistic requests from 3 teams.
 * Deterministic (seeded), so every run and every clip shows the same numbers.
 * All personal data is fake (see fixtures/fake-pii.json).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fake from '../fixtures/fake-pii.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));

let seed = 20261025;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const email = () => pick(fake.email);
const phone = () => pick(fake.phone);
const card = () => pick(fake.card);
const ni = () => pick(fake.ni_number);
const iban = () => pick(fake.iban);
const postcode = () => pick(fake.postcode);

export interface SampleRequest {
  id: number;
  team: 'support' | 'marketing' | 'data';
  kind: string;
  /** What the routing rules should do with it (checked by tests). */
  expectTier: 'small' | 'large';
  body: { model: string; messages: Array<{ role: 'system' | 'user'; content: string }>; max_tokens?: number };
}

const order = () => `ORD-${40000 + Math.floor(rand() * 9999)}`;
const amount = () => (5 + Math.floor(rand() * 400) + 0.99).toFixed(2);
const day = () => pick(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const item = () => pick(['jacket', 'desk lamp', 'running shoes', 'coffee machine', 'backpack', 'monitor stand', 'kettle', 'headphones']);
const issueMakers = [
  () => `I was charged twice for order ${order()} (${amount()} GBP) and want one payment refunded.`,
  () => `My ${item()} from order ${order()} was meant to arrive on ${day()} and the courier says it is lost.`,
  () => `I cannot log in since I changed my phone on ${day()}, the two-factor codes go to my old number.`,
  () => `How do I add a second user to my account? We are a team of ${2 + Math.floor(rand() * 30)}.`,
  () => `I returned the ${item()} ${2 + Math.floor(rand() * 4)} weeks ago (order ${order()}) and still have not had my ${amount()} GBP back.`,
  () => `The invoice for order ${order()} shows the wrong VAT number and a total of ${amount()} GBP.`,
  () => `The ${item()} in order ${order()} arrived damaged on ${day()}. Can I get a replacement?`,
  () => `I was billed ${amount()} GBP after cancelling my subscription last ${day()}.`,
];
const issue = () => pick(issueMakers)();

const supportClassify = () => {
  const ticket = issue();
  const extra = pick([
    ` I paid with card ${card()} and you can email me at ${email()}.`,
    ` Please call me on ${phone()}.`,
    ` My email is ${email()}.`,
    '',
  ]);
  return `Classify this support ticket into one category (billing, delivery, account_access, product_question, refund_request), with urgency and sentiment.\n\nTicket: ${ticket}${extra}`;
};

const supportSummary = () =>
  `Summarise this call transcript in one paragraph with a next step.\n\nAgent: Thanks for calling, can I take your details?\nCustomer: Yes, it's ${email()}, and my number is ${phone()}. Postcode ${postcode()}.\nAgent: Thanks. What can I help with?\nCustomer: ${issue()} I have been waiting a while and it is frustrating.\nAgent: I understand. Let me look into that for you now.\nCustomer: Thank you. My National Insurance number is ${ni()} if you need it for the account check.\nAgent: That's fine, I can see the account.`;

const supportDraft = () =>
  `Draft a polite reply to this customer complaint. Apologise, explain the refund, and keep it under 150 words.\n\nComplaint from ${email()}: ${issue()} I expected better.`;

const supportExtract = () =>
  `Extract the customer contact, order id, issue and amount as JSON.\n\nMessage: Hi, this is about order ORD-48213. ${issue()} The amount was 49.99 GBP. Contact me at ${email()} or ${phone()}. Refund to IBAN ${iban()}.`;

const products = ['annual plan', 'team workspace', 'reporting add-on', 'mobile app', 'starter plan', 'API access tier'];
const audience = () => pick(['small business owners', 'finance teams', 'existing customers', 'trial users', 'agency partners', 'IT managers']);
const words = () => pick([80, 100, 120, 150, 200, 250]);
const month = () => pick(['November', 'December', 'January', 'February']);
const marketingDraft = () =>
  pick([
    () => `Write an email newsletter for ${audience()} announcing our ${month()} offer on the ${pick(products)}: ${1 + Math.floor(rand() * 3)} extra months free on annual plans. Friendly tone, ${words()} words, clear call to action.`,
    () => `Draft a LinkedIn post for ${audience()} about lessons from rolling out AI across ${3 + Math.floor(rand() * 8)} teams. Keep it under ${words()} words.`,
    () => `Write ${2 + Math.floor(rand() * 4)} tagline options and a short blog intro for the launch of our ${pick(products)}, aimed at ${audience()}.`,
    () => `Rewrite this campaign copy to sound warmer for ${audience()}: "Upgrade now. Limited time. ${pick(products)} discounted by ${10 + Math.floor(rand() * 30)} percent." Then compose a follow up email to people who opened but did not click.`,
  ])();
const marketingSummary = () =>
  `Summarise the key points from this customer feedback survey in one paragraph: ${50 + Math.floor(rand() * 40)} percent rated onboarding easy, ${10 + Math.floor(rand() * 25)} percent asked for better mobile support, several asked about pricing for teams over ${pick([20, 50, 100])} people, and two mentioned slow replies from ${email()}.`;
const reviews = [
  'Setup took ten minutes and the reports are exactly what our finance team needed.',
  'Support took three days to reply and the export kept failing.',
  'It does the job. Pricing is fair but the mobile app is basic.',
  'We moved our whole agency over and have not looked back.',
  'The new dashboard is confusing and I cannot find the billing page.',
  'Good value, though onboarding emails were a bit too frequent.',
  'Integration with our accounting tool broke after the last update.',
  'Our team of 40 uses it daily. Reliable and quick.',
];
const marketingClassify = () => `Classify the sentiment of this review as positive, neutral or negative: "${pick(reviews)}"`;
const marketingWithCard = () =>
  `Draft a thank you email to the customer who paid with card ${card()} for the annual plan.`;

function dataTable(rows: number): string {
  const lines = ['month,segment,plan,accounts,churned,mrr_gbp,tickets_setup,tickets_billing'];
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const segs = ['smb', 'mid', 'enterprise'];
  const plans = ['monthly', 'annual'];
  for (let i = 0; i < rows; i++) {
    const acc = 200 + Math.floor(rand() * 4000);
    lines.push(`${months[i % 6]},${pick(segs)},${pick(plans)},${acc},${Math.floor(acc * (0.01 + rand() * 0.04))},${acc * (20 + Math.floor(rand() * 60))},${Math.floor(rand() * 90)},${Math.floor(rand() * 40)}`);
  }
  return lines.join('\n');
}
const dataAnalysis = (rows: number) =>
  pick([
    `Analyse this quarter's churn data. Identify the segments driving churn, likely causes, and give recommendations with expected impact.\n\n${dataTable(rows)}`,
    `Compare the three supplier proposals below and recommend one, considering total cost of ownership and delivery risk.\n\nSupplier A: unit price 4.10 GBP, lead time 6 weeks, no late penalty.\nSupplier B: unit price 4.43 GBP, lead time 2 weeks, 5 percent service credit.\nSupplier C: unit price 4.25 GBP, lead time 3 weeks, no ISO 27001.\nHistorical delivery log:\n${dataTable(rows)}`,
    `Investigate the root cause of checkout errors on 14 October using this log extract and recommend actions.\n\n${Array.from({ length: rows }, (_, i) => `10:${String(40 + (i % 50)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} checkout_error code=PSP_TIMEOUT order=ORD-${48000 + i} latency_ms=${5000 + Math.floor(rand() * 7000)}`).join('\n')}`,
  ]);
const actions = ['Please close my account.', 'Please send me a copy of my data.', 'Please update my delivery address.', 'Please stop marketing emails.', 'Please correct my date of birth.', 'Please move me to the annual plan.'];
const dataExtract = () =>
  `Extract the fields email, phone, postcode, reference and requested_action as JSON from this form submission.\n\nSubmission ref SUB-${10000 + Math.floor(rand() * 89999)}: ${pick(actions)} Email ${email()}, phone ${phone()}, postcode ${postcode()}. NI number ${ni()}.`;
const dataSummaryLong = (rows: number) => `Summarise the key points of this export for the weekly report.\n\n${dataTable(rows)}`;

const user = (content: string) => [{ role: 'user' as const, content }];

export function generate(): SampleRequest[] {
  const out: Omit<SampleRequest, 'id'>[] = [];
  const add = (team: SampleRequest['team'], kind: string, expectTier: 'small' | 'large', content: string, max_tokens?: number) =>
    out.push({ team, kind, expectTier, body: { model: 'auto', messages: user(content), ...(max_tokens ? { max_tokens } : {}) } });

  for (let i = 0; i < 34; i++) add('support', 'classification', 'small', supportClassify(), 100);
  for (let i = 0; i < 24; i++) add('support', 'summary', 'small', supportSummary(), 300);
  for (let i = 0; i < 18; i++) add('support', 'draft', 'large', supportDraft(), 400);
  for (let i = 0; i < 12; i++) add('support', 'extraction', 'small', supportExtract(), 200);

  for (let i = 0; i < 30; i++) add('marketing', 'draft', 'large', marketingDraft(), 600);
  for (let i = 0; i < 8; i++) add('marketing', 'summary', 'small', marketingSummary(), 300);
  for (let i = 0; i < 8; i++) add('marketing', 'classification', 'small', marketingClassify(), 50);
  for (let i = 0; i < 2; i++) add('marketing', 'draft-with-card', 'large', marketingWithCard(), 300);

  for (let i = 0; i < 22; i++) add('data', 'analysis', 'large', dataAnalysis(30 + Math.floor(rand() * 60)), 1200);
  for (let i = 0; i < 6; i++) add('data', 'long-analysis', 'large', dataAnalysis(260 + Math.floor(rand() * 80)), 1500);
  for (let i = 0; i < 20; i++) add('data', 'extraction', 'small', dataExtract(), 200);
  for (let i = 0; i < 6; i++) add('data', 'short-summary', 'small', dataSummaryLong(12), 300);
  for (let i = 0; i < 6; i++) add('data', 'long-summary', 'large', dataSummaryLong(120), 400);

  // Repeats: the same FAQ style questions arrive again (cache hits).
  const repeatable = out.filter((r) => r.kind === 'classification' || r.kind === 'summary');
  for (let i = 0; i < 4; i++) out.push(structuredClone(pick(repeatable)));

  // Deterministic shuffle, then keep a few repeats near the end so they hit the cache.
  for (let i = out.length - 5; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((r, i) => ({ id: i + 1, ...r }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const samples = generate();
  writeFileSync(path.join(here, 'sample-requests.json'), JSON.stringify(samples, null, 1) + '\n');
  const counts = samples.reduce<Record<string, number>>((a, s) => ((a[s.team] = (a[s.team] ?? 0) + 1), a), {});
  console.log(`wrote ${samples.length} sample requests`, counts);
}
