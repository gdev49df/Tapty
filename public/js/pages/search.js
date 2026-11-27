import { api } from '../api.js';
import { CATEGORIES, CONDITIONS, PRICE_TYPES } from '../catalog.js';
import { icon } from '../icons.js';
import { label, t } from '../i18n.js';
import { store } from '../store.js';
import { $, emptyState, esc, feed, pick, sheet } from '../ui.js';

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

  const chip = (name, text, on) => `<button class="chip" data-chip="${name}" aria-pressed="${Boolean(on)}">${esc(text)}${icon('down')}</button>`;

  root.innerHTML = `
    <h1 class="sr-only">${esc(t('search'))}</h1>
    <div class="chips">
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

  // Строка поиска и кнопка «Фильтры» живут в общей шапке.
  const input = $('#q');
  const filterButton = $('#topbar .filter-btn');
  if (document.activeElement !== input) input.value = filters.q;
  else filters.q = input.value.trim();
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
  const onInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.q = input.value.trim();
      history.replaceState(history.state, '', url());
      start();
    }, 350);
  };
  const onFilters = (e) => {
    e.preventDefault();
    openFilters();
  };
  input.addEventListener('input', onInput);
  filterButton.addEventListener('click', onFilters);
  onLeave(() => {
    clearTimeout(timer);
    stop();
    input.removeEventListener('input', onInput);
    filterButton.removeEventListener('click', onFilters);
  });
  if (query.has('filters')) {
    history.replaceState(history.state, '', url());
    openFilters();
  } else if (!restored && ![...query.keys()].length) input.focus();

  $('.chips', root).addEventListener('click', async (e) => {
    const name = e.target.closest('[data-chip]')?.dataset.chip;
    if (!name) return;
    const lists = {
      cat: [t('category'), [{ value: '', label: t('all') }, ...CATEGORIES.map((c) => ({ value: c.id, label: label(c) }))]],
      sort: [t('sort'), sorts],
    };
    const value = await pick(lists[name][0], lists[name][1], filters[name]);
    if (value === undefined) return;
    filters[name] = value;
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
