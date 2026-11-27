import { lang, t } from './i18n.js';
import { favorites } from './favorites.js';
import { auth } from './api.js';
import { authSheet } from './auth.js';
import { header } from './header.js';
import { icon } from './icons.js';
import { $, $$, closeSheet, errorText, esc, toast } from './ui.js';
import home from './pages/home.js';
import search from './pages/search.js';
import item from './pages/item.js';
import post from './pages/post.js';
import fav from './pages/fav.js';
import me from './pages/me.js';
import rules from './pages/rules.js';
import legal from './pages/legal.js';
import chats from './pages/chats.js';
import chatPage from './pages/chat.js';
import { closeViewer } from './viewer.js';
import { paintUnread, refreshUnread } from './unread.js';
import seller from './pages/seller.js';
import { footer } from './footer.js';
import { promo } from './promo.js';
import admin from './pages/admin.js';

// Если сайт всё же открылся по http, переходим на защищённый адрес.
if (location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  location.replace(`https:${location.href.slice(5)}`);
}

const ROUTES = [
  [/^\/$/, home, 'home'],
  [/^\/search$/, search, 'home'],
  [/^\/new$/, post, 'new'],
  [/^\/edit\/(\d+)$/, post, 'me'],
  [/^\/item\/(\d+)$/, item, ''],
  [/^\/seller\/(\d+)$/, seller, ''],
  [/^\/fav$/, fav, 'fav'],
  [/^\/chats$/, chats, 'chats'],
  [/^\/chat\/(\d+)$/, chatPage, 'chats'],
  [/^\/me$/, me, 'me'],
  [/^\/rules$/, rules, 'me'],
  [/^\/(offer|privacy|consent)$/, legal, 'me'],
  [/^\/admin$/, admin, ''],
];

const view = $('#view');
const scroll = new Map();
let cleanups = [];
let turn = 0;
let key = history.state?.key ?? 0;
let depth = history.state?.depth ?? 0;

export function go(path, { replace = false } = {}) {
  if (!replace && path === location.pathname + location.search) return render();
  scroll.set(key, window.scrollY);
  if (!replace) {
    key = Date.now();
    depth += 1;
  }
  history[replace ? 'replaceState' : 'pushState']({ key, depth }, '', path);
  render();
}

const back = () => (depth > 0 ? history.back() : go('/', { replace: true }));

function chrome(tab) {
  const tabs = [
    ['home', '/', 'grid', t('catalog')],
    ['fav', '/fav', 'heart', t('fav')],
    ['new', '/new', 'plus', t('post')],
    ['chats', '/chats', 'chat', t('chats')],
    ['me', '/me', 'user', t('me')],
  ];
  $('#tabs').innerHTML = tabs
    .map(
      ([id, href, ic, name]) =>
        `<a href="${href}" class="tab tab-${id}"${id === tab ? ' aria-current="page"' : ''}><span>${icon(ic)}${
          id === 'chats' ? '<b data-unread hidden></b>' : ''
        }</span>${esc(name)}</a>`
    )
    .join('');
  header.update(tab);
  paintUnread();
}

async function render({ restored = false } = {}) {
  const id = ++turn;
  cleanups.forEach((fn) => fn());
  cleanups = [];
  closeSheet();
  closeViewer();

  const path = location.pathname.replace(/(.)\/$/, '$1');
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) return go('/', { replace: true });
  const [re, page, tab] = route;
  const isItem = page === item;

  document.documentElement.lang = lang();
  document.title = 'Tapty';
  document.body.dataset.page = isItem ? 'item' : page === chatPage ? 'chat' : path === '/' ? 'home' : path === '/search' ? 'search' : '';
  chrome(tab);
  // В переписке полоса выдавила бы поле ввода за экран.
  promo.update(page !== chatPage && page !== admin);
  // В форме, профиле и модерации подвал только мешает.
  footer.update(![post, me, chats, chatPage, admin].includes(page));

  view.innerHTML = '';
  const restore = scroll.get(key) ?? 0;
  await page({
    root: view,
    params: path.match(re).slice(1),
    query: new URLSearchParams(location.search),
    restored, // вернулись кнопкой «назад»
    go,
    back,
    rerender: () => render(),
    alive: () => id === turn,
    onLeave: (fn) => (id === turn ? cleanups.push(fn) : fn()),
  });
  if (id === turn) window.scrollTo(0, restore);
}

function paintHearts() {
  for (const heart of $$('[data-fav]')) {
    const on = favorites.has(Number(heart.dataset.fav));
    heart.setAttribute('aria-pressed', on);
    heart.setAttribute('aria-label', t(on ? 'fromFav' : 'toFav'));
  }
}
addEventListener('tapty:fav', paintHearts);

const syncFavorites = () => favorites.sync().catch(() => {});
// вход подтягивает избранное аккаунта, выход гасит сердечки
addEventListener('tapty:auth', () => {
  paintHearts();
  syncFavorites();
});

const like = (id, on) => favorites.set(id, on).catch((e) => toast(errorText(e)));

document.addEventListener('click', (e) => {
  const heart = e.target.closest('[data-fav]');
  if (heart) {
    e.preventDefault();
    const id = Number(heart.dataset.fav);
    if (!auth.signedIn()) {
      authSheet({
        note: t('authFav'),
        onDone: () => {
          like(id, true);
          // на странице объявления после входа появляется поле сообщения
          if (document.body.dataset.page === 'item') {
            scroll.set(key, window.scrollY);
            render();
          }
        },
      });
    } else like(id, !favorites.has(id));
    return;
  }
  const link = e.target.closest('a[href^="/"]');
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || link.target) return;
  e.preventDefault();
  go(link.getAttribute('href'));
});

header.init({ go });

history.scrollRestoration = 'manual';
history.replaceState({ key, depth }, '');
addEventListener('popstate', (e) => {
  // «Назад» при открытом фото только закрывает его: страница под ним остаётся как была.
  if (closeViewer()) return;
  scroll.set(key, window.scrollY);
  key = e.state?.key ?? 0;
  depth = e.state?.depth ?? 0;
  render({ restored: true });
});
addEventListener('offline', () => toast(t('err_network')));

// Android предлагает установку сам — запоминаем, чтобы показать кнопку в профиле.
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.installPrompt = e;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

render();
refreshUnread();
syncFavorites();
