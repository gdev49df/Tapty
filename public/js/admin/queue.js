// Очередь жалоб: объявления и переписки одним списком, самые срочные сверху.
import { $, $$, esc, priceText, toast } from '../ui.js';
import { badge, banBlock, banClick, dayText, empty, reasonList, run, send, sendFile, thumb } from './common.js';
import { showListing } from './listings.js';
import { showUser } from './users.js';

const LEVELS = { high: ['Срочно', 'bad'], middle: ['Важно', 'warn'], low: ['Обычная', ''] };
const level = (item) => badge(...LEVELS[item.level]);

export default async function queue(ctx) {
  const { items } = await send('/queue');
  if (!ctx.alive()) return;
  ctx.counts().catch(() => {});
  if (!items.length) {
    ctx.box.innerHTML = empty('Жалоб нет. Всё разобрано.');
    return;
  }
  ctx.box.innerHTML = `<ul class="adm-list">${items
    .map((item, i) => {
      const chat = item.type === 'chat';
      return `<li><button type="button" class="adm-row" data-open="${i}" data-key="${item.type}-${item.id}">
        ${thumb(chat ? null : item.photo, chat ? 'chat' : 'camera')}
        <span class="adm-row-text">
          <strong>${esc(chat ? `Жалоба на пользователя ${item.accused}` : item.title)}</strong>
          <span>${esc(reasonList(item.reasons) || 'Ждёт проверки')}</span>
          <small>${chat ? `Переписка, от пользователя ${esc(item.author)}` : 'Объявление'}, с ${dayText(item.at)}${item.hidden ? '. Скрыто после жалоб' : ''}</small>
        </span>
        ${level(item)}
      </button></li>`;
    })
    .join('')}</ul>`;
  $$('[data-open]', ctx.box).forEach((row) => {
    row.onclick = () => {
      const item = items[row.dataset.open];
      ctx.select(row.dataset.key);
      if (item.type === 'chat') showChat(ctx, item);
      else showListing(ctx, item.id);
    };
  });
}

function showChat(ctx, c) {
  const { body } = ctx.panel.show('Жалоба из чата');
  body.innerHTML = `
    <div class="adm-badges">${level(c)}${c.banned ? badge('Уже заблокирован', 'bad') : ''}</div>
    <dl class="adm-facts">
      <div><dt>На кого</dt><dd>${esc(c.accused)}</dd></div>
      <div><dt>От кого</dt><dd>${esc(c.author)}</dd></div>
      <div><dt>Причина</dt><dd>${esc(reasonList(c.reasons))}</dd></div>
      <div><dt>Объявление</dt><dd>${esc(c.title)}</dd></div>
    </dl>
    ${c.comment ? `<blockquote class="desc">${esc(c.comment)}</blockquote>` : ''}
    <h3>Переписка</h3>
    <ul class="adm-log">${c.messages
      .map(
        (m) => `<li${m.accused ? ' class="accused"' : ''}><b>${esc(m.accused ? c.accused : c.author)}</b>${
          m.photo ? `<button type="button" class="btn small ghost" data-shot="${esc(m.photo)}">Показать фото</button>` : `<span class="desc">${esc(m.text)}</span>`
        }</li>`
      )
      .join('')}</ul>
    <div class="adm-buttons">
      <button type="button" class="btn small" data-dismiss>Отклонить жалобу</button>
      <button type="button" class="btn small ghost" data-profile>Профиль нарушителя</button>
    </div>
    ${banBlock(c.accusedId, c.banned)}`;
  body.onclick = (e) => {
    if (banClick(e, () => ctx.done())) return;
    const shot = e.target.closest('[data-shot]');
    if (shot) {
      run(shot, async () => {
        const url = URL.createObjectURL(await sendFile(`/chat-photos/${shot.dataset.shot}`));
        const img = new Image();
        img.alt = 'Фото из переписки';
        img.onload = () => URL.revokeObjectURL(url);
        img.src = url;
        shot.replaceWith(img);
      });
    }
    if (e.target.closest('[data-profile]')) showUser(ctx, c.accusedId);
    const dismiss = e.target.closest('[data-dismiss]');
    if (dismiss) {
      run(dismiss, async () => {
        await send(`/complaints/${c.id}`, { method: 'DELETE' });
        toast('Жалоба отклонена');
        ctx.done();
      });
    }
  };
}
