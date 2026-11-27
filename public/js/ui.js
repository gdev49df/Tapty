import { icon } from './icons.js';
import { lang, label, t } from './i18n.js';
import { favorites } from './favorites.js';
import { AREAS, CITIES } from './catalog.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;

export function priceText(item) {
  if (item.priceType === 'free') return t('free');
  if (item.priceType === 'exchange' && !item.price) return t('exchange');
  return money(item.price);
}

export const cityName = (id) => label(CITIES.find((c) => c.id === id));
export const areaName = (city, id) => label(AREAS[city]?.find((a) => a.id === id));
export const placeText = (item) => [cityName(item.city), areaName(item.city, item.area), item.district].filter(Boolean).join(', ');
export const areaOptions = (city) => (AREAS[city] || []).map((a) => ({ value: a.id, label: label(a) }));

// Прежняя цена показывается, только если она и правда выше нынешней.
export const wasCheaper = (item) => item.oldPrice > item.price && ['fixed', 'bargain'].includes(item.priceType);

export const ratingText = (n) => String(n.toFixed(1)).replace('.', ',');

export const verifiedBadge = () => `<span class="verified">${icon('verified')}${esc(t('verified'))}</span>`;

// Пять звёзд, из которых закрашено столько, сколько поставили.
export const stars = (n) =>
  `<span class="stars" role="img" aria-label="${n} / 5">${[1, 2, 3, 4, 5]
    .map((i) => icon('star', i <= Math.round(n) ? 'on' : ''))
    .join('')}</span>`;

const MONTHS = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  kk: ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'],
};

export function dateText(seconds) {
  const date = new Date(seconds * 1000);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return t('today');
  if (days === 1) return t('yesterday');
  if (days > 1 && days < 7) return `${days} ${t('daysAgo')}`;
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[lang()][date.getMonth()]}${year}`;
}

export const timeText = (seconds) => new Date(seconds * 1000).toTimeString().slice(0, 5);

const KK_FROM = ['қаңтардан', 'ақпаннан', 'наурыздан', 'сәуірден', 'мамырдан', 'маусымнан', 'шілдеден', 'тамыздан', 'қыркүйектен', 'қазаннан', 'қарашадан', 'желтоқсаннан'];

export function sinceText(seconds) {
  const date = new Date(seconds * 1000);
  const [m, y] = [date.getMonth(), date.getFullYear()];
  return lang() === 'kk' ? `tapty-де ${y} жылғы ${KK_FROM[m]}` : `На tapty с ${MONTHS.ru[m]} ${y}`;
}

export const initial = (name) => esc([...String(name)][0]?.toUpperCase() || '?');

export const phoneText = (p) => `+${p[0]} ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9)}`;

let toastTimer;
export function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), 2800);
}

export const errorText = (e) => {
  const key = `err_${e.code}`;
  return t(key) === key ? t('err_server') : t(key);
};

export async function copyText(text, message = t('copied')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    sheet(`<textarea class="input" rows="3" readonly>${esc(text)}</textarea>`).body.querySelector('textarea').select();
  }
}

let active = null;
// Нижняя шторка (на компьютере — окно по центру).
// reset — подпись кнопки «Сбросить»: тогда в шапке она слева, а «Закрыть» словом справа. foot — кнопка под списком.
export function sheet(html, { title = '', onClose, reset = '', foot = '' } = {}) {
  closeSheet();
  const opener = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title || 'tapty.')}" tabindex="-1">
      <div class="sheet-head${reset ? ' worded' : ''}">
        ${reset ? `<button type="button" class="sheet-text" data-reset>${esc(reset)}</button>` : ''}
        <h2>${esc(title)}</h2>
        ${
          reset
            ? `<button type="button" class="sheet-text" data-close>${esc(t('close'))}</button>`
            : `<button class="icon-btn" data-close aria-label="${esc(t('close'))}">${icon('close')}</button>`
        }
      </div>
      <div class="sheet-body">${html}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
  const onKey = (e) => {
    if (e.key === 'Escape') closeSheet();
    if (e.key !== 'Tab') return;
    const items = $$('a[href], button:not([disabled]), input, select, textarea', wrap);
    const first = items[0];
    const last = items.at(-1);
    if (e.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', onKey);
  $('#overlay').append(wrap);
  document.documentElement.classList.add('locked');
  active = () => {
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    document.documentElement.classList.remove('locked');
    opener?.focus?.({ preventScroll: true });
    onClose?.();
  };
  // В окне с «Закрыть» словом фокус получает само окно, чтобы вокруг слова не появлялась рамка.
  $(reset ? '.sheet' : '[data-close]', wrap).focus({ preventScroll: true });
  return { el: wrap, body: $('.sheet-body', wrap), close: closeSheet };
}

export function closeSheet() {
  const close = active;
  active = null;
  close?.();
}

export function pick(title, options, selected) {
  return new Promise((resolve) => {
    let value;
    const s = sheet(
      `<ul class="options">${options
        .map(
          (o) =>
            `<li><button data-value="${esc(o.value)}" aria-pressed="${o.value === selected}">${esc(o.label)}${o.value === selected ? icon('check') : ''}</button></li>`
        )
        .join('')}</ul>`,
      { title, onClose: () => resolve(value) }
    );
    s.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (!btn) return;
      value = btn.dataset.value;
      s.close();
    });
  });
}

export const cityOptions = () =>
  CITIES.map((c) => ({ value: c.id, label: c[lang()] }));

export function cardHtml(item) {
  const on = favorites.has(item.id);
  const place = placeText(item);
  return `
    <article class="card">
      <span class="card-photo">${
        item.photo
          ? `<img src="/p/${item.photo}/t" alt="" loading="lazy" decoding="async">`
          : icon('camera', 'ph')
      }</span>
      <div class="card-head">
        <h3><a href="/item/${item.id}">${esc(item.title)}</a></h3>
        <button class="heart" data-fav="${item.id}" aria-pressed="${on}" aria-label="${esc(t(on ? 'fromFav' : 'toFav'))}">${icon('heart')}</button>
      </div>
      <p class="card-price">${esc(priceText(item))}${
        wasCheaper(item) ? ` <s><span class="sr-only">${esc(t('oldPrice'))} </span>${esc(money(item.oldPrice))}</s>` : ''
      }</p>
      <p class="card-meta card-date">${icon('clock')}<span>${esc(dateText(item.bumpedAt))}</span></p>
      <p class="card-meta card-place">${icon('pin')}<span>${esc(place)}</span></p>
      ${item.condition ? `<p class="card-cond">${esc(t('state'))}: ${esc(t(item.condition))}</p>` : ''}
    </article>`;
}

export const skeleton = (n = 10) =>
  Array.from({ length: n }, () => '<div class="card skel" aria-hidden="true"><span class="card-photo"></span><span></span><span></span></div>').join('');

export function emptyState(title, hint, action = '') {
  return `<div class="empty"><div class="empty-mark" aria-hidden="true"></div><h2>${esc(title)}</h2><p>${esc(hint)}</p>${action}</div>`;
}

// Бесконечная лента: догружает следующую порцию, когда низ списка близко.
export function feed(root, load, { empty, state = { items: [], next: 0 }, alive }) {
  root.innerHTML = '<div class="grid"></div><div class="feed-end"></div>';
  const grid = $('.grid', root);
  const end = $('.feed-end', root);
  const seen = new Set(state.items.map((i) => i.id));
  let busy = false;
  grid.innerHTML = state.items.map(cardHtml).join('');

  const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && more(), { rootMargin: '600px' });

  async function more() {
    if (busy || state.next === null || !alive()) return;
    busy = true;
    if (!state.items.length) grid.innerHTML = skeleton();
    end.innerHTML = state.items.length ? `<p class="loading-more">${esc(t('loadingMore'))}</p>` : '';
    observer.unobserve(end);
    try {
      const data = await load(state.next);
      if (!alive()) return;
      const fresh = data.items.filter((i) => !seen.has(i.id));
      fresh.forEach((i) => seen.add(i.id));
      if (!state.items.length) grid.innerHTML = '';
      state.items.push(...fresh);
      state.next = data.next;
      grid.insertAdjacentHTML('beforeend', fresh.map(cardHtml).join(''));
      end.innerHTML = state.items.length ? '' : empty;
      busy = false;
      if (state.next !== null) observer.observe(end);
    } catch (e) {
      busy = false;
      if (!alive()) return;
      if (!state.items.length) grid.innerHTML = '';
      end.innerHTML = `<div class="empty"><p>${esc(errorText(e))}</p><button class="btn ghost" data-retry>${esc(t('retry'))}</button></div>`;
      $('[data-retry]', end).onclick = more;
    }
  }

  if (!state.items.length && state.next === null) end.innerHTML = empty;
  else if (!state.items.length) more();
  else if (state.next !== null) observer.observe(end);
  return () => observer.disconnect();
}
