// Объявления: подозрительные по стоп-словам, скрытые и все. Действия — по одному и сразу над многими.
import { icon } from '../icons.js';
import { openViewer } from '../viewer.js';
import { $, $$, esc, phoneText, priceText, toast } from '../ui.js';
import {
  askReason, badge, banBlock, banClick, categoryRu, cityRu, dayText, empty, failed, loading, marked, reasonList, run, segments, send,
  statusBadge, sure, thumb, untilText,
} from './common.js';
import { showUser } from './users.js';

const REASONS = ['Запрещённый товар', 'Похоже на мошенничество', 'Неверная категория', 'Повторное объявление', 'Оскорбления или спам', 'Неверная цена или описание'];
const EMPTY = { flagged: 'Подозрительных объявлений нет.', hidden: 'Скрытых объявлений нет.', all: 'Объявлений пока нет.' };
const DONE = { hide: 'Скрыто', show: 'Одобрено', delete: 'Удалено' };
// Скрыто модератором или сайтом либо ждёт проверки — на сайте этого никто не видит.
export const unseen = (item) => item.status === 'hidden' || item.status === 'review';
// проданное возвращается проданным, поэтому и кнопка называет это прямо
export const backText = ({ status, before }) =>
  before === 'sold' ? 'Вернуть как проданное' : status === 'review' ? 'Одобрить' : 'Вернуть в ленту';

let view = '';

// Выполняет действие над объявлениями. false — передумали на выборе причины.
export async function moderate(ids, action) {
  let reason = '';
  if (action === 'hide') {
    reason = await askReason({
      title: ids.length > 1 ? `Скрыть объявления: ${ids.length}` : 'Скрыть объявление',
      presets: REASONS,
      confirm: 'Скрыть',
    });
    if (reason === null) return false;
  }
  const { done, skipped } = await send('/listings', { method: 'POST', body: { ids, action, reason } });
  toast(`${DONE[action]}: ${done}${skipped ? `. Пропущено: ${skipped}, их автор заблокирован или они уже удалены` : ''}`);
  return true;
}

// Кнопки прямо под пометкой «Скрыто» или «На проверке»: решить, не открывая объявление.
export const hiddenActions = (item, banned) => `
  <div class="adm-buttons adm-acts">${
    banned ? '' : `<button type="button" class="btn small" data-quick="show" data-id="${item.id}">${backText(item)}</button>`
  }<button type="button" class="btn small ghost warn" data-quick="delete" data-id="${item.id}">Удалить</button></div>`;

// Нажатие на одну из этих кнопок. true — это была она.
export function quickClick(e, done) {
  const button = e.target.closest('[data-quick]');
  if (!button) return false;
  const action = button.dataset.quick;
  if (action === 'delete' && !sure(button)) return true;
  run(button, async () => (await moderate([Number(button.dataset.id)], action)) && done());
  return true;
}

const line = (item) => `
  <tr data-key="listing-${item.id}">
    <td class="pick"><label><input type="checkbox" value="${item.id}" aria-label="Выбрать: ${esc(item.title)}"></label></td>
    <td class="main"><button type="button" class="adm-open" data-open="${item.id}">${thumb(item.photo)}
      <span><strong>${marked(item.title, item.flags)}</strong><small>${esc(priceText(item))}</small></span></button></td>
    <td data-label="Продавец">${esc(item.person)}${item.login ? `<small>${esc(item.login)}</small>` : ''}</td>
    <td data-label="Подано">${dayText(item.createdAt)}<small>${esc(cityRu(item.city))}</small></td>
    <td class="state"><div class="adm-badges">${statusBadge(item.status)}${item.reports ? badge(`Жалоб: ${item.reports}`, 'warn') : ''}${item.flags
      .map((w) => badge(w, 'mark'))
      .join('')}</div>${item.hideReason ? `<small>${esc(item.hideReason)}</small>` : ''}${
      unseen(item) ? hiddenActions(item, item.banned) : ''
    }</td>
  </tr>`;

export default async function listings(ctx) {
  const counts = await ctx.counts();
  if (!ctx.alive()) return;
  view ||= counts.listings ? 'flagged' : 'all';
  const current = view;
  const data = await send(`/listings?view=${current}`);
  if (!ctx.alive() || view !== current) return;
  let next = data.next;
  ctx.box.innerHTML = `
    ${segments([['flagged', 'Под вопросом', counts.listings], ['hidden', 'Скрытые', counts.hidden], ['all', 'Все']], view)}
    ${current === 'flagged' ? '<p class="muted small">В тексте есть стоп-слова. «На проверке» ещё не опубликованы, остальные уже в ленте. «Одобрить» публикует и убирает отсюда. Список слов меняется в настройках.</p>' : ''}
    ${
      data.items.length
        ? `<div class="adm-bulk" hidden>
             <b></b>
             <button type="button" class="btn small" data-bulk="show">${current === 'hidden' ? 'Вернуть' : 'Одобрить'}</button>
             ${current === 'hidden' ? '' : '<button type="button" class="btn small ghost" data-bulk="hide">Скрыть</button>'}
             <button type="button" class="btn small danger" data-bulk="delete">Удалить</button>
           </div>
           <table class="adm-table">
             <thead><tr><th class="pick"><label><input type="checkbox" data-every><span>Выбрать все</span></label></th><th>Объявление</th><th>Продавец</th><th>Подано</th><th>Состояние</th></tr></thead>
             <tbody>${data.items.map(line).join('')}</tbody>
           </table>
           <button type="button" class="btn small ghost adm-more" data-more${next === null ? ' hidden' : ''}>Показать ещё</button>`
        : empty(EMPTY[current])
    }`;
  ctx.box.onclick = (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) {
      view = tab.dataset.view;
      return ctx.reload();
    }
    const open = e.target.closest('[data-open]');
    if (open) {
      ctx.select(`listing-${open.dataset.open}`);
      return showListing(ctx, Number(open.dataset.open));
    }
    if (quickClick(e, () => ctx.done())) return;
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const action = bulk.dataset.bulk;
      if (action === 'delete' && !sure(bulk)) return;
      const ids = chosen();
      // за один раз сервер принимает не больше пятидесяти
      if (ids.length > 50) return toast('Выберите не больше 50 объявлений');
      return run(bulk, async () => (await moderate(ids, action)) && ctx.done());
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      run(more, async () => {
        const page = await send(`/listings?view=${current}&offset=${next}`);
        if (!ctx.alive()) return;
        // пока смотрели, могли подать новые: уже показанные не повторяются
        const fresh = page.items.filter((i) => !$(`tr[data-key="listing-${i.id}"]`, ctx.box));
        $('tbody', ctx.box).insertAdjacentHTML('beforeend', fresh.map(line).join(''));
        next = page.next;
        more.hidden = next === null;
        tally();
      });
    }
  };
  const boxes = () => $$('tbody input[type="checkbox"]', ctx.box);
  const chosen = () => boxes().filter((b) => b.checked).map((b) => Number(b.value));
  function tally() {
    const bar = $('.adm-bulk', ctx.box);
    if (!bar) return;
    const n = chosen().length;
    bar.hidden = !n;
    $('b', bar).textContent = `Выбрано: ${n}`;
    const every = $('[data-every]', ctx.box);
    every.checked = n > 0 && n === boxes().length;
    every.indeterminate = n > 0 && n < boxes().length;
  }
  ctx.box.onchange = (e) => {
    if (e.target.matches('[data-every]')) boxes().forEach((b) => (b.checked = e.target.checked));
    tally();
  };
}

export async function showListing(ctx, id) {
  const panel = ctx.panel.show('Объявление');
  panel.body.innerHTML = loading;
  let data;
  try {
    data = await send(`/listings/${id}`);
  } catch (e) {
    if (panel.alive()) failed(panel.body, e, () => showListing(ctx, id));
    return;
  }
  if (!panel.alive()) return;
  const { item, reasons, flags, author } = data;
  const hidden = unseen(item);
  const waiting = Object.keys(reasons).length || flags.length;
  const buttons = [
    // вернуть скрытое или снять подозрения с показываемого
    !author.banned && (hidden || waiting) && `<button type="button" class="btn small" data-act="show">${hidden ? backText(item) : 'Одобрить'}</button>`,
    // у скрытого сайтом причины ещё нет: модератор может назвать её
    (item.status !== 'hidden' || !item.hideReason) && '<button type="button" class="btn small ghost" data-act="hide">Скрыть</button>',
    '<button type="button" class="btn small ghost warn" data-act="delete">Удалить</button>',
  ].filter(Boolean);
  panel.body.innerHTML = `
    ${
      item.photos.length
        ? `<div class="adm-photos">${item.photos
            .map((p, i) => `<button type="button" data-photo="${i}" aria-label="Фото ${i + 1}"><img src="/p/${p}/t" alt=""></button>`)
            .join('')}</div>`
        : ''
    }
    <div>
      <h3 class="adm-title">${marked(item.title, flags)}</h3>
      <p class="adm-price">${esc(priceText(item))}</p>
    </div>
    <div class="adm-badges">${statusBadge(item.status)}${author.banned ? badge(`Автор заблокирован ${untilText(author.until)}`, 'bad') : ''}</div>
    ${waiting ? `<dl class="adm-facts warn">
        ${Object.keys(reasons).length ? `<div><dt>Жалобы</dt><dd>${esc(reasonList(reasons))}</dd></div>` : ''}
        ${flags.length ? `<div><dt>Стоп-слова</dt><dd>${esc(flags.join(', '))}</dd></div>` : ''}
      </dl>` : ''}
    <dl class="adm-facts">
      ${item.hideReason ? `<div><dt>Причина скрытия</dt><dd>${esc(item.hideReason)}</dd></div>` : ''}
      <div><dt>Раздел</dt><dd>${esc(categoryRu(item.category))}</dd></div>
      <div><dt>Место</dt><dd>${esc([cityRu(item.city), item.district].filter(Boolean).join(', '))}</dd></div>
      <div><dt>Подано</dt><dd>${dayText(item.createdAt)}, просмотров: ${item.views}</dd></div>
      <div><dt>Продавец</dt><dd>${esc(item.name)}${author.login ? `, логин ${esc(author.login)}` : ''}</dd></div>
      <div><dt>Телефон</dt><dd>${esc(phoneText(item.phone))}</dd></div>
    </dl>
    ${item.description ? `<p class="desc">${marked(item.description, flags)}</p>` : ''}
    ${author.banned && hidden ? '<p class="muted">Объявления заблокированного вернутся сами, когда блокировка закончится или вы её снимете.</p>' : ''}
    <div class="adm-buttons">${buttons.join('')}</div>
    <div class="adm-buttons">
      <button type="button" class="btn small ghost" data-profile>${icon('user')}Профиль продавца</button>
      ${hidden ? '' : `<a class="btn small ghost" href="/item/${id}">Открыть на сайте</a>`}
    </div>
    ${banBlock(item.owner, author.banned)}`;
  panel.body.onclick = (e) => {
    if (banClick(e, () => ctx.done())) return;
    const photo = e.target.closest('[data-photo]');
    if (photo) return openViewer(item.photos, Number(photo.dataset.photo), item.title);
    if (e.target.closest('[data-profile]')) return showUser(ctx, item.owner);
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const action = button.dataset.act;
    if (action === 'delete' && !sure(button)) return;
    run(button, async () => (await moderate([id], action)) && ctx.done());
  };
}
