// Свой магазин: заявка на открытие, её состояние и изменение данных.
import { api, currentUser, dropSession } from '../api.js';
import { agreeBox, authForm } from '../auth.js';
import { CITIES, LEGAL_VERSION, LIMITS, normalizePhone } from '../catalog.js';
import { askRemoveShop } from '../dialogs.js';
import { icon } from '../icons.js';
import { label, t } from '../i18n.js';
import { compress } from '../images.js';
import { store } from '../store.js';
import { $, emptyState, errorText, esc, phoneText, toast } from '../ui.js';

const AGREE = ['agreeOffer', 'agreeShop'];

export default async function myShop({ root, alive, back, rerender }) {
  root.innerHTML = `<div class="page-head"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(t('shopMine'))}</h1></div>`;
  $('[data-back]', root).onclick = back;

  let user;
  let shop;
  try {
    user = await currentUser();
    if (!alive()) return;
    if (!user) {
      root.insertAdjacentHTML('beforeend', '<div class="narrow login-slot"></div>');
      authForm($('.login-slot', root), { note: t('authShop'), onDone: rerender });
      return;
    }
    ({ shop } = await api('/shop'));
  } catch (e) {
    if (!alive()) return;
    root.insertAdjacentHTML('beforeend', emptyState(errorText(e), ''));
    return;
  }
  if (!alive()) return;

  const status = shop?.status;
  const state = shop
    ? `<section class="shop-state ${status}">
        <h2>${esc(t(`shopSt_${status}`))}</h2>
        <p>${esc(t(`shopAbout_${status}`))}</p>
        ${shop.note ? `<p class="shop-note">${esc(t('shopReason'))}: ${esc(shop.note)}</p>` : ''}
        ${status === 'approved' ? `<a class="btn wide" href="/shop/${shop.id}">${esc(t('shopView'))}</a>` : ''}
      </section>`
    : `<p class="muted">${esc(t('shopIntro'))}</p>`;

  if (status === 'closed') {
    root.insertAdjacentHTML('beforeend', `<div class="narrow">${state}</div>`);
    return;
  }

  const values = shop ?? { name: '', about: '', city: store.get('city', ''), address: '', hours: '', phone: store.get('seller', {}).phone || '', logo: null };
  const locked = status === 'approved';
  // Согласие спрашивается при первой заявке и после изменения документов.
  const agree = !shop || shop.consent !== LEGAL_VERSION;
  const submitText = t(!shop || status === 'rejected' ? (shop ? 'shopResend' : 'shopSend') : 'save');
  const text = (name, field, labelText, attrs, hint = '') =>
    `<label class="field" data-field="${field}"><span>${esc(labelText)}</span>
      <input class="input" name="${name}" value="${esc(values[name])}" placeholder="${esc(hint)}" ${attrs}><em></em></label>`;

  root.insertAdjacentHTML(
    'beforeend',
    `<div class="narrow shop-form">
      ${state}
      <form class="form" novalidate>
        <fieldset data-field="logo"><legend>${esc(t('shopLogo'))}</legend>
          <div class="uploader"></div>
          <input type="file" accept="image/*" hidden>
          <em></em>
        </fieldset>
        ${text('name', 'shopName', t('shopName'), `maxlength="${LIMITS.shopNameMax}"${locked ? ' readonly' : ''}`)}
        ${locked ? `<p class="muted small field-hint">${esc(t('shopNameLocked'))}</p>` : ''}
        <label class="field" data-field="about"><span>${esc(t('shopWhat'))}</span>
          <textarea class="input" name="about" rows="4" maxlength="${LIMITS.shopAboutMax}" placeholder="${esc(t('shopWhatHint'))}">${esc(values.about)}</textarea><em></em></label>
        <label class="field" data-field="city"><span>${esc(t('city'))}</span>
          <select class="input" name="city"><option value="">${esc(t('choose'))}</option>
          ${CITIES.map((c) => `<option value="${c.id}"${values.city === c.id ? ' selected' : ''}>${esc(label(c))}</option>`).join('')}
          </select><em></em></label>
        ${text('address', 'address', t('shopAddress'), `maxlength="${LIMITS.addressMax}"`)}
        ${text('hours', 'hours', t('shopHours'), `maxlength="${LIMITS.hoursMax}"`, t('shopHoursHint'))}
        ${text('phone', 'phone', t('fPhone'), 'type="tel" inputmode="tel" autocomplete="tel" maxlength="18"', '+7 701 123 45 67')}
        ${agree ? `<div class="agree">${AGREE.map(agreeBox).join('')}</div>` : ''}
        <p class="form-error" role="alert"></p>
        <button class="btn wide submit">${esc(submitText)}</button>
        ${shop ? `<button type="button" class="btn ghost wide delete-ad" data-delete>${icon('trash')}<span>${esc(t(locked ? 'shopRemove' : 'shopWithdraw'))}</span></button>` : ''}
      </form>
    </div>`
  );

  const form = $('form', root);
  const field = (name) => form.elements.namedItem(name);
  const phone = field('phone');
  const prettyPhone = () => {
    const p = normalizePhone(phone.value);
    if (p) phone.value = phoneText(p);
  };
  prettyPhone();
  phone.addEventListener('blur', prettyPhone);
  form.addEventListener('input', (e) => e.target.closest('[data-field]')?.classList.remove('bad'));
  form.addEventListener('change', (e) => e.target.closest('[data-field]')?.classList.remove('bad'));

  // Логотип: одна картинка, загружается сразу, закрепляется за магазином при сохранении.
  let logo = values.logo;
  let preview = logo ? `/p/${logo}/t` : '';
  let uploading = false;
  const uploader = $('.uploader', form);
  const fileInput = $('input[type="file"]', form);
  const drawLogo = () => {
    uploader.innerHTML = preview
      ? `<figure class="thumb${uploading ? ' busy' : ''}"><img src="${preview}" alt="">
          ${uploading ? '' : `<button type="button" class="drop" data-drop aria-label="${esc(t('removePhoto'))}">${icon('close')}</button>`}</figure>`
      : `<button type="button" class="thumb add">${icon('camera')}<span>${esc(t('addPhoto'))}</span></button>`;
  };
  drawLogo();
  uploader.addEventListener('click', (e) => {
    if (e.target.closest('.add')) return fileInput.click();
    if (!e.target.closest('[data-drop]')) return;
    logo = null;
    preview = '';
    drawLogo();
  });
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (!file) return;
    preview = URL.createObjectURL(file);
    uploading = true;
    $('[data-field="logo"]', form).classList.remove('bad');
    drawLogo();
    try {
      const { full, thumb } = await compress(file);
      const body = new FormData();
      body.set('full', full, 'full');
      body.set('thumb', thumb, 'thumb');
      logo = (await api('/photos', { method: 'POST', body })).id;
    } catch (e) {
      logo = values.logo;
      preview = logo ? `/p/${logo}/t` : '';
      toast(e.code ? errorText(e) : t('badPhoto'));
    }
    uploading = false;
    if (alive()) drawLogo();
  });

  const showError = (name, message) => {
    const box = $(`[data-field="${name}"]`, form);
    if (!box) return false;
    box.classList.add('bad');
    $('em', box).textContent = message;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('input, select, textarea', box)?.focus({ preventScroll: true });
    return true;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = $('.form-error', form);
    errorBox.textContent = '';
    if (uploading) return toast(t('waitPhotos'));
    const data = Object.fromEntries(['name', 'about', 'city', 'address', 'hours', 'phone'].map((n) => [n, field(n).value.trim()]));
    data.logo = logo || '';
    if (data.name.length < 2) return showError('shopName', t('e_shopName'));
    if (data.about.length < LIMITS.shopAboutMin) return showError('about', t('e_about'));
    if (!data.city) return showError('city', t('e_city'));
    if (!normalizePhone(data.phone)) return showError('phone', t('e_phone'));
    if (agree) {
      const missed = AGREE.find((n) => !field(n).checked);
      if (missed) return showError(missed, t('shopAgreeNeeded'));
      data.consent = LEGAL_VERSION;
    }
    const button = $('.submit', form);
    button.disabled = true;
    try {
      await api('/shop', { method: 'PUT', body: data });
      toast(t(locked ? 'saved' : 'shopSent'));
      if (alive()) rerender();
    } catch (err) {
      button.disabled = false;
      if (err.code === 'login_required') {
        dropSession();
        return rerender();
      }
      if (err.field && showError(err.field, t(err.code === 'invalid' ? `e_${err.field}` : `err_${err.code}`))) return;
      errorBox.textContent = errorText(err);
    }
  });

  const remove = $('[data-delete]', form);
  remove?.addEventListener('click', () =>
    askRemoveShop(locked, async () => {
      remove.disabled = true;
      try {
        await api('/shop', { method: 'DELETE' });
        toast(t(locked ? 'shopRemoved' : 'shopWithdrawn'));
        if (alive()) rerender();
      } catch (err) {
        remove.disabled = false;
        toast(errorText(err));
      }
    })
  );
}
