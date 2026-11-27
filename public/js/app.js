import { icon } from './icons.js';
import { lang, t } from './i18n.js';
import { favorites } from './store.js';
import { $, closeSheet, esc, toast } from './ui.js';
import home from './pages/home.js';
import search from './pages/search.js';
import item from './pages/item.js';
import post from './pages/post.js';
import fav from './pages/fav.js';
import me from './pages/me.js';
import rules from './pages/rules.js';
import admin from './pages/admin.js';

const ROUTES = [
  [/^\/$/, home, 'home'],
  [/^\/search$/, search, 'search'],
  [/^\/new$/, post, 'new'],
  [/^\/edit\/(\d+)$/, post, 'me'],
  [/^\/item\/(\d+)$/, item, ''],
  [/^\/fav$/, fav, 'fav'],
  [/^\/me$/, me, 'me'],
  [/^\/rules$/, rules, 'me'],
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
    ['home', '/', 'home'],
    ['search', '/search', 'search'],
    ['new', '/new', 'plus'],
    ['fav', '/fav', 'heart'],
    ['me', '/me', 'user'],
  ];
  const name = { home: t('home'), search: t('search'), new: t('post'), fav: t('fav'), me: t('me') };
  $('#tabs').innerHTML = tabs
    .map(
      ([id, href, ic]) =>
        `<a href="${href}" class="tab tab-${id}"${id === tab ? ' aria-current="page"' : ''}><span>${icon(ic)}</span>${esc(name[id])}</a>`
    )
    .join('');
  $('#topbar').innerHTML = `
    <div class="topbar-in">
      <a href="/" class="logo">Tapty</a>
      <nav>${tabs
        .slice(1)
        .map(([id, href]) => `<a href="${href}" class="top-${id}"${id === tab ? ' aria-current="page"' : ''}>${esc(id === 'new' ? t('postAd') : name[id])}</a>`)
        .join('')}</nav>
    </div>`;
}

async function render({ restored = false } = {}) {
  const id = ++turn;
  cleanups.forEach((fn) => fn());
  cleanups = [];
  closeSheet();

  const path = location.pathname.replace(/(.)\/$/, '$1');
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) return go('/', { replace: true });
  const [re, page, tab] = route;
  const isItem = page === item;

  document.documentElement.lang = lang();
  document.title = 'Tapty — объявления по Казахстану';
  document.body.dataset.page = isItem ? 'item' : path === '/' ? 'home' : '';
  chrome(tab);

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

document.addEventListener('click', (e) => {
  const heart = e.target.closest('[data-fav]');
  if (heart) {
    e.preventDefault();
    const on = favorites.toggle(Number(heart.dataset.fav));
    heart.setAttribute('aria-pressed', on);
    heart.setAttribute('aria-label', t(on ? 'fromFav' : 'toFav'));
    return;
  }
  const link = e.target.closest('a[href^="/"]');
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || link.target) return;
  e.preventDefault();
  go(link.getAttribute('href'));
});

history.scrollRestoration = 'manual';
history.replaceState({ key, depth }, '');
addEventListener('popstate', (e) => {
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
