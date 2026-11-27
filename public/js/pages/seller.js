// Все объявления одного продавца. Адрес строится по любому его объявлению.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { adsCount, t } from '../i18n.js';
import { $, cardHtml, emptyState, errorText, esc, initial, sinceText, skeleton } from '../ui.js';

export default async function seller({ root, params, alive, back }) {
  root.innerHTML = `
    <div class="page-head wide"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(t('seller'))}</h1></div>
    <div class="seller-page"><div class="grid">${skeleton(4)}</div></div>`;
  $('[data-back]', root).onclick = back;
  const box = $('.seller-page', root);

  let data;
  try {
    data = await api(`/listings/${Number(params[0])}/seller`);
  } catch (e) {
    if (!alive()) return;
    box.innerHTML = emptyState(
      e.status === 404 ? t('notFound') : errorText(e),
      e.status === 404 ? t('notFoundHint') : '',
      `<a class="btn" href="/">${esc(t('toHome'))}</a>`
    );
    return;
  }
  if (!alive()) return;
  const { name, since, count } = data.seller;
  document.title = `${name} — tapty.`;
  box.innerHTML = `
    <section class="seller-card">
      <span class="avatar" aria-hidden="true">${initial(name)}</span>
      <div><h2>${esc(name)}</h2><p>${esc(sinceText(since))}</p><p>${esc(adsCount(count))}</p></div>
    </section>
    ${
      data.items.length
        ? `<div class="grid">${data.items.map(cardHtml).join('')}</div>`
        : `<p class="muted">${esc(t('sellerEmpty'))}</p>`
    }`;
}
