import { api } from '../api.js';
import { CATEGORIES, CONDITIONS, PRICE_TYPES, categoryId } from '../catalog.js';
import { icon } from '../icons.js';
import { label, showCount, t } from '../i18n.js';
import { store } from '../store.js';
import { $, areaOptions, cityOptions, emptyState, esc, feed, pick, sheet } from '../ui.js';

const KEYS = ['q', 'cat', 'city', 'area', 'min', 'max', 'cond', 'type', 'sort'];

let cache = null; // результаты для возврата «назад»

export default function search({ root, query, alive, onLeave, go, restored }) {
  const filters = Object.fromEntries(KEYS.map((k) => [k, query.get(k) || '']));
  filters.cat = categoryId(filters.cat);
  if (!query.has('city')) filters.city = store.get('city', '');
  if (!areaOptions(filters.city).some((a) => a.value === filters.area)) filters.area = '';
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

  // Выбранный город запоминается: по нему же показывается лента на главной.
  function setCity(value) {
    if (value === filters.city) return;
    filters.city = value;
    filters.area = '';
    store.set('city', value);
  }

  function openFilters() {
    const radios = (name, values) =>
      [['', t('any')], ...values.map((v) => [v, t(v)])]
        .map(([v, text]) => `<label class="seg"><input type="radio" name="${name}" value="${v}"${filters[name] === v ? ' checked' : ''}><span>${esc(text)}</span></label>`)
        .join('');
    // Список в рамке: выбранная строка выделена и отмечена галочкой.
    const choice = (name, list) =>
      `<div class="choice">${list
        .map((o) => `<label><input type="radio" name="${name}" value="${o.value}"${filters[name] === o.value ? ' checked' : ''}><span>${esc(o.label)}</span>${icon('check')}</label>`)
        .join('')}</div>`;
    const options = (list, selected) =>
      list.map((o) => `<option value="${o.value}"${selected === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    const areas = (city, selected) => options([{ value: '', label: t('anyArea') }, ...areaOptions(city)], selected);
    let timer;
    const s = sheet(
      `<form class="form" id="filters">
        <label class="field"><span>${esc(t('city'))}</span>
          <select class="input" name="city">${options([{ value: '', label: t('allKz') }, ...cityOptions()], filters.city)}</select>
        </label>
        <label class="field" data-area${areaOptions(filters.city).length ? '' : ' hidden'}><span>${esc(t('fArea'))}</span>
          <select class="input" name="area">${areas(filters.city, filters.area)}</select>
        </label>
        <fieldset><legend>${esc(t('price'))}, ₸</legend>
          <div class="row">
            <input class="input" name="min" inputmode="numeric" placeholder="${esc(t('priceFrom'))}" aria-label="${esc(t('priceFrom'))}" value="${esc(filters.min)}">
            <input class="input" name="max" inputmode="numeric" placeholder="${esc(t('priceTo'))}" aria-label="${esc(t('priceTo'))}" value="${esc(filters.max)}">
          </div>
        </fieldset>
        <fieldset><legend>${esc(t('condition'))}</legend><div class="segs even">${radios('cond', CONDITIONS)}</div></fieldset>
        <fieldset><legend>${esc(t('deal'))}</legend>${choice('type', [{ value: '', label: t('any') }, ...PRICE_TYPES.map((v) => ({ value: v, label: t(v) }))])}</fieldset>
        <fieldset><legend>${esc(t('sort'))}</legend>${choice('sort', sorts)}</fieldset>
      </form>`,
      {
        title: t('filters'),
        reset: t('reset'),
        foot: `<button class="btn wide" form="filters">${esc(t('show'))}</button>`,
        onClose: () => clearTimeout(timer),
      }
    );
    const form = $('form', s.body);
    const submit = $('.sheet-foot .btn', s.el);
    const reset = $('[data-reset]', s.el);
    const chosen = () => {
      const data = new FormData(form);
      const next = Object.fromEntries(['city', 'area', 'cond', 'type', 'sort'].map((k) => [k, String(data.get(k) || '')]));
      for (const k of ['min', 'max']) next[k] = String(data.get(k) || '').replace(/\D/g, '');
      return next;
    };
    // На кнопке — сколько объявлений найдётся с тем, что выбрано сейчас.
    let asked = 0;
    const count = async () => {
      const mine = ++asked;
      try {
        const { total } = await api(`/listings?${new URLSearchParams({ ...filters, ...chosen() })}`);
        if (mine === asked && submit.isConnected) submit.textContent = showCount(total);
      } catch {
        if (mine === asked) submit.textContent = t('show');
      }
    };
    const changed = () => {
      reset.disabled = !Object.values(chosen()).some(Boolean);
      // пока идёт новый подсчёт, старое число не показываем
      asked++;
      submit.textContent = t('show');
      clearTimeout(timer);
      timer = setTimeout(count, 300);
    };
    form.addEventListener('input', changed);
    form.addEventListener('change', (e) => {
      if (e.target.name === 'city') {
        const city = form.elements.city.value;
        form.elements.area.innerHTML = areas(city, city === filters.city ? filters.area : '');
        $('[data-area]', form).hidden = !areaOptions(city).length;
      }
      changed();
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      const { city, ...next } = chosen();
      setCity(city);
      Object.assign(filters, next);
      apply();
    };
    // Очищает поля, окно остаётся открытым: применяет по-прежнему кнопка внизу.
    reset.onclick = () => {
      for (const field of form.querySelectorAll('input, select')) {
        if (field.type === 'radio') field.checked = field.value === '';
        else field.value = '';
      }
      form.elements.area.innerHTML = areas('', '');
      $('[data-area]', form).hidden = true;
      changed();
      form.elements.city.focus();
    };
    reset.disabled = !Object.values(chosen()).some(Boolean);
    count();
  }
}
