/**
 * npm run check:hygiene: fails if tracked files contain things that must never be committed:
 * API keys, private keys, .env files, or email addresses outside reserved example domains.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const binary = /\.(png|jpe?g|mp4|webm|wav|ico|woff2?|onnx|bin)$/i;
const rules: Array<[string, RegExp]> = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /sk-(proj-)?[A-Za-z0-9]{32,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['gateway key', /gw_[A-Za-z0-9_-]{32}/],
];
const allowedEmail = /@(example\.(com|org|net|co\.uk)|anthropic\.com)$/i;
const problems: string[] = [];
for (const f of files) {
  if (/(^|\/)\.env$/.test(f)) problems.push(`${f}: .env file is tracked`);
  if (binary.test(f) || f.endsWith('package-lock.json')) continue;
  const text = readFileSync(f, 'utf8');
  for (const [name, re] of rules) if (re.test(text)) problems.push(`${f}: looks like a ${name}`);
  for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []) {
    if (!allowedEmail.test(m) && !/^(git|noreply)@/.test(m)) problems.push(`${f}: email address ${m}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`hygiene ok: ${files.length} tracked files checked`);
