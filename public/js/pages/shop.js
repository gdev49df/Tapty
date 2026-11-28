// Страница магазина: кто он, где находится и все его объявления.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { adsCount, reviewsCount, t } from '../i18n.js';
import { $, cardHtml, cityName, copyText, emptyState, errorText, esc, phoneText, ratingText, shopBadge, shopLogo, sinceText, skeleton, stars, sheet, verifiedBadge } from '../ui.js';

export default async function shopPage({ root, params, alive, back }) {
  const id = Number(params[0]);
  root.innerHTML = `
    <div class="page-head wide"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(t('shop'))}</h1></div>
    <div class="shop-page"><div class="grid">${skeleton(4)}</div></div>`;
  $('[data-back]', root).onclick = back;
  const box = $('.shop-page', root);

  let data;
  try {
    data = await api(`/shops/${id}`);
  } catch (e) {
    if (!alive()) return;
    box.innerHTML = emptyState(
      e.status === 404 ? t('shopNotFound') : errorText(e),
      '',
      `<a class="btn" href="/">${esc(t('toHome'))}</a>`
    );
    return;
  }
  if (!alive()) return;
  const { shop, seller, items } = data;
  const place = [cityName(shop.city), shop.address].filter(Boolean).join(', ');
  box.innerHTML = `
    <section class="shop-card">
      <div class="shop-top">
        ${shopLogo(shop)}
        <div><h2>${esc(shop.name)}</h2>${shopBadge()}</div>
      </div>
      ${
        seller.reviews && items.length
          ? `<a class="rating" href="/seller/${items[0].id}">${stars(seller.rating)}<b>${esc(ratingText(seller.rating))}</b><span>${esc(reviewsCount(seller.reviews))}</span></a>`
          : ''
      }
      ${seller.verified ? verifiedBadge() : ''}
      <p class="desc">${esc(shop.about)}</p>
      <p class="meta">${icon('pin')}${esc(place)}</p>
      ${shop.hours ? `<p class="meta">${icon('clock')}${esc(shop.hours)}</p>` : ''}
      <p class="muted small">${esc(sinceText(shop.since))} · ${esc(adsCount(items.length))}</p>
      <div class="shop-actions">
        ${shop.mine ? `<a class="btn" href="/shop">${icon('edit')}${esc(t('edit'))}</a>` : `<button type="button" class="btn" data-call>${icon('phone')}${esc(t('shopPhoneShow'))}</button>`}
        <button type="button" class="btn ghost" data-share>${icon('share')}${esc(t('share'))}</button>
      </div>
    </section>
    ${items.length ? `<div class="grid">${items.map(cardHtml).join('')}</div>` : `<p class="muted">${esc(t('shopEmpty'))}</p>`}`;

  $('[data-share]', box).onclick = async () => {
    const link = { title: shop.name, url: `${location.origin}/shop/${id}` };
    if (navigator.share) await navigator.share(link).catch(() => {});
    else copyText(link.url, t('linkCopied'));
  };

  $('[data-call]', box)?.addEventListener('click', async () => {
    const s = sheet('<p class="muted">…</p>', { title: shop.name });
    try {
      const { phone } = await api(`/shops/${id}/contact`, { method: 'POST' });
      s.body.innerHTML = `
        <p class="phone">${esc(phoneText(phone))}</p>
        <div class="stack">
          <a class="btn" href="tel:+${phone}">${icon('phone')}${esc(t('call'))}</a>
          <button class="btn ghost" data-copy>${icon('copy')}${esc(t('copyNumber'))}</button>
        </div>
        <p class="safety">${icon('shield')}<span>${esc(t('safety'))}</span></p>`;
      $('[data-copy]', s.body).onclick = () => copyText(`+${phone}`);
    } catch (e) {
      s.body.innerHTML = `<p>${esc(errorText(e))}</p>`;
    }
  });
}
