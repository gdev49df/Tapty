// Список переписок.
import { api, auth } from '../api.js';
import { authForm } from '../auth.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { askDeleteChat } from '../dialogs.js';
import { $, dateText, emptyState, errorText, esc, lastText, timeText } from '../ui.js';

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
  let latest = 0; // ответ на устаревший запрос не должен вернуть удалённый диалог
  onLeave(() => clearTimeout(timer));
  box.addEventListener('click', (e) => {
    const cross = e.target.closest('[data-remove]');
    if (cross) askDeleteChat(cross.dataset.remove, cross.dataset.name, () => alive() && load());
  });

  async function load() {
    clearTimeout(timer);
    const request = ++latest;
    try {
      const { items } = await api('/chats');
      if (!alive() || request !== latest) return;
      const when = (at) => (dateText(at) === t('today') ? timeText(at) : dateText(at));
      const html = items.length
        ? `<ul class="dialogs">${items
            .map(
              (c) => `<li><a href="/chat/${c.id}"${c.unread ? ' class="new"' : ''}>
                <span class="my-photo">${c.photo ? `<img src="/p/${c.photo}/t" alt="" loading="lazy">` : icon('camera')}</span>
                <span class="dialog-text">
                  <span><strong>${esc(c.other)}</strong><small>${
                    c.pinned ? `<span class="pinned" role="img" aria-label="${esc(t('pinnedTag'))}">${icon('pushpin')}</span>` : ''
                  }${esc(when(c.at))}</small></span>
                  <small>${c.blocked ? `${esc(t('blockedTag'))}. ` : ''}${esc(c.title)}</small>
                  <span><span class="dialog-last">${c.lastMine ? `${esc(t('you'))}: ` : ''}${esc(lastText(c))}</span>${
                    c.unread ? `<b>${c.unread}</b>` : ''
                  }</span>
                </span></a>
                <button type="button" class="dialog-remove" data-remove="${c.id}" data-name="${esc(c.other)}" aria-label="${esc(t('deleteChat'))}">${icon('close')}</button></li>`
            )
            .join('')}</ul>`
        : emptyState(t('noChats'), t('noChatsHint'), `<a class="btn" href="/">${esc(t('toHome'))}</a>`);
      // Перерисовываем только при изменениях, чтобы не сбивать фокус.
      if (html !== drawn) box.innerHTML = drawn = html;
    } catch (e) {
      if (!alive() || request !== latest) return;
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
