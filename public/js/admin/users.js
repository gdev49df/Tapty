// Аккаунты: имя, новый резервный код, выход на всех устройствах, блокировка на срок и удаление.
import { icon } from '../icons.js';
import { $, copyText, esc, phoneText, priceText, toast } from '../ui.js';
import { badge, banBlock, banClick, dayText, empty, failed, loading, run, segments, send, statusBadge, sure, thumb, untilText } from './common.js';
import { hiddenActions, quickClick, showListing, unseen } from './listings.js';

const SHOPS = { pending: 'заявка на проверке', approved: 'открыт', closed: 'закрыт', rejected: 'отклонён' };

let view = 'all';

const manage = (id) => `<button type="button" class="btn small ghost" data-open="${esc(id)}">Управлять</button>`;

const everyone = (u) => `
  <tr data-key="user-${esc(u.id)}">
    <td class="main"><button type="button" class="adm-open" data-open="${esc(u.id)}"><span><strong>${esc(u.name)}</strong><small>${esc(u.login)}</small></span></button></td>
    <td data-label="С нами с">${dayText(u.since)}</td>
    <td data-label="Объявлений">${u.ads}</td>
    <td data-label="Входов">${u.sessions}</td>
    <td class="state">${
      u.banned || u.hidden
        ? `<div class="adm-badges">${u.banned ? badge(`Заблокирован ${untilText(u.until)}`, 'bad') : ''}${
            u.hidden ? badge(`Скрытых: ${u.hidden}`, 'bad') : ''
          }</div>`
        : ''
    }</td>
    <td class="act">${manage(u.id)}</td>
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
    <td class="act"><div class="adm-buttons"><button type="button" class="btn small ghost" data-unban="${esc(u.id)}">Разблокировать</button>${manage(u.id)}</div></td>
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
        ? `<table class="adm-table people${banned ? ' banned' : ''}">
             <thead><tr>${(banned ? ['Кто', 'Номера', 'Заблокирован', 'Срок', ''] : ['Пользователь', 'С нами с', 'Объявлений', 'Входов', '', ''])
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
    if (unbanClick(ctx, e)) return;
    // карточка открывается кнопкой и нажатием на любое место строки
    const id =
      e.target.closest('[data-open]')?.dataset.open ??
      (!e.target.closest('button, a') && e.target.closest('tbody tr')?.dataset.key.slice('user-'.length));
    if (id) {
      ctx.select(`user-${id}`);
      return showUser(ctx, id);
    }
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
  // вход по логину есть только у настоящего аккаунта: объявления могли подать и без него
  const registered = Boolean(user.login);
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
    ${user.banned ? `<div class="adm-buttons"><button type="button" class="btn small" data-unban="${esc(id)}">Разблокировать</button></div>` : ''}
    ${
      registered
        ? `<div class="adm-block">
             <h3>Аккаунт</h3>
             <form class="adm-inline" data-rename>
               <label class="field"><span>Имя</span><input class="input" name="name" value="${esc(user.name)}" minlength="2" maxlength="40" autocomplete="off" required></label>
               <button class="btn small ghost">Сохранить имя</button>
             </form>
             <div class="adm-buttons">
               <button type="button" class="btn small ghost" data-code>Новый резервный код</button>
               ${user.sessions ? '<button type="button" class="btn small ghost" data-logout>Выйти на всех устройствах</button>' : ''}
             </div>
             <p class="muted small">Код нужен тому, кто забыл пароль. Выдавайте его, только убедившись, что пишет владелец: с кодом можно сменить пароль и войти.</p>
             <div data-shown></div>
           </div>`
        : ''
    }
    ${account ? banBlock(id, user.banned) : ''}
    ${
      items.length
        ? `<h3>Объявления: ${items.length}</h3><ul class="adm-list">${items
            .map(
              (i) => `<li><button type="button" class="adm-row" data-item="${i.id}">${thumb(i.photo)}
                <span class="adm-row-text"><strong>${esc(i.title)}</strong><span>${esc(priceText(i))}</span>${
                  i.hideReason ? `<small>${esc(i.hideReason)}</small>` : ''
                }</span>${statusBadge(i.status)}</button>${unseen(i) ? hiddenActions(i, user.banned) : ''}</li>`
            )
            .join('')}</ul>`
        : ''
    }
    ${
      registered
        ? `<form class="adm-block" data-erase>
             <h3>Удалить аккаунт</h3>
             <p class="muted small">Сотрёт объявления, магазин, фото, переписку и отзывы. Вернуть будет нельзя.${user.banned ? ' Блокировка останется.' : ''}</p>
             <label class="field"><span>Для подтверждения введите логин: <b>${esc(user.login)}</b></span><input class="input" name="login" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
             <div class="adm-buttons"><button class="btn small danger" disabled>Удалить аккаунт</button></div>
           </form>`
        : ''
    }`;
  const act = (body) => send(`/users/${id}`, { method: 'POST', body });
  // после изменения список обновляется, а карточка открывается снова
  const again = () => {
    ctx.done();
    showUser(ctx, id);
  };
  const rename = $('[data-rename]', panel.body);
  const erase = $('[data-erase]', panel.body);
  if (registered) {
    rename.onsubmit = (e) => {
      e.preventDefault();
      run($('button', rename), async () => {
        await act({ action: 'rename', name: rename.elements.name.value });
        toast('Имя изменено');
        again();
      });
    };
    const field = erase.elements.login;
    const button = $('button', erase);
    const matches = () => field.value.trim().toLowerCase() === user.login;
    field.oninput = () => (button.disabled = !matches());
    erase.onsubmit = (e) => {
      e.preventDefault();
      if (!matches()) return;
      run(button, async () => {
        await act({ action: 'delete', login: field.value });
        toast('Аккаунт удалён');
        ctx.done();
      });
    };
  }
  panel.body.onclick = (e) => {
    if (banClick(e, () => ctx.done())) return;
    if (unbanClick(ctx, e)) return;
    // от владельца без аккаунта после удаления последнего объявления ничего не остаётся
    if (quickClick(e, registered || user.banned || items.length > 1 ? again : () => ctx.done())) return;
    const item = e.target.closest('[data-item]');
    if (item) return showListing(ctx, Number(item.dataset.item));
    const logout = e.target.closest('[data-logout]');
    if (logout && sure(logout)) {
      run(logout, async () => {
        const { ended } = await act({ action: 'logout' });
        toast(`Завершено входов: ${ended}`);
        again();
      });
    }
    const code = e.target.closest('[data-code]');
    if (code && sure(code)) {
      run(code, async () => {
        const issued = await act({ action: 'code' });
        if (!panel.alive()) return;
        const box = $('[data-shown]', panel.body);
        box.innerHTML = `
          <p>Передайте код владельцу. Он открывает вход, «Забыли пароль?», вводит логин <b>${esc(user.login)}</b>, этот код и новый пароль. Прежний код больше не действует.</p>
          <code class="backup-code">${esc(issued.code)}</code>
          <div class="adm-buttons"><button type="button" class="btn small ghost" data-copy="${esc(issued.code)}">${icon('copy')}Скопировать</button></div>
          <p class="muted small">Код виден только сейчас.</p>`;
        box.scrollIntoView({ block: 'nearest' });
      });
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) copyText(copy.dataset.copy, 'Скопировано');
  };
}
