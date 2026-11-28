// Пользователи: новые и заблокированные, блокировка на срок, выход на всех устройствах.
import { $, esc, phoneText, priceText, toast } from '../ui.js';
import { badge, banBlock, banClick, dayText, empty, failed, loading, run, segments, send, statusBadge, sure, thumb, untilText } from './common.js';
import { showListing } from './listings.js';

const SHOPS = { pending: 'заявка на проверке', approved: 'открыт', closed: 'закрыт', rejected: 'отклонён' };

let view = 'all';

const everyone = (u) => `
  <tr data-key="user-${esc(u.id)}">
    <td class="main"><button type="button" class="adm-open" data-open="${esc(u.id)}"><span><strong>${esc(u.name)}</strong><small>${esc(u.login)}</small></span></button></td>
    <td data-label="С нами с">${dayText(u.since)}</td>
    <td data-label="Объявлений">${u.ads}</td>
    <td data-label="Входов">${u.sessions}</td>
    <td class="state">${u.banned ? badge(`Заблокирован ${untilText(u.until)}`, 'bad') : ''}</td>
  </tr>`;

const title = (u) => u.name || (u.id.includes(':') ? 'Без имени' : phoneText(u.id));

const blocked = (u) => `
  <tr data-key="user-${esc(u.id)}">
    <td class="main"><button type="button" class="adm-open" data-open="${esc(u.id)}"><span><strong>${esc(title(u))}</strong><small>${esc(
      u.login || (u.id.startsWith('d:') ? 'без аккаунта' : u.id.startsWith('u:') ? 'аккаунт удалён' : 'только номер')
    )}</small></span></button></td>
    <td data-label="Номера">${u.phones.map((p) => esc(phoneText(p))).join('<br>') || '—'}</td>
    <td data-label="Заблокирован">${dayText(u.at)}</td>
    <td data-label="Срок">${untilText(u.until)}</td>
    <td class="state"><button type="button" class="btn small ghost" data-unban="${esc(u.id)}">Разблокировать</button></td>
  </tr>`;

export default async function users(ctx) {
  const current = view;
  const [data, counts] = await Promise.all([send(`/users?view=${current}`), ctx.counts()]);
  if (!ctx.alive() || view !== current) return;
  const banned = current === 'banned';
  let next = data.next;
  ctx.box.innerHTML = `
    ${segments([['all', 'Все'], ['banned', 'Заблокированные', counts.users]], view)}
    ${
      data.items.length
        ? `<table class="adm-table">
             <thead><tr>${(banned ? ['Кто', 'Номера', 'Заблокирован', 'Срок', ''] : ['Пользователь', 'С нами с', 'Объявлений', 'Входов', ''])
               .map((h) => `<th>${h}</th>`)
               .join('')}</tr></thead>
             <tbody>${data.items.map(banned ? blocked : everyone).join('')}</tbody>
           </table>
           <button type="button" class="btn small ghost adm-more" data-more${next === null ? ' hidden' : ''}>Показать ещё</button>`
        : empty(banned ? 'Заблокированных нет.' : 'Пользователей пока нет.')
    }`;
  ctx.box.onclick = (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) {
      view = tab.dataset.view;
      return ctx.reload();
    }
    const open = e.target.closest('[data-open]');
    if (open) {
      ctx.select(`user-${open.dataset.open}`);
      return showUser(ctx, open.dataset.open);
    }
    if (unbanClick(ctx, e)) return;
    const more = e.target.closest('[data-more]');
    if (more) {
      run(more, async () => {
        const page = await send(`/users?view=all&offset=${next}`);
        if (!ctx.alive()) return;
        const fresh = page.items.filter((u) => !$(`tr[data-key="user-${u.id}"]`, ctx.box));
        $('tbody', ctx.box).insertAdjacentHTML('beforeend', fresh.map(everyone).join(''));
        next = page.next;
        more.hidden = next === null;
      });
    }
  };
}

function unbanClick(ctx, e) {
  const button = e.target.closest('[data-unban]');
  if (!button) return false;
  if (sure(button)) {
    run(button, async () => {
      await send(`/users/${button.dataset.unban}`, { method: 'POST', body: { action: 'unban' } });
      toast('Блокировка снята');
      ctx.done();
    });
  }
  return true;
}

export async function showUser(ctx, id) {
  const panel = ctx.panel.show('Пользователь');
  panel.body.innerHTML = loading;
  let data;
  try {
    data = await send(`/users/${id}`);
  } catch (e) {
    if (panel.alive()) failed(panel.body, e, () => showUser(ctx, id));
    return;
  }
  if (!panel.alive()) return;
  const { user, shop, phones, items } = data;
  const account = id.includes(':');
  panel.body.innerHTML = `
    <h3 class="adm-title">${esc(title({ ...user, id }))}</h3>
    <div class="adm-badges">${user.banned ? badge(`Заблокирован ${untilText(user.until)}`, 'bad') : badge('Не заблокирован', 'ok')}</div>
    <dl class="adm-facts">
      ${user.login ? `<div><dt>Логин</dt><dd>${esc(user.login)}</dd></div>` : ''}
      ${user.since ? `<div><dt>С нами с</dt><dd>${dayText(user.since)}</dd></div>` : ''}
      ${phones.length ? `<div><dt>Номера</dt><dd>${phones.map((p) => esc(phoneText(p))).join('<br>')}</dd></div>` : ''}
      ${user.login ? `<div><dt>Входов на устройствах</dt><dd>${user.sessions}</dd></div>` : ''}
      ${shop ? `<div><dt>Магазин</dt><dd>${esc(shop.name)}, ${SHOPS[shop.status]}</dd></div>` : ''}
    </dl>
    <div class="adm-buttons">
      ${user.banned ? `<button type="button" class="btn small" data-unban="${esc(id)}">Разблокировать</button>` : ''}
      ${user.sessions ? '<button type="button" class="btn small ghost" data-logout>Выйти на всех устройствах</button>' : ''}
    </div>
    ${account ? banBlock(id, user.banned) : ''}
    ${
      items.length
        ? `<h3>Объявления: ${items.length}</h3><ul class="adm-list">${items
            .map(
              (i) => `<li><button type="button" class="adm-row" data-item="${i.id}">${thumb(i.photo)}
                <span class="adm-row-text"><strong>${esc(i.title)}</strong><span>${esc(priceText(i))}</span>${
                  i.hideReason ? `<small>${esc(i.hideReason)}</small>` : ''
                }</span>${statusBadge(i.status)}</button></li>`
            )
            .join('')}</ul>`
        : ''
    }`;
  panel.body.onclick = (e) => {
    if (banClick(e, () => ctx.done())) return;
    if (unbanClick(ctx, e)) return;
    const item = e.target.closest('[data-item]');
    if (item) return showListing(ctx, Number(item.dataset.item));
    const logout = e.target.closest('[data-logout]');
    if (logout && sure(logout)) {
      run(logout, async () => {
        const { ended } = await send(`/users/${id}`, { method: 'POST', body: { action: 'logout' } });
        toast(`Завершено входов: ${ended}`);
        ctx.done();
      });
    }
  };
}
