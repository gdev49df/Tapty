// Полоса про соцсети над всем сайтом: выезжает при каждом входе, закрытая крестиком не возвращается до следующего.
import { icon } from './icons.js';
import { lang, t } from './i18n.js';
import { $, esc } from './ui.js';

// Адреса соцсетей tapty. Пока адреса нет, название показано без ссылки.
const SOCIALS = [
  ['Telegram', ''],
  ['Instagram', ''],
];
// чтобы выезд был заметен, а не сливался с первой отрисовкой страницы
const DELAY = 250;

let drawn = null;
let closed = false;

function draw() {
  drawn = lang();
  const names = SOCIALS.map(([name, url]) =>
    url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>` : `<span>${name}</span>`
  );
  const root = $('#promo');
  root.innerHTML = `
    <div class="promo-clip">
      <div class="promo-row">
        <img src="/img/mark3d.webp" alt="" width="64" height="64">
        <p>${esc(t('promoText'))} ${names.join(` ${esc(t('promoAnd'))} `)}</p>
        <button type="button" aria-label="${esc(t('close'))}">${icon('close')}</button>
      </div>
    </div>`;
  $('button', root).addEventListener('click', () => {
    closed = true;
    // пустая полоса остаётся высотой в вырез экрана, поэтому страница под ней не прыгает
    root.classList.remove('open');
  });
}

export const promo = {
  update(allowed) {
    const root = $('#promo');
    // Закрытая полоса убирается совсем только при переходе на другую страницу.
    const visible = allowed && !closed;
    root.hidden = !visible;
    // верхний отступ под вырез экрана берёт на себя полоса
    document.body.classList.toggle('has-promo', visible);
    if (!visible || drawn === lang()) return;
    const first = drawn === null;
    draw();
    if (first) setTimeout(() => closed || root.classList.add('open'), DELAY);
  },
};
