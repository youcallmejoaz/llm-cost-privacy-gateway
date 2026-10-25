import type { ChatMessage, Task } from '../types.js';

const PATTERNS: Array<[Task, RegExp]> = [
  ['classification', /\b(classify|classification|categori[sz]e|which category|label (this|these|the)|tag (this|these)|sentiment|is this (spam|urgent)|triage|route this ticket)\b/i],
  ['extraction', /\b(extract|pull out|parse|return (the )?json|as json|fields?:|list the (names|dates|amounts|items))\b/i],
  ['summary', /\b(summari[sz]e|summary|tl;?dr|key points|in one paragraph|recap)\b/i],
  ['analysis', /\b(analy[sz]e|analysis|compare|comparison|root cause|evaluate|assess|strategy|recommend(ation)?s?|forecast|trade-?offs?|investigate)\b/i],
  ['draft', /\b(draft|write|compose|rewrite|reply to|newsletter|blog|post|email to|copy for|tagline)\b/i],
];

/** Fast rule based task detection on the system prompt and latest user message (the instruction). */
export function classifyTask(messages: ChatMessage[]): Task {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const instruction = `${system}\n${lastUser.slice(0, 600)}`;
  // The earliest instruction word wins: "Investigate ... using this log extract" is analysis, not extraction.
  let best: { task: Task; at: number } | null = null;
  for (const [task, re] of PATTERNS) {
    const at = instruction.search(re);
    if (at >= 0 && (!best || at < best.at)) best = { task, at };
  }
  return best?.task ?? 'chat';
}

export const TASKS: Task[] = ['classification', 'extraction', 'summary', 'draft', 'analysis', 'chat'];

export function parseTaskLabel(text: string): Task | null {
  const word = text.trim().toLowerCase().match(/[a-z]+/)?.[0];
  return (TASKS as string[]).includes(word ?? '') ? (word as Task) : null;
}
