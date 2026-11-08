// Einstieg: schwarzer 3D-Startbildschirm, danach der Planer in drei Schritten (Svelte).
import { mount, unmount } from 'svelte';
import { createIntro } from './intro.js';
import Planer from './planer/Planer.svelte';
import { TIPS } from './planer/opts';

const host = document.getElementById('planer');
let app = null;

const intro = createIntro({
  onDone: ({ use, opts }) => {
    if (app) unmount(app);
    host.hidden = false;
    app = mount(Planer, { target: host, props: { use, initial: opts, onBack: back } });
  },
});
function back() {
  if (app) { unmount(app); app = null; }
  host.hidden = true;
  intro.show();
}

// Hover-Hilfen: jedes Element mit data-tip zeigt nach kurzer Zeit einen Hinweis
(() => {
  const tip = document.getElementById('ftip'); let timer = null, cur = null;
  const place = (el) => {
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    let y = r.bottom + 6; if (y + th > window.innerHeight - 8) y = r.top - th - 6;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const show = (el) => { cur = el; tip.textContent = el.dataset.tip; tip.classList.add('on'); place(el); };
  const hide = () => { clearTimeout(timer); cur = null; tip.classList.remove('on'); };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest && e.target.closest('[data-tip]'); if (el === cur) return;
    clearTimeout(timer); if (!el || el.tagName === 'CANVAS') { hide(); return; }
    timer = setTimeout(() => show(el), 400);
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el.tagName !== 'CANVAS') show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  window.addEventListener('scroll', hide, { passive: true, capture: true });
})();
window.__TIPS = TIPS;
