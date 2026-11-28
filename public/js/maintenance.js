// Режим «Тех. работы»: экран с большим логотипом поверх всего сайта. Включается в админке.
import { config, refreshConfig } from './api.js';
import { lang, t } from './i18n.js';
import { $, closeSheet, esc } from './ui.js';
import { closeViewer } from './viewer.js';

// как часто проверять, не закончились ли работы
const EVERY = 30000;
const BEHIND = ['#promo', '#topbar', '#view', '#footer', '#tabs', '#overlay'];

let works = null; // сообщения модератора, пока идут работы
let allowed = true; // в админке заглушка не нужна
let timer = 0;

function paint() {
  const on = Boolean(works) && allowed;
  let box = $('#down');
  for (const id of BEHIND) $(id).inert = on;
  document.documentElement.classList.toggle('down', on);
  if (!on) return box?.remove();
  closeSheet();
  closeViewer();
  if (!box) {
    box = document.createElement('div');
    box.id = 'down';
    document.body.append(box);
  }
  box.innerHTML = `
    <div class="down-body">
      <img class="down-logo" src="/img/logo-big.webp" alt="" width="512" height="512">
      <img class="down-word" src="/img/tapty.svg" alt="tapty." width="2674" height="900">
      <h1>${esc(t('downTitle'))}</h1>
      <p>${esc(works[lang()] || works.ru || t('downText'))}</p>
      <button type="button" class="btn">${esc(t('downRefresh'))}</button>
    </div>`;
  $('button', box).onclick = () => location.reload();
}

function apply(site) {
  const was = Boolean(works);
  works = site.maintenance;
  // работы закончились: страницы под заглушкой загружаются заново
  if (was && !works && allowed) return location.reload();
  clearInterval(timer);
  if (works) timer = setInterval(check, EVERY);
  paint();
}

const check = () => refreshConfig().then(apply).catch(() => {});

addEventListener('tapty:maintenance', () => works || check());
// вернулись на вкладку — проверяем сразу
document.addEventListener('visibilitychange', () => works && !document.hidden && check());

export const maintenance = {
  start: () => config().then(apply).catch(() => {}),
  update(visible) {
    // из админки на сайт: пока были там, работы могли выключить
    const back = visible && !allowed && works;
    allowed = visible;
    paint();
    if (back) check();
  },
};
