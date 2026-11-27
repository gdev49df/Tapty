import { api } from '../api.js';
import { CATEGORIES, CONDITIONS, PRICE_TYPES } from '../catalog.js';
import { icon } from '../icons.js';
import { label, t } from '../i18n.js';
import { store } from '../store.js';
import { $, cityName, cityOptions, emptyState, esc, feed, pick, sheet } from '../ui.js';

const KEYS = ['q', 'cat', 'city', 'min', 'max', 'cond', 'type', 'sort'];

let cache = null; // результаты для возврата «назад»

export default function search({ root, query, alive, onLeave, go, restored }) {
  const filters = Object.fromEntries(KEYS.map((k) => [k, query.get(k) || '']));
  if (!query.has('city')) filters.city = store.get('city', '');
  const sorts = [
    { value: '', label: t('sortNew') },
    { value: 'cheap', label: t('sortCheap') },
    { value: 'expensive', label: t('sortExpensive') },
  ];
  const catName = () => label(CATEGORIES.find((c) => c.id === filters.cat)) || t('category');
  const extra = ['min', 'max', 'cond', 'type'].filter((k) => filters[k]).length;

  const chip = (name, text, on) => `<button class="chip" data-chip="${name}" aria-pressed="${Boolean(on)}">${esc(text)}${icon('down')}</button>`;

  root.innerHTML = `
    <h1 class="sr-only">${esc(t('search'))}</h1>
    <form class="searchbar" role="search">
      ${icon('search')}
      <input type="search" name="q" value="${esc(filters.q)}" placeholder="${esc(t('searchPlaceholder'))}" aria-label="${esc(t('search'))}" enterkeyhint="search" maxlength="80" autocomplete="off">
    </form>
    <div class="chips">
      <button class="chip" data-chip="filters" aria-pressed="${extra > 0}">${icon('sliders')}${esc(t('filters'))}${extra ? ` (${extra})` : ''}</button>
      ${chip('city', filters.city ? cityName(filters.city) : t('allKz'), filters.city)}
      ${chip('cat', catName(), filters.cat)}
      ${chip('sort', sorts.find((s) => s.value === filters.sort)?.label || t('sortNew'), filters.sort)}
    </div>
    <div class="feed"></div>`;

  const url = () => {
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    p.set('city', filters.city);
    return `/search?${p}`;
  };
  const apply = () => go(url(), { replace: true });

  const input = $('input', root);
  let stop = () => {};
  let run = 0;
  const start = (reuse = false) => {
    stop();
    const mine = ++run;
    const id = JSON.stringify(filters);
    if (!reuse || cache?.id !== id) cache = { id, state: { items: [], next: 0 } };
    stop = feed($('.feed', root), (offset) => api(`/listings?${new URLSearchParams({ ...filters, offset })}`), {
      alive: () => alive() && mine === run,
      state: cache.state,
      empty: emptyState(t('emptySearch'), t('emptySearchHint')),
    });
  };
  start(restored);

  // Результаты обновляются по мере набора, без кнопки «найти».
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.q = input.value.trim();
      history.replaceState(history.state, '', url());
      start();
    }, 350);
  });
  $('form', root).onsubmit = (e) => {
    e.preventDefault();
    input.blur();
  };
  if (!restored && ![...query.keys()].length) input.focus();
  onLeave(() => {
    clearTimeout(timer);
    stop();
  });

  $('.chips', root).addEventListener('click', async (e) => {
    const name = e.target.closest('[data-chip]')?.dataset.chip;
    if (!name) return;
    if (name === 'filters') return openFilters();
    const lists = {
      city: [t('city'), [{ value: '', label: t('allKz') }, ...cityOptions()]],
      cat: [t('category'), [{ value: '', label: t('all') }, ...CATEGORIES.map((c) => ({ value: c.id, label: label(c) }))]],
      sort: [t('sort'), sorts],
    };
    const value = await pick(lists[name][0], lists[name][1], filters[name]);
    if (value === undefined) return;
    filters[name] = value;
    if (name === 'city') store.set('city', value);
    apply();
  });

  function openFilters() {
    const radios = (name, values) =>
      [['', t('any')], ...values.map((v) => [v, t(v)])]
        .map(([v, text]) => `<label class="seg"><input type="radio" name="${name}" value="${v}"${filters[name] === v ? ' checked' : ''}><span>${esc(text)}</span></label>`)
        .join('');
    const s = sheet(
      `<form class="form">
        <fieldset><legend>${esc(t('price'))}, ₸</legend>
          <div class="row">
            <input class="input" name="min" inputmode="numeric" placeholder="${esc(t('priceFrom'))}" aria-label="${esc(t('priceFrom'))}" value="${esc(filters.min)}">
            <input class="input" name="max" inputmode="numeric" placeholder="${esc(t('priceTo'))}" aria-label="${esc(t('priceTo'))}" value="${esc(filters.max)}">
          </div>
        </fieldset>
        <fieldset><legend>${esc(t('condition'))}</legend><div class="segs">${radios('cond', CONDITIONS)}</div></fieldset>
        <fieldset><legend>${esc(t('deal'))}</legend><div class="segs">${radios('type', PRICE_TYPES)}</div></fieldset>
        <div class="row">
          <button type="button" class="btn ghost" data-reset>${esc(t('reset'))}</button>
          <button class="btn">${esc(t('show'))}</button>
        </div>
      </form>`,
      { title: t('filters') }
    );
    const form = $('form', s.body);
    form.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(form);
      for (const k of ['min', 'max']) filters[k] = String(data.get(k) || '').replace(/\D/g, '');
      for (const k of ['cond', 'type']) filters[k] = String(data.get(k) || '');
      apply();
    };
    $('[data-reset]', form).onclick = () => {
      filters.min = filters.max = filters.cond = filters.type = '';
      apply();
    };
  }
}
