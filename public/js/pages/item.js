import { api, auth } from '../api.js';
import { authSheet, withAuth } from '../auth.js';
import { CATEGORIES, REPORT_REASONS } from '../catalog.js';
import { icon } from '../icons.js';
import { adsCount, label, reviewsCount, t, viewsCount } from '../i18n.js';
import { favorites } from '../favorites.js';
import { openViewer } from '../viewer.js';
import { $, $$, areaName, cardHtml, cityName, copyText, dateText, emptyState, errorText, esc, initial, money, phoneText, placeText, priceText, ratingText, sheet, shopBadge, shopLogo, sinceText, stars, toast, verifiedBadge, wasCheaper, hiddenWhy } from '../ui.js';

export default async function itemPage({ root, params, alive, back, go, rerender }) {
  const id = Number(params[0]);
  root.innerHTML = '<div class="item"><div class="gallery skel-block"></div></div>';

  let item, seller, same, similar;
  try {
    ({ item, seller, same = [], similar = [] } = await api(`/listings/${id}`));
  } catch (e) {
    if (!alive()) return;
    const missing = e.status === 404;
    root.innerHTML = emptyState(
      missing ? t('notFound') : errorText(e),
      missing ? t('notFoundHint') : '',
      `<a class="btn" href="/">${esc(t('toHome'))}</a>`
    );
    return;
  }
  if (!alive()) return;

  const on = favorites.has(id);
  const category = CATEGORIES.find((c) => c.id === item.category);
  const place = placeText(item);
  const active = item.status === 'active';
  const canWrite = active && !item.mine && item.chat;
  const many = item.photos.length > 1;
  const specs = [
    [t('category'), label(category)],
    item.condition && [t('condition'), t(item.condition)],
    [t('deal'), t(item.priceType)],
    [t('location'), place],
  ].filter(Boolean);
  // Номера объявлений начинаются с миллиона.
  const number = 1_000_000 + id;
  // Карта ищет улицу или ориентир продавца, а если их нет — выбранный район.
  const mapQuery = [t('country'), cityName(item.city), item.district || areaName(item.city, item.area)].filter(Boolean).join(', ');
  const cheapest = same[0];
  const sameRow = (other) => {
    const diff = other.price - item.price;
    return `<li><a href="/item/${other.id}">
      <span class="my-photo">${other.photo ? `<img src="/p/${other.photo}/t" alt="" loading="lazy">` : icon('camera')}</span>
      <span class="same-text"><strong>${esc(other.title)}</strong><small>${esc(
        [cityName(other.city), areaName(other.city, other.area), other.condition && t(other.condition)].filter(Boolean).join(', ')
      )}</small></span>
      <span class="same-price"><b>${esc(money(other.price))}</b><small class="${diff < 0 ? 'cheaper' : ''}">${esc(
        `${diff < 0 ? '−' : '+'}${money(Math.abs(diff))}`
      )}</small></span>
    </a></li>`;
  };

  root.innerHTML = `
    <article class="item">
      <div class="col-main">
        <div class="item-media">
          <div class="gallery-wrap">
            <div class="gallery" tabindex="0" aria-label="${esc(t(item.photos.length ? 'openPhoto' : 'photos'))}">
              ${
                item.photos.length
                  ? item.photos.map((p, i) => `<img src="/p/${p}" data-photo="${i}" alt="${esc(item.title)}, ${i + 1}" ${i ? 'loading="lazy"' : ''}>`).join('')
                  : `<div class="no-photo">${icon('camera')}</div>`
              }
            </div>
            <button class="round g-back" aria-label="${esc(t('back'))}">${icon('back')}</button>
            <div class="g-actions">
              <button class="round" data-share aria-label="${esc(t('share'))}">${icon('share')}</button>
              <button class="round heart" data-fav="${id}" aria-pressed="${on}" aria-label="${esc(t(on ? 'fromFav' : 'toFav'))}">${icon('heart')}</button>
            </div>
            ${
              many
                ? `<span class="counter" aria-live="polite">1 / ${item.photos.length}</span>
                   <button class="round g-prev" aria-label="←">${icon('back')}</button><button class="round g-next" aria-label="→">${icon('next')}</button>`
                : ''
            }
          </div>
          ${
            many
              ? `<div class="thumbs">${item.photos
                  .map((p, i) => `<button data-slide="${i}" aria-label="${esc(t('photos'))} ${i + 1}"${i ? '' : ' aria-current="true"'}><img src="/p/${p}/t" alt="" loading="lazy"></button>`)
                  .join('')}</div>`
              : ''
          }
        </div>
        <div class="item-more">
          ${
            canWrite && !auth.signedIn()
              ? `<section class="write"><h2>${esc(t('writeSeller'))}</h2>
                  <button type="button" class="btn wide" data-login>${icon('chat')}${esc(t('loginToWrite'))}</button>
                </section>`
              : canWrite
              ? `<section class="write"><h2>${esc(t('writeSeller'))}</h2>
                  <p class="muted">${esc(t('messageNote'))}</p>
                  <form class="write-row">
                    <input class="input" maxlength="500" autocomplete="off" enterkeyhint="send" aria-label="${esc(t('message'))}" placeholder="${esc(t('messageHint'))}">
                    <button class="btn" data-send>${esc(t('sendMessage'))}</button>
                  </form>
                  <div class="quick">${['q_available', 'q_where', ...(item.priceType === 'bargain' ? ['q_price'] : [])]
                    .map((k) => `<button type="button" data-quick="${k}">${esc(t(k))}</button>`)
                    .join('')}</div>
                </section>`
              : ''
          }
          ${item.description ? `<section><h2>${esc(t('description'))}</h2><p class="desc">${esc(item.description)}</p></section>` : ''}
          <section><h2>${esc(t('specs'))}</h2>
            <dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          </section>
          <section class="item-map"><h2>${esc(t('onMap'))}</h2>
            <p class="meta">${icon('pin')}${esc(place)}</p>
            <iframe src="https://yandex.kz/map-widget/v1/?mode=search&amp;z=15&amp;text=${encodeURIComponent(mapQuery)}" title="${esc(t('onMap'))}: ${esc(place)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allowfullscreen></iframe>
            <a class="link-btn" href="https://2gis.kz/search/${encodeURIComponent(place)}" target="_blank" rel="noopener">${esc(t('open2gis'))}${icon('next')}</a>
          </section>
          <p class="item-stamp"><span>№ ${number}</span> · <span>${esc(dateText(item.createdAt))}</span> · <span>${esc(viewsCount(item.views))}</span></p>
        </div>
      </div>
      <div class="col-side">
        <div class="item-info">
          <nav class="crumbs" aria-label="breadcrumb"><a href="/">${esc(t('catalog'))}</a>${icon('next')}<a href="/search?cat=${item.category}&city=">${esc(label(category))}</a></nav>
          ${active ? '' : `<p class="status-note">${esc(t(`st_${item.status}`))}</p>`}
          ${item.mine && item.status === 'hidden' ? hiddenWhy(item.hideReason) : ''}
          <div class="price-box">
            <p class="price-tag">${esc(priceText(item))}</p>
            ${t(item.priceType) === priceText(item) ? '' : `<span class="deal">${esc(t(item.priceType))}</span>`}
            ${
              wasCheaper(item)
                ? `<p class="price-was"><s><span class="sr-only">${esc(t('oldPrice'))} </span>${esc(money(item.oldPrice))}</s> ${esc(
                    `${t('priceDrop')} ${money(item.oldPrice - item.price)}`
                  )}</p>`
                : ''
            }
            ${
              cheapest
                ? `<button type="button" class="price-same" data-same>${esc(
                    cheapest.price < item.price ? `${t('sameFrom')} ${money(cheapest.price)}` : `${t('sameCompare')} (${same.length})`
                  )}${icon('down')}</button>`
                : ''
            }
          </div>
          <h1>${esc(item.title)}</h1>
          <p class="meta">${icon('pin')}${esc(place)}</p>
          <p class="meta">${icon('clock')}${esc(dateText(item.createdAt))}</p>
          <div class="actions"></div>
        </div>
        <div class="item-seller">
          <section class="seller-card">
            ${seller.shop ? shopLogo(seller.shop) : `<span class="avatar" aria-hidden="true">${initial(item.name)}</span>`}
            <div><h2>${esc(seller.shop?.name ?? item.name)}</h2>
              <p>${esc(sinceText(seller.since))}</p><p>${esc(adsCount(seller.count))}</p></div>
            ${seller.shop || seller.verified ? `<div class="badges">${seller.shop ? shopBadge() : ''}${seller.verified ? verifiedBadge() : ''}</div>` : ''}
            <a class="rating" href="/seller/${id}">${
              seller.reviews
                ? `${stars(seller.rating)}<b>${esc(ratingText(seller.rating))}</b><span>${esc(reviewsCount(seller.reviews))}</span>`
                : `<span>${esc(t('noReviews'))}</span>`
            }</a>
            <a class="btn ghost wide" href="${seller.shop ? `/shop/${seller.shop.id}` : `/seller/${id}`}">${esc(t(seller.shop ? 'shopGo' : 'allSellerAds'))}</a>
          </section>
          ${item.mine ? '' : `<p class="safety">${icon('shield')}<span>${esc(t('safety'))}</span></p>`}
          ${item.mine ? '' : `<button class="link-btn" data-report>${icon('flag')}${esc(t('report'))}</button>`}
        </div>
      </div>
      ${
        same.length
          ? `<section class="same"><h2>${esc(t('sameTitle'))}</h2><ul class="same-list">${same.map(sameRow).join('')}</ul></section>`
          : ''
      }
      ${
        similar.length
          ? `<section class="similar"><h2>${esc(t('similar'))}</h2><div class="grid">${similar.map(cardHtml).join('')}</div></section>`
          : ''
      }
    </article>`;

  const actions = $('.actions', root);
  if (item.mine) {
    actions.innerHTML = `<p>${esc(t('yours'))}</p>
      <div class="row">${item.status === 'hidden' ? '' : `<a class="btn" href="/edit/${id}">${icon('edit')}${esc(t('edit'))}</a>`}
      <a class="btn ghost" href="/me">${esc(t('myAds'))}</a></div>`;
  } else if (active) {
    const canOffer = item.priceType === 'bargain' && item.chat;
    actions.innerHTML = `<div class="row">
      ${canOffer ? `<button class="btn ghost" data-offer>${esc(t('offer'))}</button>` : ''}
      <button class="btn" data-contact>${icon('phone')}${esc(t('contact'))}</button></div>`;
  } else actions.remove();

  $('.g-back', root).onclick = back;
  // После входа страница перерисовывается уже с полем сообщения.
  const askLogin = (then) => authSheet({ note: t('authChat'), onDone: () => alive() && (then ? then() : rerender()) });
  $('[data-login]', root)?.addEventListener('click', () => askLogin());
  $('[data-same]', root)?.addEventListener('click', () =>
    $('.same', root).scrollIntoView({ block: 'start', behavior: 'smooth' })
  );

  const gallery = $('.gallery', root);
  const view = (i) => openViewer(item.photos, i, item.title);
  gallery.addEventListener('click', (e) => {
    const photo = e.target.closest('[data-photo]');
    if (photo) view(Number(photo.dataset.photo));
  });
  gallery.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !item.photos.length) return;
    e.preventDefault();
    view(Math.round(gallery.scrollLeft / gallery.clientWidth) || 0);
  });
  const counter = $('.counter', root);
  if (counter) {
    const thumbs = $$('[data-slide]', root);
    gallery.addEventListener('scroll', () => {
      const at = Math.round(gallery.scrollLeft / gallery.clientWidth);
      counter.textContent = `${at + 1} / ${item.photos.length}`;
      thumbs.forEach((b, i) => (i === at ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    }, { passive: true });
    thumbs.forEach((b, i) => (b.onclick = () => gallery.scrollTo({ left: i * gallery.clientWidth, behavior: 'smooth' })));
    $('.g-prev', root).onclick = () => gallery.scrollBy({ left: -gallery.clientWidth, behavior: 'smooth' });
    $('.g-next', root).onclick = () => gallery.scrollBy({ left: gallery.clientWidth, behavior: 'smooth' });
  }

  $('[data-share]', root).onclick = async () => {
    const data = { title: item.title, text: `${item.title}, ${priceText(item)}`, url: `${location.origin}/item/${id}` };
    if (navigator.share) await navigator.share(data).catch(() => {});
    else copyText(data.url, t('linkCopied'));
  };

  const waLink = (phone) =>
    `https://wa.me/${phone}?text=${encodeURIComponent(`${t('waText')}: «${item.title}»\n${location.origin}/item/${id}`)}`;

  let contactCache;
  const contact = () =>
    (contactCache ??= api(`/listings/${id}/contact`, { method: 'POST' }).catch((e) => {
      contactCache = null;
      throw e;
    }));

  const openContact = async () => {
    const s = sheet('<p class="muted">…</p>', { title: item.name });
    try {
      const c = await contact();
      s.body.innerHTML = `
        <p class="phone">${esc(phoneText(c.phone))}</p>
        <div class="stack">
          <a class="btn" href="tel:+${c.phone}">${icon('phone')}${esc(t('call'))}</a>
          ${c.whatsapp ? `<a class="btn ghost" href="${esc(waLink(c.phone))}" target="_blank" rel="noopener">${icon('chat')}WhatsApp</a>` : ''}
          ${c.telegram ? `<a class="btn ghost" href="https://t.me/${esc(c.telegram)}" target="_blank" rel="noopener">${icon('send')}Telegram</a>` : ''}
          ${c.locked ? `<button class="btn ghost" data-write>${icon('chat')}${esc(t('loginToWrite'))}</button>` : ''}
          <button class="btn ghost" data-copy>${icon('copy')}${esc(t('copyNumber'))}</button>
        </div>
        <p class="safety">${icon('shield')}<span>${esc(t('safety'))}</span></p>`;
      $('[data-copy]', s.body).onclick = () => copyText(`+${c.phone}`);
      $('[data-write]', s.body)?.addEventListener('click', () => {
        s.close();
        // страница и контакты запрашиваются заново, уже от вошедшего
        askLogin(async () => {
          await rerender();
          $('[data-contact]')?.click();
        });
      });
    } catch (e) {
      s.body.innerHTML = `<p>${esc(errorText(e))}</p>`;
    }
  };
  $('[data-contact]', root)?.addEventListener('click', openContact);

  // Сообщение уходит в чат на сайте, и открывается сама переписка.
  const sendToChat = async (body) => {
    const { chat } = await api(`/listings/${id}/chat`, { method: 'POST', body });
    if (!alive()) return;
    toast(t('messageSent'));
    go(`/chat/${chat}`);
  };

  const openOffer = () => {
    const start = Math.round((item.price * 0.9) / 100) * 100 || item.price;
    const s = sheet(
      `<form class="form">
        <label class="field"><span>${esc(t('offerYour'))}</span>
          <input class="input big" inputmode="numeric" maxlength="12" value="${start}"></label>
        <button class="btn wide">${icon('send')}${esc(t('offerSend'))}</button>
      </form>`,
      { title: t('offer') }
    );
    const input = $('input', s.body);
    input.addEventListener('input', () => (input.value = input.value.replace(/\D/g, '')));
    $('form', s.body).onsubmit = async (e) => {
      e.preventDefault();
      const sum = Number(input.value);
      if (!sum) return input.focus();
      const button = $('button.btn', s.body);
      button.disabled = true;
      try {
        await withAuth(t('authChat'), () => sendToChat({ offer: sum }));
      } catch (err) {
        button.disabled = false;
        toast(errorText(err));
      }
    };
  };
  $('[data-offer]', root)?.addEventListener('click', () => {
    if (auth.signedIn()) openOffer();
    else askLogin(async () => {
      await rerender();
      $('[data-offer]')?.click();
    });
  });

  // У гостя вместо поля сообщения стоит кнопка входа.
  const write = $('.write-row', root)?.closest('.write');
  if (write) {
    const field = $('input', write);
    const send = $('[data-send]', write);
    write.addEventListener('click', (e) => {
      const key = e.target.closest('[data-quick]')?.dataset.quick;
      if (!key) return;
      field.value = t(key);
      field.focus();
    });
    $('form', write).onsubmit = async (e) => {
      e.preventDefault();
      const text = field.value.trim();
      if (!text) {
        field.focus();
        return toast(t('messageEmpty'));
      }
      send.disabled = true;
      try {
        await withAuth(t('authChat'), () => sendToChat({ text }));
      } catch (e) {
        toast(errorText(e));
      }
      send.disabled = false;
    };
  }

  $('[data-report]', root)?.addEventListener('click', () => {
    const s = sheet(
      `<ul class="options">${REPORT_REASONS.map((r) => `<li><button data-reason="${r}">${esc(t(`r_${r}`))}</button></li>`).join('')}</ul>`,
      { title: t('reportTitle') }
    );
    s.body.addEventListener('click', async (e) => {
      const reason = e.target.closest('[data-reason]')?.dataset.reason;
      if (!reason) return;
      s.close();
      try {
        await api(`/listings/${id}/report`, { method: 'POST', body: { reason } });
        toast(t('reported'));
      } catch (err) {
        toast(errorText(err));
      }
    });
  });
}
