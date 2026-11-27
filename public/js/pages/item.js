import { api } from '../api.js';
import { CATEGORIES, REPORT_REASONS } from '../catalog.js';
import { icon } from '../icons.js';
import { adsCount, label, t } from '../i18n.js';
import { favorites } from '../store.js';
import { $, $$, cardHtml, cityName, copyText, dateText, emptyState, errorText, esc, initial, money, phoneText, priceText, sheet, sinceText, toast } from '../ui.js';

export default async function itemPage({ root, params, alive, back, go }) {
  const id = Number(params[0]);
  root.innerHTML = '<div class="item"><div class="gallery skel-block"></div></div>';

  let item, seller, similar;
  try {
    ({ item, seller, similar = [] } = await api(`/listings/${id}`));
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
  document.title = `${item.title} — Tapty`;

  const on = favorites.has(id);
  const category = CATEGORIES.find((c) => c.id === item.category);
  const place = [cityName(item.city), item.district].filter(Boolean).join(', ');
  const active = item.status === 'active';
  const canWrite = active && !item.mine && item.whatsapp;
  const many = item.photos.length > 1;
  const specs = [
    [t('category'), label(category)],
    item.condition && [t('condition'), t(item.condition)],
    [t('deal'), t(item.priceType)],
    [t('location'), place],
    [t('published'), dateText(item.createdAt)],
    [t('views'), item.views],
  ].filter(Boolean);

  root.innerHTML = `
    <article class="item">
      <div class="col-main">
        <div class="item-media">
          <div class="gallery-wrap">
            <div class="gallery" tabindex="0" aria-label="${esc(t('photos'))}">
              ${
                item.photos.length
                  ? item.photos.map((p, i) => `<img src="/p/${p}" alt="${esc(item.title)}, ${i + 1}" ${i ? 'loading="lazy"' : ''}>`).join('')
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
          ${item.description ? `<section><h2>${esc(t('description'))}</h2><p class="desc">${esc(item.description)}</p></section>` : ''}
          <section><h2>${esc(t('specs'))}</h2>
            <dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          </section>
          ${
            canWrite
              ? `<section class="write"><h2>${esc(t('writeSeller'))}</h2>
                  <div class="quick">${['q_available', 'q_where', ...(item.priceType === 'bargain' ? ['q_price'] : [])]
                    .map((k) => `<button type="button" data-quick="${k}">${esc(t(k))}</button>`)
                    .join('')}</div>
                  <textarea class="input" rows="3" maxlength="500" aria-label="${esc(t('message'))}" placeholder="${esc(t('messageHint'))}"></textarea>
                  <div class="write-foot"><p class="muted small">${esc(t('messageNote'))}</p>
                  <button type="button" class="btn ghost" data-send>${icon('send')}${esc(t('sendMessage'))}</button></div>
                </section>`
              : ''
          }
        </div>
      </div>
      <div class="col-side">
        <div class="item-info">
          <nav class="crumbs" aria-label="breadcrumb"><a href="/">${esc(t('catalog'))}</a>${icon('next')}<a href="/search?cat=${item.category}&city=">${esc(label(category))}</a></nav>
          ${active ? '' : `<p class="status-note">${esc(t(`st_${item.status}`))}</p>`}
          <p class="price-tag">${esc(priceText(item))}</p>
          <h1>${esc(item.title)}</h1>
          <p class="meta">${icon('pin')}${esc(place)}</p>
          <p class="meta">${icon('clock')}${esc(dateText(item.createdAt))}</p>
          <div class="actions"></div>
        </div>
        <div class="item-seller">
          <section class="seller-card">
            <span class="avatar" aria-hidden="true">${initial(item.name)}</span>
            <div><h2>${esc(item.name)}</h2>
              ${seller ? `<p>${esc(sinceText(seller.since))}</p><p>${esc(adsCount(seller.count))}</p>` : ''}</div>
            <a class="btn ghost wide" href="/seller/${id}">${esc(t('allSellerAds'))}</a>
          </section>
          ${item.mine ? '' : `<p class="safety">${icon('shield')}<span>${esc(t('safety'))}</span></p>`}
          ${item.mine ? '' : `<button class="link-btn" data-report>${icon('flag')}${esc(t('report'))}</button>`}
        </div>
      </div>
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
    const canOffer = item.priceType === 'bargain';
    actions.innerHTML = `<div class="row">
      ${canOffer ? `<button class="btn ghost" data-offer>${esc(t('offer'))}</button>` : ''}
      <button class="btn" data-contact>${icon('phone')}${esc(t('contact'))}</button></div>`;
  } else actions.remove();

  $('.g-back', root).onclick = back;

  const gallery = $('.gallery', root);
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

  const waLink = (phone, extra = '') =>
    `https://wa.me/${phone}?text=${encodeURIComponent(`${t('waText')}: «${item.title}»${extra}\n${location.origin}/item/${id}`)}`;

  let contactCache;
  const contact = () =>
    (contactCache ??= api(`/listings/${id}/contact`, { method: 'POST' }).catch((e) => {
      contactCache = null;
      throw e;
    }));

  $('[data-contact]', root)?.addEventListener('click', async () => {
    const s = sheet('<p class="muted">…</p>', { title: item.name });
    try {
      const c = await contact();
      s.body.innerHTML = `
        <p class="phone">${esc(phoneText(c.phone))}</p>
        <div class="stack">
          <a class="btn" href="tel:+${c.phone}">${icon('phone')}${esc(t('call'))}</a>
          ${c.whatsapp ? `<a class="btn ghost" href="${esc(waLink(c.phone))}" target="_blank" rel="noopener">${icon('chat')}WhatsApp</a>` : ''}
          ${c.telegram ? `<a class="btn ghost" href="https://t.me/${esc(c.telegram)}" target="_blank" rel="noopener">${icon('send')}Telegram</a>` : ''}
          <button class="btn ghost" data-copy>${icon('copy')}${esc(t('copyNumber'))}</button>
        </div>
        <p class="safety">${icon('shield')}<span>${esc(t('safety'))}</span></p>`;
      $('[data-copy]', s.body).onclick = () => copyText(`+${c.phone}`);
    } catch (e) {
      s.body.innerHTML = `<p>${esc(errorText(e))}</p>`;
    }
  });

  $('[data-offer]', root)?.addEventListener('click', async () => {
    const s = sheet('<p class="muted">…</p>', { title: t('offer') });
    try {
      const c = await contact();
      if (!c.whatsapp) {
        s.body.innerHTML = `<p>${esc(t('offerNoWa'))}</p><a class="btn wide" href="tel:+${c.phone}">${icon('phone')}${esc(phoneText(c.phone))}</a>`;
        return;
      }
      const start = Math.round((item.price * 0.9) / 100) * 100 || item.price;
      s.body.innerHTML = `
        <label class="field"><span>${esc(t('offerYour'))}</span>
          <input class="input big" inputmode="numeric" value="${start}"></label>
        <a class="btn wide" target="_blank" rel="noopener">${icon('chat')}${esc(t('offerSend'))}</a>`;
      const input = $('input', s.body);
      const link = $('a', s.body);
      const update = () => {
        const sum = Number(input.value.replace(/\D/g, ''));
        input.value = sum ? String(sum) : '';
        if (sum) link.href = waLink(c.phone, `. ${t('waOffer')}: ${money(sum)}`);
        else link.removeAttribute('href');
      };
      input.addEventListener('input', update);
      update();
    } catch (e) {
      s.body.innerHTML = `<p>${esc(errorText(e))}</p>`;
    }
  });

  const write = $('.write', root);
  if (write) {
    const field = $('textarea', write);
    const send = $('[data-send]', write);
    write.addEventListener('click', (e) => {
      const key = e.target.closest('[data-quick]')?.dataset.quick;
      if (!key) return;
      field.value = t(key);
      field.focus();
    });
    send.onclick = async () => {
      const text = field.value.trim();
      if (!text) {
        field.focus();
        return toast(t('messageEmpty'));
      }
      send.disabled = true;
      try {
        const c = await contact();
        // Переход в той же вкладке: всплывающее окно после ожидания браузер заблокировал бы.
        location.assign(waLink(c.phone, `\n${text}`));
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
