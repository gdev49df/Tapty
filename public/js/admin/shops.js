// Магазины: заявки с предпросмотром, открытые, закрытые и отклонённые.
import { shopCard } from '../pages/shop.js';
import { $, cardHtml, esc, phoneText, toast } from '../ui.js';
import { askReason, badge, dayText, empty, failed, loading, problem, segments, send, sure, thumb } from './common.js';
import { showUser } from './users.js';

const VIEWS = { pending: ['Заявки', 'Новых заявок нет.', 'Заявка', 'warn'], approved: ['Открытые', 'Открытых магазинов нет.', 'Открыт', 'ok'], closed: ['Закрытые', 'Закрытых магазинов нет.', 'Закрыт', 'bad'], rejected: ['Отклонённые', 'Отклонённых заявок нет.', 'Отклонён', ''] };
const REASONS = ['Название выдаёт за другой бренд', 'Описание не по теме', 'Запрещённые товары', 'Неверный телефон', 'Логотип не подходит', 'Дубликат магазина'];
const ACTIONS = {
  pending: [['approve', 'Открыть магазин', ''], ['reject', 'Отклонить', 'ghost']],
  approved: [['close', 'Закрыть магазин', 'ghost warn']],
  closed: [['reopen', 'Открыть снова', '']],
  rejected: [],
};

let view = 'pending';

export default async function shops(ctx) {
  const { items } = await send('/shops');
  if (!ctx.alive()) return;
  ctx.counts().catch(() => {});
  const shown = items.filter((s) => s.status === view);
  ctx.box.innerHTML = `
    ${segments(Object.entries(VIEWS).map(([id, [name]]) => [id, name, id === 'pending' ? items.filter((s) => s.status === id).length : 0]), view)}
    ${
      shown.length
        ? `<ul class="adm-list">${shown
            .map(
              (s) => `<li><button type="button" class="adm-row" data-open="${s.id}" data-key="shop-${s.id}">
                ${thumb(s.logo, 'store')}
                <span class="adm-row-text"><strong>${esc(s.name)}</strong><span>${esc(s.person || '')}, объявлений: ${s.ads}</span>
                  <small>${s.status === 'pending' ? `Подана ${dayText(s.since)}` : esc(s.note)}</small></span>
                ${badge(...VIEWS[s.status].slice(2))}
              </button></li>`
            )
            .join('')}</ul>`
        : empty(VIEWS[view][1])
    }`;
  ctx.box.onclick = (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) {
      view = tab.dataset.view;
      return ctx.reload();
    }
    const open = e.target.closest('[data-open]');
    if (!open) return;
    ctx.select(open.dataset.key);
    showShop(ctx, Number(open.dataset.open));
  };
}

async function showShop(ctx, id) {
  const panel = ctx.panel.show('Магазин');
  panel.body.innerHTML = loading;
  let data;
  try {
    data = await send(`/shops/${id}`);
  } catch (e) {
    if (panel.alive()) failed(panel.body, e, () => showShop(ctx, id));
    return;
  }
  if (!panel.alive()) return;
  const { shop, seller, items } = data;
  panel.body.innerHTML = `
    <dl class="adm-facts">
      <div><dt>Владелец</dt><dd>${esc(shop.person || '')}${shop.login ? `, логин ${esc(shop.login)}` : ''}</dd></div>
      <div><dt>Телефон</dt><dd>${esc(phoneText(shop.phone))}</dd></div>
      ${shop.note ? `<div><dt>Причина</dt><dd>${esc(shop.note)}</dd></div>` : ''}
    </dl>
    <div class="adm-buttons">
      ${ACTIONS[shop.status].map(([action, name, cls]) => `<button type="button" class="btn small ${cls}" data-act="${action}">${name}</button>`).join('')}
      <button type="button" class="btn small ghost" data-profile>Профиль владельца</button>
    </div>
    <h3>Так увидят покупатели</h3>
    <div class="adm-preview" inert>
      ${shopCard(shop, seller, items.length)}
      ${items.length ? `<div class="grid">${items.map(cardHtml).join('')}</div>` : '<p class="muted">Объявлений пока нет.</p>'}
    </div>`;
  panel.body.onclick = async (e) => {
    if (e.target.closest('[data-profile]')) return showUser(ctx, shop.owner);
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const action = button.dataset.act;
    let note = '';
    if (action === 'reject' || action === 'close') {
      note = await askReason({
        title: action === 'reject' ? 'Отклонить заявку' : 'Закрыть магазин',
        presets: REASONS,
        confirm: action === 'reject' ? 'Отклонить' : 'Закрыть',
      });
      if (note === null) return;
    } else if (action === 'reopen' && !sure(button)) return;
    button.disabled = true;
    try {
      await send(`/shops/${id}`, { method: 'POST', body: { action, note, rev: shop.rev } });
      toast({ approve: 'Магазин открыт', reject: 'Заявка отклонена', close: 'Магазин закрыт', reopen: 'Магазин снова открыт' }[action]);
      ctx.done();
    } catch (err) {
      button.disabled = false;
      toast(problem(err));
      // заявку успели изменить или удалить: показываем, как она выглядит сейчас
      if (['shop_changed', 'not_found'].includes(err.code)) ctx.done();
    }
  };
}
