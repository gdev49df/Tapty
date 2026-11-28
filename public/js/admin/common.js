// Общее для разделов модерации: доступ к серверу, подписи, подтверждения и выбор причины.
import { api, apiBlob } from '../api.js';
import { icon } from '../icons.js';
import { CATEGORIES, CITIES } from '../catalog.js';
import { $, $$, errorText, esc, sheet, toast } from '../ui.js';

// Ключ и пропуск живут только в этой вкладке и пропадают с перезагрузкой.
export const access = { key: '', pass: '' };
const headers = () => ({ 'x-admin-key': encodeURIComponent(access.key), ...(access.pass && { 'x-admin-pass': access.pass }) });

// Пропуск живёт 12 часов: когда он выйдет, модерация снова спросит код.
const watch = (e) => {
  if (e.code === 'code_required') dispatchEvent(new Event('tapty:admin-code'));
  throw e;
};
export const send = (path, { method = 'GET', body } = {}) => api(`/admin${path}`, { method, body, headers: headers() }).catch(watch);
export const sendFile = (path) => apiBlob(`/admin${path}`, { headers: headers() });
export const openSession = (code) => api('/admin/session', { method: 'POST', body: { code }, headers: headers() });

const MESSAGES = {
  forbidden: 'Неверный ключ',
  not_found: 'Не найдено. Возможно, это уже удалили',
  bad_totp: 'Код не подошёл. Дождитесь следующего и введите его',
  totp_config: 'Секрет ADMIN_TOTP записан неверно',
  shop_changed: 'Заявку успели изменить, список обновлён',
  invalid: 'Проверьте заполнение',
};
export const problem = (e) => MESSAGES[e.code] || errorText(e);

// Кнопка на время запроса отключается, ошибка показывается всплывающей строкой.
export async function run(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (e) {
    toast(problem(e));
  } finally {
    button.disabled = false;
  }
}

// Опасные действия — по второму нажатию.
export function sure(button) {
  if (button.dataset.sure) return true;
  const text = button.innerHTML;
  button.dataset.sure = '1';
  button.textContent = 'Точно?';
  setTimeout(() => {
    delete button.dataset.sure;
    button.innerHTML = text;
  }, 4000);
  return false;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const two = (n) => String(n).padStart(2, '0');
// время Астаны, где бы ни находился модератор
const local = (seconds) => new Date((seconds + 5 * 3600) * 1000);
export const dayText = (seconds) => {
  const d = local(seconds);
  const year = d.getUTCFullYear() === local(Date.now() / 1000).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
};
export const timeAt = (seconds) => `${dayText(seconds)}, ${two(local(seconds).getUTCHours())}:${two(local(seconds).getUTCMinutes())}`;
// «2026-11-28» из статистики
export const isoDay = (iso) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
export const untilText = (until) => (until ? `до ${timeAt(until)}` : 'навсегда');

export const REPORTS = {
  fraud: 'Мошенничество', banned: 'Запрещённый товар', sold: 'Уже продано', wrong: 'Неверные данные',
  spam: 'Спам', insult: 'Оскорбления', other: 'Другое',
};
export const reasonList = (reasons) =>
  Object.entries(reasons).map(([key, n]) => `${REPORTS[key] || key}${n > 1 ? ` ×${n}` : ''}`).join(', ');

export const cityRu = (id) => CITIES.find((c) => c.id === id)?.ru || '';
export const categoryRu = (id) => CATEGORIES.find((c) => c.id === id)?.ru || '';

export const badge = (text, tone = '') => `<span class="adm-badge ${tone}">${esc(text)}</span>`;
const STATUS = { active: ['Активно', 'ok'], sold: ['Продано', ''], expired: ['Срок вышел', ''], hidden: ['Скрыто', 'bad'] };
export const statusBadge = (status) => badge(...(STATUS[status] || [status]));

export const thumb = (photo, fallback = 'camera') =>
  `<span class="adm-thumb">${photo ? `<img src="/p/${photo}/t" alt="" loading="lazy">` : icon(fallback)}</span>`;

export const empty = (text) => `<p class="adm-empty">${esc(text)}</p>`;
export const loading = '<p class="adm-empty">Загрузка…</p>';

// Ошибка вместо содержимого раздела или карточки, с кнопкой «Повторить».
export function failed(box, e, again) {
  box.innerHTML = `<div class="adm-empty"><p>${esc(problem(e))}</p><button type="button" class="btn small ghost" data-again>Повторить</button></div>`;
  $('[data-again]', box).onclick = again;
}

// Переключатель видов внутри раздела.
export const segments = (items, current) =>
  `<div class="adm-seg" role="group" aria-label="Вид списка">${items
    .map(
      ([id, name, count]) =>
        `<button type="button" data-view="${id}" aria-pressed="${id === current}">${esc(name)}${count ? ` <b>${count}</b>` : ''}</button>`
    )
    .join('')}</div>`;

// Все выделения стоп-слов: слово подсвечивается с начала и до конца, «ё» равна «е».
export function marked(text, words) {
  if (!words.length) return esc(text);
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]').replace(/ /g, '\\s+'))
    .join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])((?:${pattern})[\\p{L}\\p{N}]*)`, 'giu');
  // найденное оказывается на нечётных местах
  return String(text)
    .split(re)
    .map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)))
    .join('');
}

const DAYS = [[1, '1 день'], [7, '7 дней'], [30, '30 дней'], [0, 'Навсегда']];
export const banBlock = (id, banned) => `
  <div class="adm-ban">
    <h3>${banned ? 'Изменить срок блокировки' : 'Заблокировать пользователя'}</h3>
    <div class="adm-buttons">${DAYS.map(
      ([days, name]) => `<button type="button" class="btn small ghost warn" data-ban="${days}" data-user="${esc(id)}">${name}</button>`
    ).join('')}</div>
  </div>`;

// Нажатие на кнопку блокировки. true — это была она.
export function banClick(e, done) {
  const button = e.target.closest('[data-ban]');
  if (!button) return false;
  if (!sure(button)) return true;
  run(button, async () => {
    await send(`/users/${button.dataset.user}`, { method: 'POST', body: { action: 'ban', days: Number(button.dataset.ban) } });
    toast('Пользователь заблокирован');
    done();
  });
  return true;
}

// Причина, которую увидит пользователь: готовая или своя. null — передумали.
export function askReason({ title, presets, confirm }) {
  return new Promise((resolve) => {
    let reason = null;
    const s = sheet(
      `<div class="adm-presets">${presets.map((p) => `<button type="button" class="chip" aria-pressed="false">${esc(p)}</button>`).join('')}</div>
       <label class="field"><span>Причина, её увидит пользователь</span><textarea class="input" maxlength="200" rows="2"></textarea></label>
       <button type="button" class="btn wide" data-ok>${esc(confirm)}</button>`,
      { title, onClose: () => resolve(reason) }
    );
    const field = $('textarea', s.body);
    const mark = () => $$('.chip', s.body).forEach((c) => c.setAttribute('aria-pressed', c.textContent === field.value));
    field.oninput = mark;
    s.body.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        field.value = chip.textContent;
        mark();
      }
      if (!e.target.closest('[data-ok]')) return;
      if (!field.value.trim()) {
        field.focus();
        return toast('Выберите или напишите причину');
      }
      reason = field.value.trim();
      s.close();
    });
  });
}
