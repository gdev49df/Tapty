// Один диалог. Новые сообщения подтягиваются раз в несколько секунд, пока страница открыта.
import { api, apiBlob, auth } from '../api.js';
import { authForm, consentSheet } from '../auth.js';
import { CHAT_REASONS, LIMITS } from '../catalog.js';
import { compress } from '../images.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { askDeleteChat } from '../dialogs.js';
import { reviewForm } from '../reviews.js';
import { refreshUnread } from '../unread.js';
import { openViewer } from '../viewer.js';
import { canRecord, clock, createPlayer, startRecording, voiceHtml } from '../voice.js';
import { $, $$, dateText, emptyState, errorText, esc, money, priceText, priceWords, sheet, timeText, toast } from '../ui.js';

const EVERY = 4000;
const AT_ONCE = 4; // столько фото можно отправить за один раз

export default async function chatPage({ root, params, alive, back, go, rerender, onLeave }) {
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

  let { chat, read, messages, offers } = data;
  const { listing } = chat;
  const gone = listing.status === 'gone';
  const subtitle = gone ? t('listingGone') : listing.status === 'active' ? priceText(listing) : t(`st_${listing.status}`);
  const ad = `<span class="my-photo">${listing.photo ? `<img src="/p/${listing.photo}/t" alt="">` : icon('camera')}</span>
    <span><strong>${esc(listing.title)}</strong><small>${esc(subtitle)}</small></span>`;

  root.innerHTML = `
    <div class="chat">
      <div class="chat-top">
        <div class="chat-head">${head(chat.other)}<button class="icon-btn" data-more aria-label="${esc(t('chatActions'))}">${icon('more')}</button></div>
        ${gone ? `<div class="chat-ad">${ad}</div>` : `<a class="chat-ad" href="/item/${listing.id}">${ad}</a>`}
        <div class="chat-review"></div>
      </div>
      <div class="messages" role="log" aria-live="polite"></div>
      <div class="chat-closed" hidden></div>
      <form class="composer">
        <button type="button" class="attach" aria-label="${esc(t('attachPhoto'))}">${icon('camera')}</button>
        <input type="file" accept="image/*" multiple hidden>
        <textarea class="input" rows="1" maxlength="1000" enterkeyhint="send" aria-label="${esc(t('chatInput'))}" placeholder="${esc(t('chatInput'))}"></textarea>
        <button type="button" class="btn" data-mic aria-label="${esc(t('voiceRecord'))}">${icon('mic')}</button>
        <button class="btn" data-send aria-label="${esc(t('sendMessage'))}">${icon('send')}</button>
      </form>
      <div class="recorder" hidden>
        <button type="button" class="icon-btn" data-drop aria-label="${esc(t('voiceCancel'))}">${icon('trash')}</button>
        <p role="status"><i></i><span></span></p>
        <time></time>
        <button type="button" class="btn" data-voice-send aria-label="${esc(t('sendMessage'))}">${icon('send')}</button>
      </div>
    </div>`;
  $('[data-back]', root).onclick = back;
  const list = $('.messages', root);
  const form = $('.composer', root);
  const input = $('textarea', form);

  const nearEnd = () => innerHeight + scrollY > document.documentElement.scrollHeight - 160;
  const toEnd = () => scrollTo(0, document.documentElement.scrollHeight);

  // Снимки скачиваются с ключом входа и живут в памяти, пока открыт диалог.
  const pictures = new Map();
  onLeave(() => pictures.forEach((url) => url.then(URL.revokeObjectURL, () => {})));
  const picture = (photo, size = '') => {
    const name = photo + size;
    if (!pictures.has(name)) {
      const url = apiBlob(`/chats/${id}/photos/${photo}${size}`).then((blob) => URL.createObjectURL(blob));
      url.catch(() => pictures.delete(name));
      pictures.set(name, url);
    }
    return pictures.get(name);
  };

  // Предложенная цена: продавец отвечает одной кнопкой, пока объявление действует.
  function offerHtml(m) {
    const answerable = !m.mine && !chat.buying && !m.state && chat.canWrite && chat.listing.status === 'active';
    const status = { accepted: 'offerAccepted', declined: 'offerDeclined', replaced: 'offerReplaced' }[m.state] || 'offerWait';
    return `<div class="offer" data-state="${esc(m.state)}">
      <span>${esc(t('offerLabel'))}</span><strong>${esc(money(m.amount))}</strong>
      ${
        answerable
          ? `<div class="row">
              <button type="button" class="btn small ghost" data-answer="decline" data-id="${m.id}">${esc(t('decline'))}</button>
              <button type="button" class="btn small" data-answer="accept" data-id="${m.id}">${esc(t('accept'))}</button>
            </div>`
          : `<em>${esc(t(status))}</em>`
      }
    </div>`;
  }

  const bodyHtml = (m) => {
    if (m.photo) return `<button type="button" class="msg-photo" data-photo="${esc(m.photo)}" aria-label="${esc(t('openPhoto'))}"><img alt="${esc(t('photoMessage'))}"></button>`;
    if (m.voice) return voiceHtml(m);
    if (m.kind === 'offer') return offerHtml(m);
    return `<p>${esc(m.kind ? priceWords(m.kind, m.amount) : m.text)}</p>`;
  };

  function draw() {
    let day = '';
    const lastMine = [...messages].reverse().find((m) => m.mine);
    list.innerHTML = messages
      .map((m) => {
        const date = dateText(m.at);
        const divider = date === day ? '' : `<p class="day">${esc(date)}</p>`;
        day = date;
        const state = m === lastMine ? `, ${t(m.id <= read ? 'read' : 'sent').toLowerCase()}` : '';
        return `${divider}<div class="msg${m.mine ? ' mine' : ''}">${bodyHtml(m)}<small>${esc(timeText(m.at) + state)}</small></div>`;
      })
      .join('');
    player.paint();
    $$('[data-photo]', list).forEach(async (button) => {
      try {
        const url = await picture(button.dataset.photo, '/t');
        $('img', button).src = url;
      } catch {
        button.classList.add('lost');
      }
    });
  }

  list.addEventListener('click', async (e) => {
    const reply = e.target.closest('[data-answer]');
    if (reply) return answer(reply);
    const button = e.target.closest('[data-photo]');
    if (!button) return;
    try {
      const url = await picture(button.dataset.photo);
      if (alive()) openViewer([url], 0, chat.other);
    } catch (err) {
      if (alive()) toast(errorText(err));
    }
  });

  async function answer(button) {
    const buttons = $$('button', button.parentElement);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const { message } = await api(`/chats/${id}/offers/${button.dataset.id}`, { method: 'POST', body: { accept: button.dataset.answer === 'accept' } });
      if (!alive()) return;
      const offer = messages.find((m) => m.id === Number(button.dataset.id));
      if (offer) offer.state = message.kind;
      add([message]);
      draw();
      toEnd();
    } catch (err) {
      if (!alive()) return;
      if (err.code === 'login_required') return login();
      toast(errorText(err));
      buttons.forEach((b) => (b.disabled = false));
      poll();
    }
  }

  // Вместо поля ввода — объяснение, почему написать нельзя.
  function drawState() {
    const box = $('.chat-closed', root);
    box.hidden = chat.canWrite;
    if (!chat.canWrite) dropRecording();
    form.hidden = !chat.canWrite || Boolean(recording);
    box.innerHTML = chat.canWrite
      ? ''
      : `<p>${esc(t(chat.blockedByMe ? 'youBlocked' : 'err_blocked'))}</p>${
          chat.blockedByMe ? `<button type="button" class="btn ghost">${esc(t('unblock'))}</button>` : ''
        }`;
    $('button', box)?.addEventListener('click', () => block(false));
  }

  async function block(on) {
    try {
      await api(`/chats/${id}/block`, { method: on ? 'POST' : 'DELETE' });
      if (!alive()) return;
      toast(t(on ? 'blockedDone' : 'unblockedDone'));
      await poll();
    } catch (e) {
      if (alive()) toast(errorText(e));
    }
  }

  function askBlock() {
    const s = sheet(`<p>${esc(t('blockAbout'))}</p><button class="btn wide danger">${esc(t('block'))}</button>`, {
      title: `${t('block')}: ${chat.other}`,
    });
    $('button', s.body).onclick = () => {
      s.close();
      block(true);
    };
  }

  async function pin(on) {
    try {
      await api(`/chats/${id}/pin`, { method: on ? 'POST' : 'DELETE' });
      if (!alive()) return;
      chat.pinned = on;
      toast(t(on ? 'pinnedDone' : 'unpinnedDone'));
    } catch (e) {
      if (alive()) toast(errorText(e));
    }
  }

  function askComplaint() {
    const s = sheet(
      `<form class="form">
        <fieldset><legend>${esc(t('complaintWhy'))}</legend><div class="segs">${CHAT_REASONS.map(
          (r, i) => `<label class="seg"><input type="radio" name="reason" value="${r}"${i ? '' : ' checked'}><span>${esc(t(`cr_${r}`))}</span></label>`
        ).join('')}</div></fieldset>
        <label class="field"><span>${esc(t('complaintComment'))}</span><textarea class="input" name="comment" rows="3" maxlength="500"></textarea></label>
        ${chat.blockedByMe ? '' : `<label class="check"><input type="checkbox" name="block" checked><span>${esc(t('alsoBlock'))}</span></label>`}
        <p class="muted small">${esc(t('complaintNote'))}</p>
        <button class="btn wide">${esc(t('sendComplaint'))}</button>
      </form>`,
      { title: t('complain') }
    );
    const complaint = $('form', s.body);
    complaint.onsubmit = async (e) => {
      e.preventDefault();
      const { reason, comment, block: alsoBlock } = complaint.elements;
      const button = $('.btn', complaint);
      button.disabled = true;
      try {
        await api(`/chats/${id}/complaint`, {
          method: 'POST',
          body: { reason: reason.value, comment: comment.value, block: Boolean(alsoBlock?.checked) },
        });
        s.close();
        toast(t('complaintSent'));
        if (alive()) await poll();
      } catch (err) {
        button.disabled = false;
        toast(errorText(err));
      }
    };
  }

  $('[data-more]', root).onclick = () => {
    const row = (name, ic, text, red = false) =>
      `<li><button data-act="${name}"${red ? ' class="danger"' : ''}>${icon(ic)}<span>${esc(text)}</span></button></li>`;
    const s = sheet(
      `<ul class="menu">${[
        row(chat.pinned ? 'unpin' : 'pin', 'pushpin', t(chat.pinned ? 'unpinChat' : 'pinChat')),
        row('delete', 'trash', t('deleteChat')),
        row('complain', 'flag', t('complain'), true),
        chat.blockedByMe ? row('unblock', 'ban', t('unblock')) : row('block', 'ban', t('block'), true),
      ].join('')}</ul>`,
      { title: chat.other }
    );
    const actions = {
      pin: () => pin(true),
      unpin: () => pin(false),
      delete: () => askDeleteChat(id, chat.other, () => alive() && go('/chats', { replace: true })),
      complain: askComplaint,
      block: askBlock,
      unblock: () => block(false),
    };
    $$('[data-act]', s.body).forEach((b) => {
      b.onclick = () => {
        s.close();
        actions[b.dataset.act]();
      };
    });
  };

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

  const mic = $('[data-mic]', form);
  const send = $('[data-send]', form);
  const bar = $('.recorder', root);
  let recording = null; // { recorder, result }
  let starting = false;
  const player = createPlayer(list, (voice) => picture(voice), (err) => alive() && toast(err.code ? errorText(err) : t('voiceNoPlay')));
  onLeave(() => {
    player.pause();
    dropRecording();
  });

  // Пока в поле пусто, на месте отправки — микрофон.
  const chooseButton = () => {
    mic.hidden = !canRecord() || Boolean(input.value.trim());
    send.hidden = !mic.hidden;
  };

  function showRecorder(on) {
    bar.hidden = !on;
    form.hidden = on || !chat.canWrite;
  }

  function dropRecording() {
    const old = recording;
    recording = null;
    old?.recorder?.stop();
    if (old && alive()) showRecorder(false);
  }

  async function record() {
    if (starting || recording) return;
    starting = true;
    player.pause();
    const mine = { recorder: null };
    const status = (key) => ($('p span', bar).textContent = t(key));
    const time = (seconds) => ($('time', bar).textContent = `${clock(seconds)} / ${clock(LIMITS.voiceSeconds)}`);
    try {
      const recorder = await startRecording({
        onTick: (seconds) => recording === mine && time(seconds),
        onEnd: () => {
          if (recording !== mine) return;
          bar.classList.add('ready');
          status('voiceReady');
        },
      });
      // пока спрашивали разрешение, могли уйти из диалога
      if (!alive() || !chat.canWrite) return recorder.stop();
      mine.recorder = recorder;
      recording = mine;
      bar.classList.remove('ready');
      status('voiceRecording');
      time(0);
      showRecorder(true);
      $('[data-voice-send]', bar).focus({ preventScroll: true });
    } catch (e) {
      if (alive()) toast(t({ NotAllowedError: 'micDenied', SecurityError: 'micDenied', NotFoundError: 'micMissing' }[e.name] || 'voiceFailed'));
    } finally {
      starting = false;
    }
  }
  mic.onclick = () => {
    if (!chat.needConsent) return record();
    consentSheet(() => {
      chat.needConsent = false;
      record();
    });
  };
  $('[data-drop]', bar).onclick = () => {
    dropRecording();
    mic.focus({ preventScroll: true });
  };
  $('[data-voice-send]', bar).onclick = async (e) => {
    const button = e.currentTarget;
    const mine = recording;
    if (!mine || button.disabled) return;
    const drop = $('[data-drop]', bar);
    // пока запись отправляется, удалить её уже нельзя
    button.disabled = drop.disabled = true;
    try {
      const { blob, seconds } = await mine.recorder.stop();
      if (!blob.size) {
        dropRecording();
        toast(t('voiceFailed'));
      } else {
        const body = new FormData();
        body.set('voice', blob, 'voice');
        body.set('seconds', seconds);
        const { message } = await api(`/chats/${id}/voice`, { method: 'POST', body });
        if (!alive()) return;
        // своя запись уже есть в памяти
        pictures.set(message.voice, Promise.resolve(URL.createObjectURL(blob)));
        if (recording === mine) {
          recording = null;
          showRecorder(false);
        }
        add([message]);
        draw();
        toEnd();
      }
    } catch (err) {
      if (!alive()) return;
      if (err.code === 'login_required') return login();
      // запись остаётся: можно отправить ещё раз
      if (err.code === 'consent_needed') consentSheet(() => (chat.needConsent = false));
      else toast(errorText(err));
      if (err.code === 'blocked' || err.code === 'you_blocked') poll();
    } finally {
      button.disabled = drop.disabled = false;
    }
  };
  // Свернули приложение — запись останавливается, микрофон не остаётся включённым.
  const hidden = () => document.visibilityState === 'hidden' && recording?.recorder.stop();
  document.addEventListener('visibilitychange', hidden);
  onLeave(() => document.removeEventListener('visibilitychange', hidden));

  draw();
  drawReview();
  drawState();
  chooseButton();
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
        const stateChanged = next.chat.canWrite !== chat.canWrite || next.chat.blockedByMe !== chat.blockedByMe;
        // от этого зависят кнопки под предложенной ценой
        const answersChanged = next.chat.listing.status !== chat.listing.status || JSON.stringify(next.offers) !== JSON.stringify(offers);
        chat = next.chat;
        offers = next.offers;
        const states = new Map(offers.map((o) => [o.id, o.state]));
        for (const m of messages) if (states.has(m.id)) m.state = states.get(m.id);
        if (stateChanged) drawState();
        if (changed || stateChanged || answersChanged) draw();
        if (reviewChanged) drawReview();
        if (added && stick) toEnd();
        if (added) refreshUnread();
      } catch (e) {
        if (alive() && e.code === 'login_required') return login();
      } finally {
        busy = false;
      }
    }
    // опрос могли вызвать вне очереди: таймер всё равно должен остаться один
    clearTimeout(timer);
    if (alive()) timer = setTimeout(poll, EVERY);
  }
  timer = setTimeout(poll, EVERY);

  // Поле растёт вместе с текстом.
  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 140)}px`;
    chooseButton();
  };
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (e) => {
    // На компьютере Enter отправляет, Shift+Enter переносит строку.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  const attach = $('.attach', form);
  const files = $('input[type="file"]', form);
  attach.onclick = () => files.click();
  files.onchange = async () => {
    const chosen = [...files.files].slice(0, AT_ONCE);
    if (files.files.length > AT_ONCE) toast(t('photosAtOnce'));
    files.value = '';
    if (!chosen.length) return;
    attach.disabled = true;
    attach.classList.add('busy');
    for (const file of chosen) {
      if (!alive()) return;
      try {
        toast(t('photoSending'));
        const { full, thumb } = await compress(file);
        const body = new FormData();
        body.set('full', full, 'full');
        body.set('thumb', thumb, 'thumb');
        const { message } = await api(`/chats/${id}/photo`, { method: 'POST', body });
        if (!alive()) return;
        // свой снимок уже есть в памяти, скачивать его заново незачем
        pictures.set(`${message.photo}/t`, Promise.resolve(URL.createObjectURL(thumb)));
        add([message]);
        draw();
        toEnd();
      } catch (err) {
        if (!alive()) return;
        if (err.code === 'login_required') return login();
        toast(err.code ? errorText(err) : t('badPhoto'));
        break;
      }
    }
    attach.disabled = false;
    attach.classList.remove('busy');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const button = send;
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
      if (err.code === 'blocked' || err.code === 'you_blocked') poll();
    }
    button.disabled = false;
  });
}
