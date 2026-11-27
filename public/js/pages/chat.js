// Один диалог. Новые сообщения подтягиваются раз в несколько секунд, пока страница открыта.
import { api, auth } from '../api.js';
import { authForm } from '../auth.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { reviewForm } from '../reviews.js';
import { refreshUnread } from '../unread.js';
import { $, dateText, emptyState, errorText, esc, priceText, sheet, timeText, toast } from '../ui.js';

const EVERY = 4000;

export default async function chatPage({ root, params, alive, back, rerender, onLeave }) {
  const id = Number(params[0]);
  const head = (title) =>
    `<div class="page-head"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(title)}</h1></div>`;
  const plain = (html) => {
    root.innerHTML = `${head(t('messages'))}<div class="narrow">${html}</div>`;
    $('[data-back]', root).onclick = back;
  };
  const login = () => {
    plain('');
    authForm($('.narrow', root), { note: t('chatLogin'), onDone: rerender });
  };
  if (!auth.signedIn()) return login();
  plain('<p class="muted">…</p>');

  let data;
  try {
    data = await api(`/chats/${id}`);
  } catch (e) {
    if (!alive()) return;
    if (e.code === 'login_required') return login();
    return plain(
      emptyState(e.status === 404 ? t('chatNotFound') : errorText(e), '', `<a class="btn" href="/chats">${esc(t('messages'))}</a>`)
    );
  }
  if (!alive()) return;

  let { chat, read, messages } = data;
  const { listing } = chat;
  document.title = `${chat.other} — tapty.`;
  const gone = listing.status === 'gone';
  const subtitle = gone ? t('listingGone') : listing.status === 'active' ? priceText(listing) : t(`st_${listing.status}`);
  const ad = `<span class="my-photo">${listing.photo ? `<img src="/p/${listing.photo}/t" alt="">` : icon('camera')}</span>
    <span><strong>${esc(listing.title)}</strong><small>${esc(subtitle)}</small></span>`;

  root.innerHTML = `
    <div class="chat">
      <div class="chat-top">
        ${head(chat.other)}
        ${gone ? `<div class="chat-ad">${ad}</div>` : `<a class="chat-ad" href="/item/${listing.id}">${ad}</a>`}
        <div class="chat-review"></div>
      </div>
      <div class="messages" role="log" aria-live="polite"></div>
      <form class="composer">
        <textarea class="input" rows="1" maxlength="1000" enterkeyhint="send" aria-label="${esc(t('chatInput'))}" placeholder="${esc(t('chatInput'))}"></textarea>
        <button class="btn" aria-label="${esc(t('sendMessage'))}">${icon('send')}</button>
      </form>
    </div>`;
  $('[data-back]', root).onclick = back;
  const list = $('.messages', root);
  const form = $('.composer', root);
  const input = $('textarea', form);

  const nearEnd = () => innerHeight + scrollY > document.documentElement.scrollHeight - 160;
  const toEnd = () => scrollTo(0, document.documentElement.scrollHeight);

  function draw() {
    let day = '';
    const lastMine = [...messages].reverse().find((m) => m.mine);
    list.innerHTML = messages
      .map((m) => {
        const date = dateText(m.at);
        const divider = date === day ? '' : `<p class="day">${esc(date)}</p>`;
        day = date;
        const state = m === lastMine ? `, ${t(m.id <= read ? 'read' : 'sent').toLowerCase()}` : '';
        return `${divider}<div class="msg${m.mine ? ' mine' : ''}"><p>${esc(m.text)}</p><small>${esc(timeText(m.at) + state)}</small></div>`;
      })
      .join('');
  }

  function drawReview() {
    const box = $('.chat-review', root);
    box.innerHTML = chat.canReview
      ? `<button class="link-btn">${icon('star')}${esc(t(chat.review ? 'reviewWrite' : 'leaveReview'))}</button>`
      : '';
    $('button', box)?.addEventListener('click', () => {
      const s = sheet('', { title: chat.other });
      reviewForm(s.body, {
        path: `/chats/${id}/review`,
        review: chat.review,
        onDone: () => {
          s.close();
          poll();
        },
      });
    });
  }

  function add(fresh) {
    const known = new Set(messages.map((m) => m.id));
    const added = fresh.filter((m) => !known.has(m.id));
    messages = [...messages, ...added].sort((a, b) => a.id - b.id);
    return added.length;
  }

  draw();
  drawReview();
  // Роутер после отрисовки прокручивает наверх, поэтому к последнему сообщению переходим кадром позже.
  requestAnimationFrame(() => alive() && toEnd());
  refreshUnread();

  let timer;
  let busy = false;
  onLeave(() => clearTimeout(timer));

  async function poll() {
    clearTimeout(timer);
    if (!alive()) return;
    if (!busy && document.visibilityState === 'visible') {
      busy = true;
      try {
        // Только чужие сообщения двигают отметку: своё, ушедшее между опросами, не должно скрыть ответ.
        const after = messages.findLast((m) => !m.mine)?.id || 0;
        const next = await api(`/chats/${id}?after=${after}`);
        if (!alive()) return;
        const stick = nearEnd();
        const added = add(next.messages);
        const changed = added || next.read !== read;
        read = next.read;
        const reviewChanged = JSON.stringify([next.chat.canReview, next.chat.review]) !== JSON.stringify([chat.canReview, chat.review]);
        chat = next.chat;
        if (changed) draw();
        if (reviewChanged) drawReview();
        if (added && stick) toEnd();
        if (added) refreshUnread();
      } catch (e) {
        if (alive() && e.code === 'login_required') return login();
      } finally {
        busy = false;
      }
    }
    if (alive()) timer = setTimeout(poll, EVERY);
  }
  timer = setTimeout(poll, EVERY);

  // Поле растёт вместе с текстом.
  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 140)}px`;
  };
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (e) => {
    // На компьютере Enter отправляет, Shift+Enter переносит строку.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const button = $('button', form);
    if (!text || button.disabled) return input.focus();
    button.disabled = true;
    try {
      const { message } = await api(`/chats/${id}`, { method: 'POST', body: { text } });
      if (!alive()) return;
      input.value = '';
      resize();
      add([message]);
      draw();
      toEnd();
      input.focus();
    } catch (err) {
      if (!alive()) return;
      if (err.code === 'login_required') return login();
      toast(errorText(err));
    }
    button.disabled = false;
  });
}
