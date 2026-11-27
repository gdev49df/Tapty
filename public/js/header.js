// Шапка с поиском. Не перерисовывается при переходах, чтобы не терять курсор в строке поиска.
import { icon } from './icons.js';
import { lang, t } from './i18n.js';
import { store } from './store.js';
import { $, cityName, cityOptions, esc, pick } from './ui.js';

let go;
let rerender;
let drawn = null;
const root = () => $('#topbar');
const onSearch = () => location.pathname === '/search';

function draw() {
  drawn = lang();
  root().innerHTML = `
    <div class="head">
      <a href="/" class="logo">Tapty</a>
      <form class="searchbar" role="search">
        ${icon('search')}
        <input id="q" type="search" placeholder="${esc(t('searchPlaceholder'))}" aria-label="${esc(t('search'))}" enterkeyhint="search" maxlength="80" autocomplete="off">
        <button type="button" class="city-btn in-search">${icon('pin')}<span></span></button>
        <a class="filter-btn" href="/search?filters=1" aria-label="${esc(t('filters'))}">${icon('sliders')}<span>${esc(t('filters'))}</span><b hidden></b></a>
      </form>
      <button type="button" class="city-btn in-head">${icon('pin')}<span></span>${icon('down')}</button>
      <div class="pill">
        <a href="/fav" data-tab="fav" aria-label="${esc(t('fav'))}">${icon('heart')}</a>
        <a href="/me" data-tab="me" aria-label="${esc(t('me'))}">${icon('user')}</a>
      </div>
      <a href="/new" class="btn head-post">${icon('plus')}${esc(t('postAd'))}</a>
    </div>`;
  const input = $('#q');
  // Нажали на поиск с любой страницы — открываем результаты, курсор остаётся в строке.
  input.addEventListener('focus', () => !onSearch() && go('/search'));
  input.addEventListener('input', () => {
    if (!onSearch()) go(`/search?q=${encodeURIComponent(input.value)}`);
  });
  $('form', root()).addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur();
  });
}

async function chooseCity() {
  const current = store.get('city', '');
  const value = await pick(t('chooseCity'), [{ value: '', label: t('allKz') }, ...cityOptions()], current);
  if (value === undefined || value === current) return;
  store.set('city', value);
  if (!onSearch()) return rerender();
  const params = new URLSearchParams(location.search);
  params.set('city', value);
  go(`/search?${params}`, { replace: true });
}

export const header = {
  init(options) {
    ({ go, rerender } = options);
    root().addEventListener('click', (e) => e.target.closest('.city-btn') && chooseCity());
  },
  update(tab) {
    if (drawn !== lang()) draw();
    const params = new URLSearchParams(location.search);
    const city = onSearch() && params.has('city') ? params.get('city') : store.get('city', '');
    for (const span of root().querySelectorAll('.city-btn span')) span.textContent = city ? cityName(city) : t('allKz');
    const count = onSearch() ? ['min', 'max', 'cond', 'type'].filter((k) => params.get(k)).length : 0;
    const badge = $('.filter-btn b', root());
    badge.textContent = count;
    badge.hidden = !count;
    for (const link of root().querySelectorAll('[data-tab]')) {
      if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (!onSearch()) {
      const input = $('#q');
      input.value = '';
      input.blur();
    }
  },
};
