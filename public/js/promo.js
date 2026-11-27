// Полоса про соцсети над всем сайтом. Закрытая крестиком на этом устройстве больше не показывается.
import { icon } from './icons.js';
import { lang, t } from './i18n.js';
import { store } from './store.js';
import { $, esc } from './ui.js';

// Адреса соцсетей tapty. Сеть без адреса в полосе не называется, без обоих полосы нет.
const SOCIALS = [
  ['Telegram', ''],
  ['Instagram', ''],
];

let drawn = null;

function show(visible) {
  $('#promo').hidden = !visible;
  // верхний отступ под вырез экрана берёт на себя полоса
  document.body.classList.toggle('has-promo', visible);
}

function draw() {
  drawn = lang();
  const links = SOCIALS.filter(([, url]) => url).map(
    ([name, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>`
  );
  const root = $('#promo');
  root.innerHTML = `
    <div>
      <img src="/img/mark3d.webp" alt="" width="64" height="64">
      <p>${esc(t('promoText'))} ${links.join(` ${esc(t('promoAnd'))} `)}</p>
      <button type="button" aria-label="${esc(t('close'))}">${icon('close')}</button>
    </div>`;
  $('button', root).addEventListener('click', () => {
    store.set('promoClosed', true);
    show(false);
  });
}

export const promo = {
  update(allowed) {
    const visible = allowed && SOCIALS.some(([, url]) => url) && !store.get('promoClosed');
    if (visible && drawn !== lang()) draw();
    show(visible);
  },
};
