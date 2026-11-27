import { api, auth, config, currentUser } from '../api.js';
import { icon } from '../icons.js';
import { lang, t } from '../i18n.js';
import { loginBlock } from '../login.js';
import { store } from '../store.js';
import { $, cityName, cityOptions, copyText, dateText, errorText, esc, pick, priceText, sheet, toast } from '../ui.js';

export default async function me({ root, alive, rerender, onLeave }) {
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
    const [cfg, user] = await Promise.all([config(), currentUser()]);
    if (!alive()) return;
    if (user) {
      account.innerHTML = `
        <div class="seller">
          <span class="avatar" aria-hidden="true">${esc([...user.name][0]?.toUpperCase() || '?')}</span>
          <div><strong>${esc(user.name)}</strong><small>${user.username ? `@${esc(user.username)}` : 'Telegram'}</small></div>
          <button class="icon-btn" data-logout aria-label="${esc(t('logout'))}">${icon('logout')}</button>
        </div>`;
      $('[data-logout]', account).onclick = async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        store.del('session');
        rerender();
      };
    } else if (cfg.telegram) {
      loginBlock(account, { onDone: rerender, onLeave });
    } else {
      keyPanel(account);
    }
  } catch {
    if (!alive()) return;
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
        if (i.status === 'active') actions.push(button(i.id, 'sold', t('sold'), ''));
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

  function keyPanel(box) {
    box.innerHTML = `
      <div class="panel">
        <h2>${icon('key')}${esc(t('keyTitle'))}</h2>
        <p class="muted">${esc(t('keyHint'))}</p>
        <div class="stack">
          <button class="btn ghost" data-copy>${icon('copy')}${esc(t('keyCopy'))}</button>
          <button class="link-btn" data-enter>${esc(t('keyEnter'))}</button>
        </div>
      </div>`;
    $('[data-copy]', box).onclick = () => copyText(auth.deviceKey());
    $('[data-enter]', box).onclick = () => {
      const s = sheet(
        `<p class="muted">${esc(t('keyReplace'))}</p>
         <form class="form"><label class="field"><span>${esc(t('keyField'))}</span><input class="input" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
         <button class="btn wide">${esc(t('save'))}</button></form>`,
        { title: t('keyEnter') }
      );
      $('form', s.body).onsubmit = (e) => {
        e.preventDefault();
        const value = $('input', s.body).value.trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(value)) return toast(t('keyBad'));
        store.set('key', value);
        s.close();
        rerender();
      };
    };
  }

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
