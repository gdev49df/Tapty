// Помощник поиска в виде чата: человек пишет своими словами, в ответ приходят объявления.
// Переписка живёт в памяти, пока открыт сайт; на сервере и в браузере она не сохраняется.
import { api } from '../api.js';
import { CATEGORIES } from '../catalog.js';
import { icon } from '../icons.js';
import { label, lang, t } from '../i18n.js';
import { store } from '../store.js';
import { $, $$, cardHtml, cityName, errorText, esc, money } from '../ui.js';

const fill = (key, n) => t(key).replace('{n}', n);
// Столько объявлений приходит самое большее.
const MOST = 24;
// Приветствие и благодарность не требуют ни поиска, ни нейросети.
const SMALL_TALK = [
  ['aiHi', /^(?:привет(?:ик)?|здравствуй(?:те)?|добрый (?:день|вечер)|доброе утро|салам|салем|сәлем(?:етсіз бе)?|hi|hello)[\s!.,)]*$/i],
  ['aiThanks', /^(?:спасибо|спс|благодарю|рахмет|thanks)(?:\s+(?:большое|вам|тебе))?[\s!.,)]*$/i],
];

let talk = []; // сообщения по порядку
let filters = null; // условия последнего удачного поиска
let waiting = false;
let turn = 0; // новый поиск отменяет ответ на прежний
let owner = '';
let page = null; // открытая сейчас страница чата

function reset() {
  talk = [];
  filters = null;
  waiting = false;
  turn += 1;
}

// Условия, которые понял помощник: каждое можно убрать.
const conditions = (f) =>
  [
    f.words.length && ['words', f.words.slice(0, 3).join(', ')],
    f.cat && ['cat', label(CATEGORIES.find((c) => c.id === f.cat))],
    f.city && ['city', cityName(f.city)],
    f.min && ['min', fill('aiMin', money(f.min))],
    f.max && ['max', fill('aiMax', money(f.max))],
    f.cond && ['cond', t(f.cond)],
    f.type && ['type', t(f.type)],
    f.sort && ['sort', t(f.sort === 'cheap' ? 'sortCheap' : 'sortExpensive')],
  ].filter(Boolean);

// Тексты собираются при показе, чтобы смена языка действовала и на прежние ответы.
function words(m) {
  if (m.kind === 'fail') return `${t('aiFail')} ${errorText(m.error)}`;
  if (m.kind !== 'result') return t(m.kind);
  const { items, relaxed, ai } = m;
  const lines = [];
  if (relaxed.length) lines.push(`${t('aiNoExact')} ${relaxed.map((r) => t(`ai_${r}`)).join(', ')}.`);
  lines.push(items.length ? fill(items.length < MOST ? 'aiCount' : 'aiTop', items.length) : t('aiNothing'));
  if (ai === false) lines.push(t('aiBasic'));
  return lines.join('\n');
}

const bubble = (text, mine) => `<div class="msg${mine ? ' mine' : ''}"><p>${esc(text)}</p></div>`;

// Сначала немного объявлений, чтобы ответ помещался на экране.
const firstShown = () => (matchMedia('(min-width: 640px)').matches ? 6 : 4);

function messageHtml(m, i) {
  if (m.mine) return bubble(m.drop ? fill('aiDropped', m.drop) : m.text, true);
  const items = m.items || [];
  const rest = items.length - m.shown;
  return `<div class="ai-reply" data-at="${i}">
    ${bubble(words(m))}
    <div class="ai-chips"></div>
    ${items.length ? `<div class="grid">${items.slice(0, m.shown).map(cardHtml).join('')}</div>` : ''}
    ${rest > 0 ? `<button type="button" class="btn ghost small" data-show>${esc(fill('aiShowMore', rest))}</button>` : ''}
  </div>`;
}

export default function assistant({ root, query, alive, back, restored, onLeave }) {
  // после выхода из аккаунта чужая переписка на экране не остаётся
  const session = store.get('session', '');
  if (owner && owner !== session) reset();
  owner = session;

  root.innerHTML = `
    <div class="chat ai-chat">
      <div class="chat-top">
        <div class="chat-head">
          <div class="page-head"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(t('aiTitle'))}</h1></div>
          <button class="icon-btn" data-again aria-label="${esc(t('aiAgain'))}" title="${esc(t('aiAgain'))}">${icon('refresh')}</button>
        </div>
      </div>
      <div class="messages" role="log" aria-live="polite">
        ${bubble(t('aiHello'))}
        <p class="ai-note">${esc(t('aiNote'))}</p>
        <div class="quick ai-tries">${['aiTry1', 'aiTry2', 'aiTry3'].map((k) => `<button type="button" data-try>${esc(t(k))}</button>`).join('')}</div>
        <div class="ai-talk"></div>
      </div>
      <form class="composer">
        <textarea class="input" rows="1" maxlength="200" enterkeyhint="send" aria-label="${esc(t('aiInput'))}"></textarea>
        <button class="btn" aria-label="${esc(t('sendMessage'))}">${icon('send')}</button>
      </form>
    </div>`;
  $('[data-back]', root).onclick = back;
  const list = $('.ai-talk', root);
  const form = $('.composer', root);
  const input = $('textarea', form);
  const send = $('.btn', form);

  const toEnd = () => scrollTo(0, document.documentElement.scrollHeight);

  // Меняется от сообщения к сообщению: условия под последним ответом, состояние поля, «печатает».
  function paintState() {
    $$('.ai-chips', list).forEach((box) => (box.innerHTML = ''));
    const last = talk.findLastIndex((m) => m.kind === 'result');
    const box = $(`[data-at="${last}"] .ai-chips`, list);
    if (box && filters) {
      box.innerHTML = conditions(filters)
        .map(([key, text]) => `<button type="button" class="chip" data-drop="${key}" aria-label="${esc(`${t('aiDrop')}: ${text}`)}">${esc(text)}${icon('close')}</button>`)
        .join('');
    }
    $$('[data-retry]', list).forEach((b) => b.remove());
    const failed = talk.at(-1);
    if (failed?.kind === 'fail' && !waiting) {
      list.lastElementChild.insertAdjacentHTML('beforeend', `<button type="button" class="btn ghost small" data-retry>${esc(t('retry'))}</button>`);
    }
    $('.ai-typing', list)?.remove();
    if (waiting) {
      list.insertAdjacentHTML('beforeend', `<div class="msg ai-typing"><p><i></i><i></i><i></i><span class="sr-only">${esc(t('aiTyping'))}</span></p></div>`);
    }
    $('.ai-tries', root).hidden = talk.length > 0;
    $('[data-again]', root).hidden = !talk.length;
    input.placeholder = t(filters ? 'aiInputMore' : 'aiInput');
    send.disabled = waiting;
  }

  function draw() {
    list.innerHTML = talk.map(messageHtml).join('');
    paintState();
  }

  // Новое сообщение дописывается в конец, прежние карточки не перерисовываются.
  function show(m) {
    if (!alive()) return;
    $('.ai-typing', list)?.remove();
    list.insertAdjacentHTML('beforeend', messageHtml(m, talk.length - 1));
    const added = list.lastElementChild;
    added.classList.add('new');
    paintState();
    // длинный ответ читают с начала, короткое сообщение — это конец переписки
    if (m.items?.length) added.scrollIntoView({ block: 'start' });
    else toEnd();
  }

  const add = (m) => {
    talk.push(m);
    page?.show(m);
  };
  const reply = (kind, more = {}) => add({ kind, shown: firstShown(), ...more });

  async function ask(body) {
    const mine = ++turn;
    waiting = true;
    page.paintState();
    page.toEnd();
    try {
      const data = await api('/ai/search', { method: 'POST', body: { lang: lang(), ...body } });
      if (mine !== turn) return;
      waiting = false;
      if (data.unclear) return reply(filters ? 'aiUnclearMore' : 'aiUnclear');
      filters = data.filters;
      reply('result', { items: data.items, relaxed: data.relaxed, ai: data.ai });
    } catch (error) {
      if (mine !== turn) return;
      waiting = false;
      reply('fail', { error, body });
    }
  }

  function say(text) {
    if (waiting) return false;
    add({ mine: true, text });
    const small = SMALL_TALK.find(([, re]) => re.test(text));
    if (small) reply(small[0]);
    else ask(filters ? { text, filters } : { text, city: store.get('city', '') });
    return true;
  }

  // Поле растёт вместе с текстом.
  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 120)}px`;
  };
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // кнопка отправки не должна прятать клавиатуру
  send.addEventListener('pointerdown', (e) => e.preventDefault());
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text || !say(text)) return;
    input.value = '';
    resize();
  };

  $('[data-again]', root).onclick = () => {
    reset();
    draw();
    scrollTo(0, 0);
    input.focus();
  };

  $('.messages', root).addEventListener('click', (e) => {
    const example = e.target.closest('[data-try]');
    if (example) return say(example.textContent);
    const more = e.target.closest('[data-show]');
    if (more) {
      const box = more.closest('[data-at]');
      const m = talk[Number(box.dataset.at)];
      $('.grid', box).insertAdjacentHTML('beforeend', m.items.slice(m.shown).map(cardHtml).join(''));
      m.shown = m.items.length;
      return more.remove();
    }
    if (waiting) return;
    if (e.target.closest('[data-retry]')) return ask(talk.at(-1).body);
    const drop = e.target.closest('[data-drop]');
    if (!drop) return;
    const key = drop.dataset.drop;
    const next = { ...filters, [key]: key === 'words' ? [] : null };
    add({ mine: true, drop: drop.textContent.trim() });
    // убрали всё — начинаем сначала
    if (!conditions({ ...next, sort: '' }).length) {
      filters = null;
      return reply('aiReset');
    }
    ask({ filters: next });
  });

  page = { show, paintState, toEnd: () => alive() && toEnd() };
  onLeave(() => (page = null));
  draw();

  const asked = (query.get('q') || '').slice(0, 200).trim();
  // из поиска приходят с готовой просьбой; адрес очищается, чтобы она не отправилась второй раз
  if (asked) history.replaceState(history.state, '', '/assistant');
  if (asked && !restored) say(asked);
  // Роутер после отрисовки прокручивает наверх, поэтому к последнему сообщению переходим кадром позже.
  if (!restored && talk.length) requestAnimationFrame(() => alive() && toEnd());
}
