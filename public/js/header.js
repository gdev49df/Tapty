// Шапка с поиском. Не перерисовывается при переходах, чтобы не терять курсор в строке поиска.
import { icon } from './icons.js';
import { lang, t } from './i18n.js';
import { store } from './store.js';
import { $, esc } from './ui.js';

let go;
let drawn = null;
const root = () => $('#topbar');
const onSearch = () => location.pathname === '/search';

function draw() {
  drawn = lang();
  root().innerHTML = `
    <div class="head">
      <a href="/" class="logo"><img src="/img/tapty.svg" alt="tapty." width="83" height="28"></a>
      <form class="searchbar" role="search">
        ${icon('search')}
        <input id="q" type="search" placeholder="${esc(t('searchPlaceholder'))}" aria-label="${esc(t('search'))}" enterkeyhint="search" maxlength="80" autocomplete="off">
        <a class="filter-btn" href="/search?filters=1" aria-label="${esc(t('filters'))}">${icon('sliders')}<span>${esc(t('filters'))}</span><b hidden></b></a>
      </form>
      <div class="pill">
        <a href="/fav" data-tab="fav" aria-label="${esc(t('fav'))}">${icon('heart')}</a>
        <a href="/chats" data-tab="chats" aria-label="${esc(t('messages'))}">${icon('chat')}<b data-unread hidden></b></a>
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

export const header = {
  init(options) {
    ({ go } = options);
  },
  update(tab) {
    if (drawn !== lang()) draw();
    const params = new URLSearchParams(location.search);
    const city = onSearch() && params.has('city') ? params.get('city') : store.get('city', '');
    // Выбранный город виден только в фильтрах, поэтому он тоже входит в счётчик на кнопке.
    const count = (city ? 1 : 0) + (onSearch() ? ['area', 'min', 'max', 'cond', 'type'].filter((k) => params.get(k)).length : 0);
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
