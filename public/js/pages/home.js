import { api } from '../api.js';
import { CATEGORIES } from '../catalog.js';
import { label, t } from '../i18n.js';
import { store } from '../store.js';
import { $, $$, closeSheet, emptyState, esc, feed, sheet } from '../ui.js';

// Лента сохраняется, чтобы после просмотра товара вернуться на то же место.
let cache = null;

// Семь категорий на виду, остальные открываются плиткой «Другое».
const MAIN = ['clothes', 'phones', 'electronics', 'transport', 'realty', 'kids', 'jobs'];
// Для этих категорий картинки нет, вместо неё значок.
const ICONS = ['home_garden', 'other'];

const art = (id) =>
  ICONS.includes(id)
    ? `<span><img class="cat-icon" src="/img/cat/${id}.svg" alt="" width="44" height="44" decoding="async"></span>`
    : `<span><img src="/img/cat/${id}.webp" alt="" width="300" height="300" decoding="async"></span>`;

const tile = (c, selected) =>
  `<button class="cat" data-cat="${c.id}" aria-pressed="${c.id === selected}">${art(c.id)}${esc(label(c))}</button>`;

export default function home({ root, alive, onLeave, restored }) {
  const city = store.get('city', '');
  const cat = cache?.cat ?? '';
  if (!restored || !cache || cache.city !== city) cache = { city, cat, state: { items: [], next: 0 } };

  const main = CATEGORIES.filter((c) => MAIN.includes(c.id));
  const rest = CATEGORIES.filter((c) => !MAIN.includes(c.id));
  const hidden = (id) => rest.some((c) => c.id === id);

  root.innerHTML = `
    <div class="cats" role="group" aria-label="${esc(t('category'))}">
      ${main.map((c) => tile(c, cat)).join('')}
      <button class="cat" data-more aria-haspopup="dialog" aria-current="${hidden(cat)}">${art('other')}${esc(label(CATEGORIES.find((c) => c.id === 'other')))}</button>
    </div>
    <div class="feed-head"><h1></h1><span></span></div>
    <div class="feed"></div>`;

  let stop = () => {};
  const start = () => {
    stop();
    const entry = cache;
    const { cat: current, state } = entry;
    const title = () => {
      $('.feed-head h1', root).textContent = label(CATEGORIES.find((c) => c.id === current)) || t('allAds');
      $('.feed-head span', root).textContent = entry.total ?? '';
    };
    title();
    stop = feed(
      $('.feed', root),
      async (offset) => {
        const data = await api(`/listings?${new URLSearchParams({ offset, city, cat: current })}`);
        if (data.total != null) entry.total = data.total;
        if (alive() && cache === entry) title();
        return data;
      },
      {
        state,
        alive: () => alive() && cache.state === state,
        empty: emptyState(t('emptyFeed'), t('emptyFeedHint'), `<a class="btn" href="/new">${esc(t('postAd'))}</a>`),
      }
    );
  };
  start();
  onLeave(() => stop());

  const cats = $('.cats', root);
  // Повторное нажатие на выбранную категорию снимает фильтр.
  const choose = (id) => {
    const value = id === cache.cat ? '' : id;
    cache = { city, cat: value, state: { items: [], next: 0 } };
    $$('[data-cat]', cats).forEach((b) => b.setAttribute('aria-pressed', b.dataset.cat === value));
    $('[data-more]', cats).setAttribute('aria-current', hidden(value));
    start();
  };
  cats.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat');
    if (!btn) return;
    if (btn.dataset.cat) return choose(btn.dataset.cat);
    const { body } = sheet(`<div class="cats">${rest.map((c) => tile(c, cache.cat)).join('')}</div>`, { title: t('moreCats') });
    body.addEventListener('click', (ev) => {
      const picked = ev.target.closest('[data-cat]');
      if (!picked) return;
      closeSheet();
      choose(picked.dataset.cat);
    });
  });
}
