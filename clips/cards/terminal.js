// Replays a prompt being typed, then the result lines appearing.
// window.SCRIPT = { title, prompt, cps, lines: [[cls, text], ...], lineMs }
window.play = async () => {
  const { prompt, cps = 22, lines, lineMs = 260 } = window.SCRIPT;
  const body = document.querySelector('.body');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const p = document.createElement('span');
  p.className = 'prompt';
  p.textContent = '> ';
  const u = document.createElement('span');
  u.className = 'user';
  const caret = document.createElement('span');
  caret.className = 'caret';
  body.append(p, u, caret);
  await sleep(400);
  for (const ch of prompt) {
    u.textContent += ch;
    await sleep(1000 / cps + (ch === ' ' ? 18 : 0));
  }
  await sleep(500);
  caret.remove();
  body.append('\n\n');
  for (const [cls, text] of lines) {
    const s = document.createElement('div');
    s.className = cls;
    s.textContent = text || ' ';
    body.append(s);
    await sleep(lineMs);
  }
};
