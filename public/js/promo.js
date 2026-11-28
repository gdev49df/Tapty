// Полоса про соцсети над всем сайтом: выезжает при каждом входе, закрытая крестиком не возвращается до следующего.
import { icon } from './icons.js';
import { lang, t } from './i18n.js';
import { $, esc } from './ui.js';
import { config } from './api.js';

// Адреса соцсетей и текст задаются в админке. Пока адреса нет, название показано без ссылки.
const SOCIALS = [
  ['Telegram', 'telegram'],
  ['Instagram', 'instagram'],
];
// чтобы выезд был заметен, а не сливался с первой отрисовкой страницы
const DELAY = 250;

let drawn = null;
let closed = false;
let site = null;

function draw() {
  drawn = lang();
  const custom = site?.promo[drawn];
  const names = SOCIALS.map(([name, key]) => {
    const url = site?.social[key];
    if (url) return `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>`;
    // после своего текста названия без ссылок ничего не говорят
    return custom ? '' : `<span>${name}</span>`;
  }).filter(Boolean);
  const root = $('#promo');
  root.innerHTML = `
    <div class="promo-clip">
      <div class="promo-row">
        <img src="/img/logo.webp" alt="" width="64" height="64">
        <p>${esc(custom || t('promoText'))} ${names.join(` ${esc(t('promoAnd'))} `)}</p>
        <button type="button" aria-label="${esc(t('close'))}">${icon('close')}</button>
      </div>
    </div>`;
  $('button', root).addEventListener('click', () => {
    closed = true;
    // пустая полоса остаётся высотой в вырез экрана, поэтому страница под ней не прыгает
    root.classList.remove('open');
  });
}

config()
  .then((value) => {
    site = value;
    if (drawn !== null && !closed) draw();
  })
  .catch(() => {});

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
