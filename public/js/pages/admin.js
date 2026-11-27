// Модерация: открывается по адресу /admin и ключу из секрета ADMIN_KEY.
import { api } from '../api.js';
import { $, errorText, esc, phoneText, priceText, toast } from '../ui.js';

let adminKey = '';

export default function admin({ root, alive }) {
  root.innerHTML = `
    <div class="page-head"><h1>Модерация</h1></div>
    <div class="narrow">
      <form class="form">
        <label class="field"><span>Ключ администратора</span><input class="input" type="password" autocomplete="off"></label>
        <button class="btn wide">Показать жалобы</button>
      </form>
      <div class="queue"></div>
      <div class="review-queue"></div>
    </div>`;
  const queue = $('.queue', root);
  const headers = () => ({ 'x-admin-key': encodeURIComponent(adminKey) });
  const reviewBox = $('.review-queue', root);

  async function loadReviews() {
    const { items } = await api('/admin/reviews', { headers: headers() });
    if (!alive()) return;
    reviewBox.innerHTML = `<h2>Последние отзывы</h2>${
      items.length
        ? items
            .map(
              (r) => `<article class="my">
                <p><strong>${esc(r.author)}</strong> о продавце <strong>${esc(r.seller)}</strong>, оценка ${r.rating} из 5</p>
                <p class="desc">${esc(r.text)}</p>
                <div class="my-actions"><button class="btn small ghost" data-review="${r.id}">Удалить отзыв</button></div>
              </article>`
            )
            .join('')
        : '<p class="muted">Отзывов нет.</p>'
    }`;
  }

  reviewBox.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-review]');
    if (!btn) return;
    if (!btn.dataset.sure) {
      btn.dataset.sure = '1';
      btn.textContent = 'Точно?';
      return;
    }
    try {
      await api(`/admin/reviews/${btn.dataset.review}`, { method: 'DELETE', headers: headers() });
      await loadReviews();
    } catch (err) {
      toast(errorText(err));
    }
  });

  async function load() {
    try {
      const { items } = await api('/admin/reports', { headers: headers() });
      if (!alive()) return;
      $('form', root).hidden = true;
      queue.innerHTML = items.length
        ? items
            .map(
              (i) => `<article class="my">
                <a href="/item/${i.id}" class="my-main">
                  <span class="my-photo">${i.photo ? `<img src="/p/${i.photo}/t" alt="">` : ''}</span>
                  <span><strong>${esc(i.title)}</strong><b>${esc(priceText(i))}</b>
                    <small>${esc(phoneText(i.phone))}, жалоб: ${i.reports} ${esc(i.reasons)}</small>
                    <small>${i.status === 'hidden' ? 'Скрыто' : 'Показывается'}</small></span>
                </a>
                <p class="desc">${esc(i.description.slice(0, 300))}</p>
                <div class="my-actions">
                  <button class="btn small" data-id="${i.id}" data-action="approve">Оставить</button>
                  <button class="btn small ghost" data-id="${i.id}" data-action="hide">Скрыть</button>
                  <button class="btn small ghost" data-id="${i.id}" data-action="delete">Удалить</button>
                  <button class="btn small danger" data-id="${i.id}" data-action="ban">Заблокировать продавца</button>
                </div>
              </article>`
            )
            .join('')
        : '<p class="muted">Жалоб нет.</p>';
      await loadReviews();
    } catch (e) {
      toast(e.code === 'forbidden' ? 'Неверный ключ' : e.status === 404 ? 'Сначала задайте секрет ADMIN_KEY' : errorText(e));
    }
  }

  $('form', root).onsubmit = (e) => {
    e.preventDefault();
    adminKey = $('input', root).value.trim();
    load();
  };
  queue.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    // Опасные действия — по второму нажатию.
    if (['delete', 'ban'].includes(btn.dataset.action) && !btn.dataset.sure) {
      btn.dataset.sure = '1';
      btn.textContent = 'Точно?';
      return;
    }
    try {
      await api(`/admin/${btn.dataset.id}`, { method: 'POST', body: { action: btn.dataset.action }, headers: headers() });
      load();
    } catch (err) {
      toast(errorText(err));
    }
  });
  if (adminKey) load();
}
