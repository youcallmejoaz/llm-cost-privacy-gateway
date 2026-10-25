// Injected into every recorded page: a visible cursor and a highlight ring on each click.
(() => {
  const install = () => {
    if (document.getElementById('__rec_cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__rec_cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; pointer-events: none; z-index: 2147483647; transform: translate(-100px, -100px); transition: transform 0.02s linear; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35)); }
      .__rec_ring { position: fixed; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%; border: 4px solid #2a78d6; background: rgba(42,120,214,0.15); pointer-events: none; z-index: 2147483646; animation: __rec_ring 0.7s ease-out forwards; }
      @keyframes __rec_ring { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }`;
    document.documentElement.appendChild(style);
    const c = document.createElement('div');
    c.id = '__rec_cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.5 20.6 L12.2 14.2 L19 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', (e) => (c.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`), true);
    document.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = '__rec_ring';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 800);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
