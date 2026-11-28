// Помощник поиска: просьба своими словами, понятые условия плашками и найденные объявления.
import { api } from '../api.js';
import { CATEGORIES } from '../catalog.js';
import { icon } from '../icons.js';
import { label, lang, t } from '../i18n.js';
import { store } from '../store.js';
import { $, cardHtml, cityName, emptyState, errorText, esc, money, skeleton, toast } from '../ui.js';

let cache = null; // последний ответ для возврата «назад»

const fill = (key, n) => t(key).replace('{n}', money(n));

// Условия, которые понял помощник: каждое можно убрать.
const chips = (f) =>
  [
    f.words.length && ['words', f.words.slice(0, 3).join(', ')],
    f.cat && ['cat', label(CATEGORIES.find((c) => c.id === f.cat))],
    f.city && ['city', cityName(f.city)],
    f.min && ['min', fill('aiMin', f.min)],
    f.max && ['max', fill('aiMax', f.max)],
    f.cond && ['cond', t(f.cond)],
    f.type && ['type', t(f.type)],
    f.sort && ['sort', t(f.sort === 'cheap' ? 'sortCheap' : 'sortExpensive')],
  ].filter(Boolean);

export default function assistant({ root, query, alive, back, restored }) {
  const asked = (query.get('q') || '').slice(0, 200);
  if (!restored) cache = null;

  root.innerHTML = `
    <div class="page-head"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(t('aiTitle'))}</h1></div>
    <form class="form ai-form">
      <label class="field"><span></span><textarea class="input" name="text" rows="2" maxlength="200" enterkeyhint="search"></textarea></label>
      <button class="btn wide">${icon('search')}<span></span></button>
      <div class="quick ai-tries">${['aiTry1', 'aiTry2', 'aiTry3'].map((k) => `<button type="button" data-try>${esc(t(k))}</button>`).join('')}</div>
      <p class="muted small">${esc(t('aiNote'))}</p>
    </form>
    <div class="ai-result" aria-live="polite"></div>`;
  $('[data-back]', root).onclick = back;
  const form = $('.ai-form', root);
  const field = form.elements.text;
  const button = $('.btn', form);
  const out = $('.ai-result', root);

  // До первого ответа форма спрашивает, что искать, после него — что поменять.
  const paintForm = () => {
    const refining = Boolean(cache);
    $('.field > span', form).textContent = t(refining ? 'aiRefineAsk' : 'aiAsk');
    field.placeholder = t(refining ? 'aiRefineExample' : 'aiExample');
    $('span', button).textContent = t(refining ? 'aiRefine' : 'aiFind');
    $('.ai-tries', form).hidden = refining;
  };

  function draw() {
    paintForm();
    if (!cache) {
      out.innerHTML = '';
      return;
    }
    const { filters, items, relaxed, ai } = cache;
    out.innerHTML = `
      <div class="ai-seek"><h2>${esc(t('aiSeek'))}</h2><div class="ai-chips">${chips(filters)
        .map(([key, text]) => `<button type="button" class="chip" data-drop="${key}" aria-label="${esc(`${t('aiDrop')}: ${text}`)}">${esc(text)}${icon('close')}</button>`)
        .join('')}</div></div>
      ${ai === false ? `<p class="why">${esc(t('aiBasic'))}</p>` : ''}
      ${relaxed.length ? `<p class="why">${esc(`${t('aiNoExact')} ${relaxed.map((r) => t(`ai_${r}`)).join(', ')}.`)}</p>` : ''}
      ${
        items.length
          ? `<h2>${esc(t('aiFound'))}</h2><div class="grid">${items.map(cardHtml).join('')}</div>`
          : emptyState(t('aiNothing'), t('aiNothingHint'))
      }
      <button type="button" class="btn ghost wide ai-again" data-again>${esc(t('aiAgain'))}</button>`;
  }

  let run = 0;
  async function ask(body) {
    const mine = ++run;
    button.disabled = true;
    const before = out.innerHTML;
    out.innerHTML = `<div class="grid">${skeleton(4)}</div>`;
    try {
      const data = await api('/ai/search', { method: 'POST', body: { lang: lang(), ...body } });
      if (!alive() || mine !== run) return;
      // непонятую первую просьбу не за что уточнять; когда просто убрали условие,
      // про нейросеть остаётся известное из прошлого ответа
      cache = data.unclear ? null : { ...data, ai: data.ai ?? cache?.ai };
      field.value = data.unclear ? field.value : '';
      draw();
      if (data.unclear) out.innerHTML = emptyState(t('aiUnclear'), t('aiUnclearHint'));
      else out.scrollIntoView({ block: 'start', behavior: 'auto' });
    } catch (e) {
      if (!alive() || mine !== run) return;
      out.innerHTML = before;
      toast(errorText(e));
    } finally {
      if (mine === run) button.disabled = false;
    }
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const text = field.value.trim();
    if (text.length < 2 || button.disabled) return field.focus();
    field.blur();
    ask(cache ? { text, filters: cache.filters } : { text, city: store.get('city', '') });
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('click', (e) => {
    const example = e.target.closest('[data-try]');
    if (!example) return;
    field.value = example.textContent;
    form.requestSubmit();
  });
  out.addEventListener('click', (e) => {
    if (e.target.closest('[data-again]')) {
      cache = null;
      field.value = '';
      draw();
      scrollTo(0, 0);
      return field.focus();
    }
    const drop = e.target.closest('[data-drop]');
    if (!drop || button.disabled) return;
    const key = drop.dataset.drop;
    const filters = { ...cache.filters, [key]: key === 'words' ? [] : null };
    // убрали всё — начинаем сначала
    if (!chips({ ...filters, sort: '' }).length) {
      cache = null;
      return draw();
    }
    ask({ filters });
  });

  draw();
  if (!cache && asked) {
    field.value = asked;
    form.requestSubmit();
  } else if (!cache) field.focus();
}
