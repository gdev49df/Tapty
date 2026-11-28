// Все объявления одного продавца и отзывы о нём. Адрес строится по любому его объявлению.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { adsCount, reviewsCount, t } from '../i18n.js';
import { reviewForm } from '../reviews.js';
import { $, cardHtml, dateText, emptyState, errorText, esc, initial, ratingText, sinceText, skeleton, stars, verifiedBadge } from '../ui.js';

export default async function seller({ root, params, alive, back, rerender }) {
  const id = Number(params[0]);
  root.innerHTML = `
    <div class="page-head wide"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(t('seller'))}</h1></div>
    <div class="seller-page"><div class="grid">${skeleton(4)}</div></div>`;
  $('[data-back]', root).onclick = back;
  const box = $('.seller-page', root);

  let data;
  try {
    data = await api(`/listings/${id}/seller`);
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
  const { seller: info, items, reviews } = data;
  const own = reviews.items.find((r) => r.mine);
  box.innerHTML = `
    <section class="seller-card">
      <span class="avatar" aria-hidden="true">${initial(info.name)}</span>
      <div><h2>${esc(info.name)}</h2><p>${esc(sinceText(info.since))}</p><p>${esc(adsCount(info.count))}</p></div>
      ${info.verified ? verifiedBadge() : ''}
      ${info.shop ? `<a class="btn ghost wide" href="/shop/${info.shop.id}">${icon('store')}${esc(t('shopGo'))}: ${esc(info.shop.name)}</a>` : ''}
      ${
        info.reviews
          ? `<p class="rating">${stars(info.rating)}<b>${esc(ratingText(info.rating))}</b><span>${esc(reviewsCount(info.reviews))}</span></p>`
          : ''
      }
    </section>
    ${
      items.length
        ? `<div class="grid">${items.map(cardHtml).join('')}</div>`
        : `<p class="muted">${esc(t('sellerEmpty'))}</p>`
    }
    <section class="reviews" id="reviews">
      <h2>${esc(t('reviews'))}</h2>
      ${
        reviews.items.length
          ? `<ul>${reviews.items
              .map(
                (r) => `<li>
                  <div><strong>${esc(r.name)}</strong><small>${esc(dateText(r.at))}</small></div>
                  ${stars(r.rating)}
                  ${r.text ? `<p>${esc(r.text)}</p>` : ''}
                </li>`
              )
              .join('')}</ul>`
          : `<p class="muted">${esc(t('noReviews'))}</p>`
      }
      ${reviews.canReview ? `<h3>${esc(t('reviewWrite'))}</h3><div class="review-slot"></div>` : `<p class="muted small">${esc(t('reviewHow'))}</p>`}
      <p class="muted small">${esc(t('verifiedHint'))}</p>
    </section>`;
  if (reviews.canReview) {
    reviewForm($('.review-slot', box), { path: `/listings/${id}/review`, review: own, onDone: rerender });
  }
}
