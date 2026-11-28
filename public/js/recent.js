// «Вы недавно смотрели»: номера открытых объявлений хранятся только на этом устройстве.
import { api } from './api.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { store } from './store.js';
import { $, esc, priceText } from './ui.js';

const KEPT = 20;
const list = () => {
  const ids = store.get('seen', []);
  return Array.isArray(ids) ? ids.filter(Number.isSafeInteger) : [];
};

export const seen = {
  list,
  add: (id) => store.set('seen', [id, ...list().filter((other) => other !== id)].slice(0, KEPT)),
  clear: () => store.del('seen'),
};

const tile = (item) => `
  <li><a href="/item/${item.id}">
    <span class="my-photo">${item.photo ? `<img src="/p/${item.photo}/t" alt="" loading="lazy">` : icon('camera')}</span>
    <span><b>${esc(priceText(item))}</b><small>${esc(item.title)}</small></span>
  </a></li>`;

// Последние ответы остаются в памяти: после «назад» лента на месте сразу и прокрутка не прыгает.
let known = [];

export async function seenStrip(box, wanted) {
  const draw = (items) => {
    box.innerHTML = items.length
      ? `<div class="seen-head"><h2>${esc(t('seenTitle'))}</h2><button type="button" class="link-btn">${esc(t('seenClear'))}</button></div>
         <ul>${items.map(tile).join('')}</ul>`
      : '';
    box.hidden = !items.length || !wanted();
    const clear = $('button', box);
    if (clear) {
      clear.onclick = () => {
        seen.clear();
        known = [];
        draw([]);
      };
    }
  };
  const ids = list().slice(0, 12);
  if (!ids.length) return;
  const byId = new Map(known.map((i) => [i.id, i]));
  draw(ids.map((id) => byId.get(id)).filter(Boolean));
  try {
    // проданные и удалённые сервер не вернёт, они пропадают из ленты сами
    const { items } = await api(`/listings?ids=${ids.join(',')}`);
    // пока шёл запрос, ленту могли очистить или уйти со страницы
    if (!box.isConnected || !list().length) return;
    known = items;
    draw(items);
  } catch {
    // без сети остаётся то, что уже показано
  }
}
