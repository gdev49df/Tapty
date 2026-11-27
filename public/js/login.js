import { api } from './api.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { store } from './store.js';
import { $, errorText, esc, toast } from './ui.js';

export function loginBlock(root, { onDone, onLeave }) {
  let timer;
  let stopped = false;
  let pending = null;
  let check = () => {};
  const visible = () => document.visibilityState === 'visible' && check();
  document.addEventListener('visibilitychange', visible);
  onLeave(() => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', visible);
  });

  const intro = (note = '') => {
    pending = null;
    root.innerHTML = `
      <div class="panel">
        <p>${esc(note || t('loginWhy'))}</p>
        <button class="btn wide">${icon('send')}${esc(t('loginTg'))}</button>
      </div>`;
    $('button', root).onclick = start;
  };

  async function start() {
    $('button', root).disabled = true;
    try {
      pending = await api('/auth/start', { method: 'POST' });
    } catch (e) {
      toast(errorText(e));
      return intro();
    }
    root.innerHTML = `
      <div class="panel">
        <p>${esc(t('loginStep'))}</p>
        <p class="code">${esc(pending.code)}</p>
        <a class="btn wide" href="${esc(pending.url)}" target="_blank" rel="noopener">${icon('send')}${esc(t('openBot'))}</a>
        <p class="muted small" role="status">${esc(t('waiting'))}</p>
      </div>`;
    let busy = false;
    check = async () => {
      if (busy || stopped || !pending) return;
      busy = true;
      clearTimeout(timer);
      try {
        const res = await api('/auth/poll', { headers: { 'x-login-nonce': pending.nonce, 'x-login-secret': pending.secret } });
        if (stopped) return;
        if (res.status === 'ok') {
          store.set('session', res.token);
          pending = null;
          toast(t('loggedIn'));
          return onDone();
        }
        if (res.status === 'expired') return intro(t('loginExpired'));
      } catch {
        // сеть пропала на секунду — попробуем ещё раз
      } finally {
        busy = false;
      }
      timer = setTimeout(check, 2500);
    };
    timer = setTimeout(check, 2500);
  }

  intro();
}
