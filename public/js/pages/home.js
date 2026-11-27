import { api } from '../api.js';
import { CATEGORIES } from '../catalog.js';
import { icon } from '../icons.js';
import { label, t } from '../i18n.js';
import { store } from '../store.js';
import { $, cityName, cityOptions, emptyState, esc, feed, pick } from '../ui.js';

// Лента сохраняется, чтобы после просмотра товара вернуться на то же место.
let cache = null;

export default function home({ root, alive, onLeave, rerender, restored }) {
  const city = store.get('city', '');
  const cat = cache?.cat ?? '';
  if (!restored || !cache || cache.city !== city) cache = { city, cat, state: { items: [], next: 0 } };

  root.innerHTML = `
    <div class="home-head">
      <a href="/" class="logo">Tapty</a>
      <button class="city-btn">${icon('pin')}<span>${esc(city ? cityName(city) : t('allKz'))}</span>${icon('down')}</button>
    </div>
    <h1 class="sr-only">Tapty</h1>
    <a class="search-fake" href="/search">${icon('search')}<span>${esc(t('searchPlaceholder'))}</span></a>
    <div class="cats" role="group" aria-label="${esc(t('category'))}">
      ${[{ id: '', ru: t('all'), kk: t('all') }, ...CATEGORIES]
        .map(
          (c) =>
            `<button class="cat" data-cat="${c.id}" aria-pressed="${c.id === cat}"><span>${icon(c.id || 'all')}</span>${esc(label(c))}</button>`
        )
        .join('')}
    </div>
    <div class="feed"></div>`;

  let stop = () => {};
  const start = () => {
    stop();
    const { cat: current, state } = cache;
    stop = feed(
      $('.feed', root),
      (offset) => api(`/listings?${new URLSearchParams({ offset, city, cat: current })}`),
      {
        state,
        alive: () => alive() && cache.state === state,
        empty: emptyState(t('emptyFeed'), t('emptyFeedHint'), `<a class="btn" href="/new">${esc(t('postAd'))}</a>`),
      }
    );
  };
  start();
  onLeave(() => stop());

  $('.cats', root).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn || btn.dataset.cat === cache.cat) return;
    cache = { city, cat: btn.dataset.cat, state: { items: [], next: 0 } };
    root.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', b === btn));
    start();
  });
  $('[data-cat][aria-pressed="true"]', root)?.scrollIntoView({ block: 'nearest', inline: 'center' });

  $('.city-btn', root).onclick = async () => {
    const value = await pick(t('chooseCity'), [{ value: '', label: t('allKz') }, ...cityOptions()], city);
    if (value !== undefined && value !== city) {
      store.set('city', value);
      rerender();
    }
  };
}
