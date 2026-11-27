// Список переписок.
import { api, auth } from '../api.js';
import { authForm } from '../auth.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { $, dateText, emptyState, errorText, esc, timeText } from '../ui.js';

export default async function chats({ root, alive, rerender, onLeave }) {
  root.innerHTML = `
    <div class="page-head"><h1>${esc(t('messages'))}</h1></div>
    <div class="narrow chat-list"><p class="muted">…</p></div>`;
  const box = $('.chat-list', root);
  const login = () => {
    box.innerHTML = '';
    authForm(box, { note: t('chatLogin'), onDone: rerender });
  };
  if (!auth.signedIn()) return login();

  let timer;
  let drawn = '';
  onLeave(() => clearTimeout(timer));

  async function load() {
    clearTimeout(timer);
    try {
      const { items } = await api('/chats');
      if (!alive()) return;
      const when = (at) => (dateText(at) === t('today') ? timeText(at) : dateText(at));
      const html = items.length
        ? `<ul class="dialogs">${items
            .map(
              (c) => `<li><a href="/chat/${c.id}"${c.unread ? ' class="new"' : ''}>
                <span class="my-photo">${c.photo ? `<img src="/p/${c.photo}/t" alt="" loading="lazy">` : icon('camera')}</span>
                <span class="dialog-text">
                  <span><strong>${esc(c.other)}</strong><small>${esc(when(c.at))}</small></span>
                  <small>${c.blocked ? `${esc(t('blockedTag'))}. ` : ''}${esc(c.title)}</small>
                  <span><span class="dialog-last">${c.lastMine ? `${esc(t('you'))}: ` : ''}${esc(c.last || t('photoMessage'))}</span>${
                    c.unread ? `<b>${c.unread}</b>` : ''
                  }</span>
                </span></a></li>`
            )
            .join('')}</ul>`
        : emptyState(t('noChats'), t('noChatsHint'), `<a class="btn" href="/">${esc(t('toHome'))}</a>`);
      // Перерисовываем только при изменениях, чтобы не сбивать фокус.
      if (html !== drawn) box.innerHTML = drawn = html;
    } catch (e) {
      if (!alive()) return;
      if (e.code === 'login_required') return login();
      if (!drawn) {
        box.innerHTML = `<div class="empty"><p>${esc(errorText(e))}</p><button class="btn ghost">${esc(t('retry'))}</button></div>`;
        $('button', box).onclick = load;
        return;
      }
    }
    timer = setTimeout(load, 10000);
  }
  await load();
}
