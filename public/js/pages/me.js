import { api, currentUser, signOut } from '../api.js';
import { authForm, codeSheet, passwordSheet } from '../auth.js';
import { icon } from '../icons.js';
import { lang, t } from '../i18n.js';
import { store } from '../store.js';
import { $, $$, cityName, cityOptions, dateText, errorText, esc, initial, pick, priceText, sheet, toast } from '../ui.js';

export default async function me({ root, alive, rerender }) {
  root.innerHTML = `
    <div class="page-head"><h1>${esc(t('me'))}</h1></div>
    <div class="narrow">
      <section class="account"></section>
      <section><h2>${esc(t('myAds'))}</h2><div class="mine"><p class="muted">…</p></div></section>
      <section><h2>${esc(t('settings'))}</h2><ul class="menu"></ul></section>
      <p class="credit">Разработано gDev</p>
    </div>`;

  drawMenu();
  const list = $('.mine', root);
  const account = $('.account', root);

  try {
    const user = await currentUser();
    if (!alive()) return;
    if (user) {
      account.innerHTML = `
        <div class="seller">
          <span class="avatar" aria-hidden="true">${initial(user.name)}</span>
          <div><strong>${esc(user.name)}</strong><small>${esc(user.login)}</small></div>
          <button class="icon-btn" data-logout aria-label="${esc(t('logout'))}">${icon('logout')}</button>
        </div>
        <ul class="menu">
          <li><button data-security="password">${icon('lock')}<span>${esc(t('changePassword'))}</span><small></small>${icon('next')}</button></li>
          <li><button data-security="code">${icon('key')}<span>${esc(t('codeTitle'))}</span><small${user.recovery ? '' : ' class="todo"'}>${esc(t(user.recovery ? 'codeExists' : 'codeMissing'))}</small>${icon('next')}</button></li>
        </ul>`;
      $$('[data-security]', account).forEach((b) => {
        b.onclick = () => (b.dataset.security === 'password' ? passwordSheet(user) : codeSheet(user, rerender));
      });
      $('[data-logout]', account).onclick = async () => {
        await signOut();
        rerender();
      };
    } else {
      authForm(account, { note: t('authWhy'), onDone: rerender });
    }
  } catch (e) {
    if (!alive()) return;
    account.innerHTML = `<p class="muted">${esc(errorText(e))}</p>`;
  }
  await loadMine();

  async function loadMine() {
    let items;
    try {
      ({ items } = await api('/mine'));
    } catch (e) {
      if (!alive()) return;
      list.innerHTML = `<p>${esc(errorText(e))}</p><button class="btn ghost">${esc(t('retry'))}</button>`;
      $('button', list).onclick = loadMine;
      return;
    }
    if (!alive()) return;
    if (!items.length) {
      list.innerHTML = `<p class="muted">${esc(t('noAds'))}</p><a class="btn" href="/new">${icon('plus')}${esc(t('postAd'))}</a>`;
      return;
    }
    const button = (id, action, text, cls = 'ghost') => `<button class="btn small ${cls}" data-id="${id}" data-action="${action}">${esc(text)}</button>`;
    list.innerHTML = items
      .map((i) => {
        const actions = [];
        if (i.status === 'active') actions.push(button(i.id, 'sold', t('sold')));
        if (i.status === 'sold') actions.push(button(i.id, 'restore', t('restore'), ''));
        if (i.status === 'expired') actions.push(button(i.id, 'extend', t('extend'), ''));
        if (i.status !== 'hidden') {
          actions.push(`<a class="btn small ghost" href="/edit/${i.id}">${esc(t('edit'))}</a>`);
          actions.push(button(i.id, 'delete', t('remove')));
        }
        const state = i.status === 'active' ? `${t('activeUntil')} ${dateText(i.expiresAt)}` : t(`st_${i.status}`);
        return `<article class="my">
          <a href="/item/${i.id}" class="my-main">
            <span class="my-photo">${i.photo ? `<img src="/p/${i.photo}/t" alt="" loading="lazy">` : icon('camera')}</span>
            <span><strong>${esc(i.title)}</strong><b>${esc(priceText(i))}</b>
              <small class="st-${i.status}">${esc(state)}</small>
              <small>${icon('eye')}${i.views}</small></span>
          </a>
          <div class="my-actions">${actions.join('')}</div>
        </article>`;
      })
      .join('');
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { id, action } = btn.dataset;
    const run = async () => {
      btn.disabled = true;
      try {
        if (action === 'delete') {
          await api(`/listings/${id}`, { method: 'DELETE' });
          toast(t('removed'));
        } else {
          await api(`/listings/${id}/status`, { method: 'POST', body: { action } });
          toast(t('saved'));
        }
        await loadMine();
      } catch (err) {
        btn.disabled = false;
        toast(errorText(err));
      }
    };
    if (action !== 'delete') return run();
    const s = sheet(`<p>${esc(t('removeHint'))}</p><button class="btn wide danger">${esc(t('remove'))}</button>`, { title: t('removeAsk') });
    $('button', s.body).onclick = () => {
      s.close();
      run();
    };
  });

  function drawMenu() {
    const menu = $('.menu', root);
    const city = store.get('city', '');
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const row = (name, ic, text, value = '') =>
      `<li><button data-menu="${name}">${icon(ic)}<span>${esc(text)}</span><small>${esc(value)}</small>${icon('next')}</button></li>`;
    menu.innerHTML =
      row('city', 'pin', t('city'), city ? cityName(city) : t('allKz')) +
      row('lang', 'globe', t('language'), lang() === 'kk' ? 'Қазақша' : 'Русский') +
      (standalone ? '' : row('install', 'download', t('install'))) +
      `<li><a href="/rules">${icon('file')}<span>${esc(t('rules'))}</span><small></small>${icon('next')}</a></li>`;
    menu.onclick = async (e) => {
      const name = e.target.closest('[data-menu]')?.dataset.menu;
      if (name === 'city') {
        const value = await pick(t('chooseCity'), [{ value: '', label: t('allKz') }, ...cityOptions()], city);
        if (value !== undefined) (store.set('city', value), rerender());
      }
      if (name === 'lang') {
        const value = await pick(t('language'), [{ value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }], lang());
        if (value) (store.set('lang', value), rerender());
      }
      if (name === 'install') install();
    };
  }

  async function install() {
    if (window.installPrompt) {
      window.installPrompt.prompt();
      window.installPrompt = null;
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    sheet(
      ios
        ? `<ol class="steps"><li>${icon('share')}<span>${esc(t('iosStep1'))}</span></li><li>${icon('squareplus')}<span>${esc(t('iosStep2'))}</span></li></ol>`
        : `<p>${esc(t('androidStep'))}</p>`,
      { title: t('install') }
    );
  }
}
