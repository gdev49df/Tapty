import { api } from '../api.js';
import { CATEGORIES } from '../catalog.js';
import { icon } from '../icons.js';
import { label, t } from '../i18n.js';
import { store } from '../store.js';
import { $, emptyState, esc, feed } from '../ui.js';

// Лента сохраняется, чтобы после просмотра товара вернуться на то же место.
let cache = null;

export default function home({ root, alive, onLeave, restored }) {
  const city = store.get('city', '');
  const cat = cache?.cat ?? '';
  if (!restored || !cache || cache.city !== city) cache = { city, cat, state: { items: [], next: 0 } };

  root.innerHTML = `
    <div class="cats-wrap">
      <div class="cats" role="group" aria-label="${esc(t('category'))}">
        ${CATEGORIES.map(
          (c) => `<button class="cat" data-cat="${c.id}" aria-pressed="${c.id === cat}">
              <span><img src="/img/cat/${c.id}.svg" alt="" width="44" height="44" decoding="async"></span>${esc(label(c))}</button>`
        ).join('')}
      </div>
      <button class="cats-arrow prev" aria-label="${esc(t('scrollBack'))}" hidden>${icon('back')}</button>
      <button class="cats-arrow next" aria-label="${esc(t('scrollNext'))}" hidden>${icon('next')}</button>
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
  const prev = $('.cats-arrow.prev', root);
  const next = $('.cats-arrow.next', root);
  const arrows = () => {
    prev.hidden = cats.scrollLeft < 8;
    next.hidden = cats.scrollLeft + cats.clientWidth > cats.scrollWidth - 8;
  };
  cats.addEventListener('scroll', arrows, { passive: true });
  addEventListener('resize', arrows);
  onLeave(() => removeEventListener('resize', arrows));
  prev.onclick = () => cats.scrollBy({ left: -cats.clientWidth * 0.7, behavior: 'smooth' });
  next.onclick = () => cats.scrollBy({ left: cats.clientWidth * 0.7, behavior: 'smooth' });

  // Повторное нажатие на выбранную категорию снимает фильтр.
  cats.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    const value = btn.dataset.cat === cache.cat ? '' : btn.dataset.cat;
    cache = { city, cat: value, state: { items: [], next: 0 } };
    cats.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cat === value));
    start();
  });
  $('[data-cat][aria-pressed="true"]', root)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  arrows();
}
