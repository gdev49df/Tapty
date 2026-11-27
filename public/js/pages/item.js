import { api } from '../api.js';
import { CATEGORIES, REPORT_REASONS } from '../catalog.js';
import { icon } from '../icons.js';
import { label, t } from '../i18n.js';
import { favorites } from '../store.js';
import { $, cityName, copyText, dateText, emptyState, errorText, esc, money, phoneText, priceText, sheet, toast } from '../ui.js';

export default async function itemPage({ root, params, alive, back, go }) {
  const id = Number(params[0]);
  root.innerHTML = '<div class="item"><div class="gallery skel-block"></div></div>';

  let item;
  try {
    ({ item } = await api(`/listings/${id}`));
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
  const category = label(CATEGORIES.find((c) => c.id === item.category));
  const place = [cityName(item.city), item.district].filter(Boolean).join(', ');
  const tags = [item.priceType !== 'free' && t(item.priceType), item.condition && t(item.condition), category].filter(Boolean);
  const active = item.status === 'active';

  root.innerHTML = `
    <article class="item">
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
          item.photos.length > 1
            ? `<span class="counter" aria-live="polite">1 / ${item.photos.length}</span>
               <button class="round g-prev" aria-label="←">${icon('back')}</button><button class="round g-next" aria-label="→">${icon('next')}</button>`
            : ''
        }
      </div>
      <div class="item-info">
        ${active ? '' : `<p class="status-note">${esc(t(`st_${item.status}`))}</p>`}
        <p class="price-tag">${esc(priceText(item))}</p>
        <h1>${esc(item.title)}</h1>
        <ul class="tags">${tags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="meta">${icon('pin')}${esc(place)}</p>
        <div class="actions"></div>
        ${item.description ? `<section><h2>${esc(t('description'))}</h2><p class="desc">${esc(item.description)}</p></section>` : ''}
        <section class="seller">
          <span class="avatar" aria-hidden="true">${esc([...item.name][0]?.toUpperCase() || '?')}</span>
          <div><strong>${esc(item.name)}</strong><small>${esc(t('seller'))}</small></div>
        </section>
        <p class="meta small">${esc(t('published'))}: ${esc(dateText(item.createdAt))}</p>
        <p class="meta small">${icon('eye')}${esc(t('views'))}: ${item.views}</p>
        ${
          item.mine
            ? ''
            : `<p class="safety">${icon('shield')}<span>${esc(t('safety'))}</span></p>
               <button class="link-btn" data-report>${icon('flag')}${esc(t('report'))}</button>`
        }
      </div>
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
    gallery.addEventListener('scroll', () => {
      counter.textContent = `${Math.round(gallery.scrollLeft / gallery.clientWidth) + 1} / ${item.photos.length}`;
    }, { passive: true });
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
