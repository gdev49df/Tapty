// Модерация: открывается по адресу /admin и ключу из секрета ADMIN_KEY. Если задан секрет
// ADMIN_TOTP, дополнительно нужен код из приложения-аутентификатора.
// На компьютере слева меню, в середине список, справа карточка; на телефоне разделы сверху.
import { icon } from '../icons.js';
import { $, $$, esc, toast } from '../ui.js';
import { access, failed, loading, openSession, problem, send } from '../admin/common.js';
import { flashRows, leaveRows, play, pop, shake, snapshot, spin } from '../admin/motion.js';
import overview from '../admin/overview.js';
import queue from '../admin/queue.js';
import listings from '../admin/listings.js';
import shops from '../admin/shops.js';
import users from '../admin/users.js';
import reviews from '../admin/reviews.js';
import settings from '../admin/settings.js';

const SECTIONS = {
  overview: ['Обзор', 'grid', overview],
  queue: ['Жалобы', 'flag', queue],
  listings: ['Объявления', 'file', listings],
  shops: ['Магазины', 'store', shops],
  users: ['Пользователи', 'user', users],
  reviews: ['Отзывы', 'star', reviews],
  settings: ['Настройки', 'sliders', settings],
};
// у этих разделов на вкладке число того, что ждёт решения
const COUNTED = ['queue', 'listings', 'shops'];

// Свои стили подключаются при первом открытии: посетителям они не нужны.
function styles() {
  let link = $('link[data-admin]');
  if (link) return Promise.resolve();
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/admin.css';
  link.dataset.admin = '';
  return new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = () => {
      link.remove();
      resolve();
    };
    document.head.append(link);
  });
}

export default async function admin({ root, query, alive, onLeave }) {
  document.title = 'Модерация · tapty.';
  await styles();
  if (!alive()) return;

  function login(needCode = false) {
    document.documentElement.classList.remove('adm-locked');
    root.innerHTML = `
      <div class="adm-login">
        <a href="/" class="logo"><img src="/img/tapty.svg" alt="tapty." width="83" height="28"></a>
        <h1>Модерация</h1>
        <form class="form">
          <label class="field"><span>Ключ администратора</span><input class="input" name="key" type="password" autocomplete="off" value="${esc(access.key)}"></label>
          <label class="field" data-code${needCode ? '' : ' hidden'}><span>Код из приложения</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></label>
          <button class="btn wide">Открыть</button>
        </form>
      </div>`;
    const form = $('form', root);
    const codeField = $('[data-code]', root);
    form.elements[needCode ? 'code' : 'key'].focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = $('button', form);
      access.key = form.elements.key.value.trim();
      const code = form.elements.code.value.trim();
      button.disabled = true;
      try {
        if (!codeField.hidden && code) ({ pass: access.pass } = await openSession(code));
        await send('/counts');
        if (alive()) panelView();
      } catch (err) {
        button.disabled = false;
        // ключ верный, нужен код
        if (err.code === 'code_required') {
          access.pass = '';
          codeField.hidden = false;
          form.elements.code.focus();
        } else {
          shake(form);
          toast(err.code === 'not_found' ? 'Сначала задайте секрет ADMIN_KEY' : problem(err));
        }
      }
    };
  }

  let leave = () => {};

  function panelView() {
    leave();
    let tab = Object.hasOwn(SECTIONS, query.get('tab')) ? query.get('tab') : 'overview';
    let turn = 0;
    let panelTurn = 0;
    let selected = '';
    let opener = null;
    let cleanups = [];

    root.innerHTML = `
      <div class="adm">
        <aside class="adm-side">
          <div class="adm-brand">
            <a href="/" class="logo"><img src="/img/tapty.svg" alt="tapty." width="83" height="28"></a>
            <div class="adm-exits">
              <a href="/">На сайт</a>
              <button type="button" data-exit>${icon('logout')}Выйти</button>
            </div>
          </div>
          <nav class="adm-nav" aria-label="Разделы модерации">${Object.entries(SECTIONS)
            .map(([id, [name, ic]]) => `<button type="button" data-tab="${id}">${icon(ic)}<span>${name}</span>${COUNTED.includes(id) ? '<b hidden></b>' : ''}</button>`)
            .join('')}</nav>
        </aside>
        <div class="adm-main">
          <header class="adm-head"><h1></h1><button type="button" class="icon-btn" data-refresh aria-label="Обновить">${icon('refresh')}</button></header>
          <div class="adm-content"></div>
        </div>
        <aside class="adm-panel" aria-label="Подробности" tabindex="-1" hidden>
          <div class="adm-panel-head"><h2></h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
          <div class="adm-panel-body"></div>
        </aside>
      </div>`;
    const shell = $('.adm', root);
    const side = $('.adm-panel', root);
    // содержимое раздела и карточки каждый раз новое, вместе с обработчиками
    const fresh = (selector) => {
      const old = $(selector, root);
      const next = old.cloneNode(false);
      old.replaceWith(next);
      return next;
    };

    const paintSelection = () => $$('.adm-content [data-key]', root).forEach((el) => el.classList.toggle('selected', el.dataset.key === selected));

    const hidePanel = () => {
      side.hidden = true;
      side.inert = false;
      side.classList.remove('closing');
      shell.classList.remove('with-panel');
    };

    // пока карточка уезжает, она inert и для кода уже закрыта
    const panel = {
      show(title) {
        const turnNow = ++panelTurn;
        if (side.hidden || side.inert) opener = document.activeElement;
        side.hidden = false;
        side.inert = false;
        side.classList.remove('closing');
        shell.classList.add('with-panel');
        document.documentElement.classList.add('adm-locked');
        $('h2', side).textContent = title;
        const body = fresh('.adm-panel-body');
        side.focus({ preventScroll: true });
        return { body, alive: () => alive() && turnNow === panelTurn && !side.hidden };
      },
      // now — убрать сразу: раздел всё равно меняется целиком
      close(now = false) {
        if (side.hidden || (side.inert && !now)) return;
        const turnNow = ++panelTurn;
        side.inert = true;
        document.documentElement.classList.remove('adm-locked');
        selected = '';
        paintSelection();
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        if (now) return hidePanel();
        side.classList.add('closing');
        Promise.allSettled(side.getAnimations().map((a) => a.finished)).then(() => turnNow === panelTurn && hidePanel());
      },
    };

    async function counts() {
      const data = await send('/counts');
      for (const id of COUNTED) {
        const mark = $(`[data-tab="${id}"] b`, root);
        if (!mark) continue;
        const changed = !mark.hidden && mark.textContent !== String(data[id]);
        mark.textContent = data[id];
        mark.hidden = !data[id];
        if (changed) pop(mark);
      }
      return data;
    }

    // mode: new — раздел с нуля; switch — другой вид того же раздела; keep — список после действия
    async function render({ mode = 'new' } = {}) {
      const id = ++turn;
      cleanups.forEach((fn) => fn());
      cleanups = [];
      const [name, , section] = SECTIONS[tab];
      $('.adm-head h1', root).textContent = name;
      for (const b of $$('[data-tab]', root)) b.toggleAttribute('data-current', b.dataset.tab === tab);
      $('[data-current]', root).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const old = $('.adm-content', root);
      const box = old.cloneNode(false);
      box.classList.remove('waiting');
      // появляется с движением только новое: после действия список не мигает
      box.classList.toggle('enter', mode !== 'keep');
      if (mode === 'new') {
        box.innerHTML = loading;
        old.replaceWith(box);
      }
      // в остальных случаях старый список остаётся на месте, пока не готов новый
      if (mode === 'switch') old.classList.add('waiting');
      const ctx = {
        box,
        alive: () => alive() && id === turn,
        onLeave: (fn) => cleanups.push(fn),
        panel,
        counts,
        select: (key) => {
          selected = key;
          paintSelection();
        },
        open: (next) => go(next),
        reload: () => render({ mode: 'switch' }),
        // действие выполнено: карточка закрывается, список обновляется
        done: () => {
          panel.close();
          render({ mode: 'keep' });
        },
      };
      try {
        await section(ctx);
        if (!ctx.alive()) return;
        if (mode === 'keep') {
          const before = snapshot(old);
          await leaveRows(old, box);
          if (!ctx.alive()) return;
          const at = window.scrollY;
          old.replaceWith(box);
          window.scrollTo(0, at);
          flashRows(before, box);
        } else {
          if (mode === 'switch') old.replaceWith(box);
          // всё появилось: дальше добавленное и перерисованное не должно прыгать заново
          setTimeout(() => box.classList.remove('enter'), 1100);
        }
        paintSelection();
      } catch (e) {
        if (!ctx.alive()) return;
        old.classList.remove('waiting');
        failed(mode === 'new' ? box : old, e, () => render());
      }
    }

    function go(next) {
      tab = next;
      panel.close(true);
      history.replaceState(history.state, '', `/admin?tab=${tab}`);
      window.scrollTo(0, 0);
      render();
      play($('.adm-head h1', root), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }]);
    }

    shell.addEventListener('click', (e) => {
      const button = e.target.closest('[data-tab]');
      if (button?.closest('.adm-nav')) go(button.dataset.tab);
      const refresh = e.target.closest('[data-refresh]');
      if (refresh) {
        spin($('.i', refresh));
        panel.close(true);
        render();
      }
      // нажатый вид отмечается сразу, не дожидаясь списка
      const view = e.target.closest('.adm-seg [data-view]');
      if (view) $$('button', view.parentElement).forEach((b) => b.setAttribute('aria-pressed', b === view));
      if (e.target.closest('.adm-panel-head [data-close]')) panel.close();
      if (e.target.closest('[data-exit]')) {
        access.key = '';
        access.pass = '';
        leave();
        login();
      }
    });
    // окна поверх карточки (причина, фото) закрываются своим Escape
    const onKey = (e) => e.key === 'Escape' && !$('.sheet-wrap, .viewer') && panel.close();
    const expired = () => {
      access.pass = '';
      leave();
      login(true);
    };
    document.addEventListener('keydown', onKey);
    addEventListener('tapty:admin-code', expired);
    leave = () => {
      turn += 1;
      panelTurn += 1;
      cleanups.forEach((fn) => fn());
      cleanups = [];
      document.removeEventListener('keydown', onKey);
      removeEventListener('tapty:admin-code', expired);
      document.documentElement.classList.remove('adm-locked');
    };

    counts().catch(() => {});
    render();
  }

  onLeave(() => leave());
  // вернулись в модерацию в этой же вкладке: ключ ещё помнится
  if (access.key) {
    try {
      await send('/counts');
      if (alive()) panelView();
      return;
    } catch (e) {
      if (!alive()) return;
      if (e.code === 'code_required') return login(true);
    }
  }
  login();
}
