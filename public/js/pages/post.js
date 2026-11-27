import { api, config, currentUser, dropSession } from '../api.js';
import { authForm } from '../auth.js';
import { CATEGORIES, CITIES, CONDITIONS, LIMITS, PRICE_TYPES, normalizePhone } from '../catalog.js';
import { askDeleteListing } from '../dialogs.js';
import { icon } from '../icons.js';
import { adsCount, label, lang, t } from '../i18n.js';
import { compress, forAi } from '../images.js';
import { store } from '../store.js';
import { $, $$, areaOptions, emptyState, errorText, esc, money, phoneText, toast } from '../ui.js';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const spaced = (v) => digits(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default async function post({ root, params, alive, go, back, rerender, onLeave }) {
  const editId = params[0] ? Number(params[0]) : null;
  const title = t(editId ? 'editTitle' : 'newTitle');
  const head = `<div class="page-head"><button class="icon-btn" data-back aria-label="${esc(t('back'))}">${icon('back')}</button><h1>${esc(title)}</h1></div>`;
  root.innerHTML = head;
  $('[data-back]', root).onclick = back;

  let values;
  let user;
  let aiOn = false;
  try {
    const [cfg, me] = await Promise.all([config(), currentUser()]);
    if (!alive()) return;
    aiOn = cfg.ai;
    user = me;
    if (!user) {
      root.insertAdjacentHTML('beforeend', '<div class="narrow login-slot"></div>');
      authForm($('.login-slot', root), { note: t('authPost'), onDone: rerender });
      return;
    }
    if (editId) values = (await api(`/mine/${editId}`)).item;
  } catch (e) {
    if (!alive()) return;
    root.insertAdjacentHTML('beforeend', emptyState(e.status === 404 ? t('notFound') : errorText(e), ''));
    return;
  }
  if (!alive()) return;

  const seller = store.get('seller', {});
  const draft = editId ? null : store.get('draft');
  values ??= {
    title: '', description: '', category: '', condition: '', priceType: 'fixed', price: '',
    city: store.get('city', ''), area: '', district: '', name: user.name, phone: '', whatsapp: true, telegram: '', photos: [],
    ...seller, ...draft,
  };
  const photos = values.photos.map((id) => ({ id, preview: `/p/${id}/t` }));

  const select = (name, list, text) =>
    `<label class="field" data-field="${name}"><span>${esc(text)}</span>
      <select class="input" name="${name}"><option value="">${esc(t('choose'))}</option>
      ${list.map((o) => `<option value="${o.id}"${values[name] === o.id ? ' selected' : ''}>${esc(label(o))}</option>`).join('')}
      </select><em></em></label>`;
  const segs = (name, list) =>
    list.map((v) => `<label class="seg"><input type="radio" name="${name}" value="${v}"${values[name] === v ? ' checked' : ''}><span>${esc(t(v))}</span></label>`).join('');
  const text = (name, labelText, attrs = '', hint = '') =>
    `<label class="field" data-field="${name}"><span>${esc(labelText)}</span>
      <input class="input" name="${name}" value="${esc(values[name])}" placeholder="${esc(hint)}" ${attrs}><em></em></label>`;

  root.insertAdjacentHTML(
    'beforeend',
    `<form class="form narrow" novalidate>
      <fieldset data-field="photos" class="form-part"><legend>${esc(t('sPhoto'))}</legend>
        <p class="muted">${esc(t('photosHint'))}</p>
        <div class="uploader"></div>
        <input type="file" accept="image/*" multiple hidden>
        <em></em>
        <div class="ai" hidden>
          <button type="button" class="btn ghost wide" data-ai>${icon('scan')}<span>${esc(t('aiFill'))}</span></button>
          <p class="muted small">${esc(t('aiHint'))}</p>
        </div>
      </fieldset>
      <h2 class="form-title">${esc(t('sAbout'))}</h2>
      ${text('title', t('fTitle'), `maxlength="${LIMITS.titleMax}"`, t('fTitleHint'))}
      ${select('category', CATEGORIES, t('category'))}
      <fieldset data-field="condition"><legend>${esc(t('condition'))}</legend><div class="segs">${segs('condition', CONDITIONS)}</div><em></em></fieldset>
      <label class="field" data-field="description"><span>${esc(t('fDesc'))}</span>
        <textarea class="input" name="description" rows="5" maxlength="${LIMITS.descMax}" placeholder="${esc(t('fDescHint'))}">${esc(values.description)}</textarea><em></em></label>
      <h2 class="form-title">${esc(t('sPrice'))}</h2>
      <fieldset><legend>${esc(t('deal'))}</legend><div class="segs">${segs('priceType', PRICE_TYPES)}</div></fieldset>
      <label class="field" data-field="price"><span>${esc(t('fPrice'))}</span>
        <input class="input big" name="price" inputmode="numeric" value="${esc(values.price ? spaced(values.price) : '')}" maxlength="15"><em></em></label>
      <div class="price-hint" aria-live="polite" hidden></div>
      <h2 class="form-title">${esc(t('sContacts'))}</h2>
      ${select('city', CITIES, t('city'))}
      <label class="field" data-field="area"><span>${esc(t('fArea'))}</span><select class="input" name="area"></select><em></em></label>
      ${text('district', t('fStreet'), `maxlength="${LIMITS.districtMax}"`)}
      ${text('name', t('fName'), `maxlength="${LIMITS.nameMax}" autocomplete="name"`)}
      ${text('phone', t('fPhone'), 'type="tel" inputmode="tel" autocomplete="tel" maxlength="18"', '+7 701 123 45 67')}
      <label class="check"><input type="checkbox" name="whatsapp"${values.whatsapp ? ' checked' : ''}><span>${esc(t('fWhatsapp'))}</span></label>
      ${text('telegram', t('fTelegram'), 'maxlength="40" autocapitalize="off" autocorrect="off" spellcheck="false"', '@username')}
      <p class="form-error" role="alert"></p>
      <button class="btn wide submit">${esc(t(editId ? 'save' : 'publish'))}</button>
      <p class="muted small">${esc(t('agree'))} <a href="/rules">${esc(t('rules'))}</a></p>
      ${editId && values.status !== 'hidden' ? `<button type="button" class="btn ghost wide delete-ad" data-delete>${icon('trash')}<span>${esc(t('removeAd'))}</span></button>` : ''}
    </form>`
  );

  const form = $('form', root);
  const remove = $('[data-delete]', form);
  remove?.addEventListener('click', () =>
    askDeleteListing(async () => {
      remove.disabled = true;
      try {
        await api(`/listings/${editId}`, { method: 'DELETE' });
        toast(t('removed'));
        if (alive()) go('/me', { replace: true });
      } catch (err) {
        remove.disabled = false;
        toast(errorText(err));
      }
    })
  );
  const phoneInput = form.elements.phone;
  const prettyPhone = () => {
    const p = normalizePhone(phoneInput.value);
    if (p) phoneInput.value = phoneText(p);
  };
  prettyPhone();
  phoneInput.addEventListener('blur', prettyPhone);

  // Список районов зависит от города; у большинства городов его нет.
  let areaCity = null;
  const drawAreas = (selected) => {
    const city = form.elements.city.value;
    if (city === areaCity) return;
    areaCity = city;
    const list = areaOptions(city);
    form.elements.area.innerHTML = [{ value: '', label: t('noArea') }, ...list]
      .map((o) => `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`)
      .join('');
    $('[data-field="area"]', form).hidden = !list.length;
  };
  drawAreas(values.area);

  const read = () => {
    const f = form.elements;
    return {
      title: f.title.value.trim(),
      description: f.description.value.trim(),
      category: f.category.value,
      condition: f.condition.value,
      priceType: f.priceType.value,
      price: Number(digits(f.price.value)),
      city: f.city.value,
      area: f.area.value,
      district: f.district.value.trim(),
      name: f.name.value.trim(),
      phone: f.phone.value.trim(),
      whatsapp: f.whatsapp.checked,
      telegram: f.telegram.value.trim(),
      photos: photos.filter((p) => p.id).map((p) => p.id),
    };
  };
  const saveDraft = () => !editId && alive() && store.set('draft', read());

  const sync = () => {
    drawAreas('');
    const category = CATEGORIES.find((c) => c.id === form.elements.category.value);
    $('[data-field="condition"]', form).hidden = category ? !category.goods : false;
    $('[data-field="price"]', form).hidden = form.elements.priceType.value === 'free';
    askPrice();
  };

  // За сколько такой же товар выставляют другие. Спрашиваем, когда человек перестал печатать.
  const hint = $('.price-hint', form);
  let asked = null;
  let hintTimer;
  onLeave(() => clearTimeout(hintTimer));
  function askPrice() {
    const f = form.elements;
    const wanted = ['fixed', 'bargain'].includes(f.priceType.value) && f.category.value && f.title.value.trim().length >= LIMITS.titleMin;
    const query = wanted
      ? String(new URLSearchParams({ title: f.title.value.trim(), cat: f.category.value, cond: f.condition.value, exclude: editId || '' }))
      : '';
    if (query === asked) return;
    asked = query;
    clearTimeout(hintTimer);
    hint.hidden = true;
    if (!query) return;
    hintTimer = setTimeout(async () => {
      try {
        const found = await api(`/price-hint?${query}`);
        if (alive() && query === asked) drawHint(found);
      } catch {
        asked = null; // без подсказки можно обойтись; спросим при следующем изменении
      }
    }, 600);
  }
  function drawHint({ count, low, high, typical, otherCondition }) {
    if (!count) return;
    const range = low === high ? money(low) : `${money(low)} – ${money(high)}`;
    hint.innerHTML = `
      <p>${esc(t('priceHint'))} <strong>${esc(range)}</strong></p>
      <small>${esc(
        [typical && `${t('priceTypical')} ${money(typical)}`, `${t('priceBase')}: ${adsCount(count)}`, otherCondition && t('priceOtherState')]
          .filter(Boolean)
          .join('. ')
      )}</small>
      ${typical ? `<button type="button" class="btn small ghost">${esc(`${t('priceUse')} ${money(typical)}`)}</button>` : ''}`;
    hint.hidden = false;
    $('button', hint)?.addEventListener('click', () => {
      form.elements.price.value = spaced(typical);
      $('[data-field="price"]', form).classList.remove('bad');
      saveDraft();
    });
  }
  sync();

  form.addEventListener('input', (e) => {
    if (e.target.name === 'price') e.target.value = spaced(e.target.value);
    e.target.closest('[data-field]')?.classList.remove('bad');
    sync();
    saveDraft();
  });
  form.addEventListener('change', () => {
    sync();
    saveDraft();
  });

  const uploader = $('.uploader', form);
  const fileInput = $('input[type="file"]', form);
  const aiBox = $('.ai', form);
  const drawPhotos = () => {
    aiBox.hidden = !aiOn || !photos.some((p) => p.id);
    uploader.innerHTML =
      photos
        .map(
          (p, i) => `<figure class="thumb${p.id ? '' : ' busy'}">
            <img src="${p.preview}" alt="">
            ${i === 0 ? `<figcaption>${esc(t('cover'))}</figcaption>` : p.id ? `<button type="button" class="make-main" data-main="${i}" aria-label="${esc(t('makeMain'))}">${icon('star')}</button>` : ''}
            <button type="button" class="drop" data-drop="${i}" aria-label="${esc(t('removePhoto'))}">${icon('close')}</button>
          </figure>`
        )
        .join('') +
      (photos.length < LIMITS.photos
        ? `<button type="button" class="thumb add">${icon('camera')}<span>${esc(t('addPhoto'))}</span></button>`
        : '');
    // Черновик мог сослаться на уже удалённое фото — убираем такие.
    $$('img', uploader).forEach((img, i) => {
      img.onerror = () => {
        if (photos[i]?.id && !editId) {
          photos.splice(i, 1);
          drawPhotos();
          saveDraft();
        }
      };
    });
  };
  drawPhotos();

  uploader.addEventListener('click', (e) => {
    if (e.target.closest('.add')) return fileInput.click();
    const drop = e.target.closest('[data-drop]');
    const main = e.target.closest('[data-main]');
    if (drop) photos.splice(Number(drop.dataset.drop), 1);
    else if (main) photos.unshift(...photos.splice(Number(main.dataset.main), 1));
    else return;
    drawPhotos();
    saveDraft();
  });

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    const room = LIMITS.photos - photos.length;
    if (files.length > room) toast(t('tooMany'));
    const queue = files.slice(0, room).map((file) => ({ file, photo: { id: null, preview: URL.createObjectURL(file) } }));
    photos.push(...queue.map((q) => q.photo));
    $('[data-field="photos"]', form).classList.remove('bad');
    drawPhotos();
    for (const { file, photo } of queue) {
      if (!photos.includes(photo)) continue;
      try {
        const { full, thumb } = await compress(file);
        const body = new FormData();
        body.set('full', full, 'full');
        body.set('thumb', thumb, 'thumb');
        photo.id = (await api('/photos', { method: 'POST', body })).id;
      } catch (e) {
        const i = photos.indexOf(photo);
        if (i >= 0) photos.splice(i, 1);
        toast(e.code ? errorText(e) : t('badPhoto'));
      }
      if (!alive()) return;
      drawPhotos();
      saveDraft();
    }
  });

  // Нейросеть заполняет только пустые поля: написанное человеком не трогаем.
  const aiButton = $('[data-ai]', form);
  aiButton.addEventListener('click', async () => {
    const f = form.elements;
    const photo = photos.find((p) => p.id);
    if (!photo) return;
    if (f.title.value.trim() && f.description.value.trim() && f.category.value) return toast(t('aiFull'));
    aiButton.disabled = true;
    aiButton.classList.add('busy');
    $('span', aiButton).textContent = t('aiBusy');
    try {
      // У сохранённых фото берём полный размер, а не миниатюру.
      const image = await forAi(photo.preview.replace(/\/t$/, ''));
      const { draft: found } = await api(`/ai/draft?lang=${lang()}`, { method: 'POST', body: image });
      if (!alive()) return;
      const fill = (name, value) => {
        if (!value || f[name].value.trim()) return;
        f[name].value = value;
        f[name].closest('[data-field]')?.classList.remove('bad');
      };
      fill('title', found.title);
      fill('description', found.description);
      fill('category', found.category);
      if (found.condition && !f.condition.value) f.condition.value = found.condition;
      sync();
      saveDraft();
      toast(t('aiDone'));
    } catch (e) {
      if (!alive()) return;
      toast(e.code ? errorText(e) : t('badPhoto'));
    }
    aiButton.disabled = false;
    aiButton.classList.remove('busy');
    $('span', aiButton).textContent = t('aiFill');
  });

  const showError = (field) => {
    const box = $(`[data-field="${field}"]`, form);
    if (!box) return false;
    box.classList.add('bad');
    $('em', box).textContent = t(`e_${field}`);
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('input, select, textarea', box)?.focus({ preventScroll: true });
    return true;
  };

  function firstError(data) {
    const category = CATEGORIES.find((c) => c.id === data.category);
    if (data.title.length < LIMITS.titleMin) return 'title';
    if (!category) return 'category';
    if (category.goods && !data.condition) return 'condition';
    if (['fixed', 'bargain'].includes(data.priceType) && !data.price) return 'price';
    if (!data.city) return 'city';
    if (data.name.length < 2) return 'name';
    if (!normalizePhone(data.phone)) return 'phone';
    return null;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = $('.form-error', form);
    errorBox.textContent = '';
    if (photos.some((p) => !p.id)) return toast(t('waitPhotos'));
    const data = read();
    const bad = firstError(data);
    if (bad) return showError(bad);

    const button = $('.submit', form);
    button.disabled = true;
    button.textContent = t('publishing');
    try {
      const { id } = await api(editId ? `/listings/${editId}` : '/listings', { method: editId ? 'PUT' : 'POST', body: data });
      store.set('seller', { name: data.name, phone: data.phone, whatsapp: data.whatsapp, telegram: data.telegram, city: data.city, area: data.area, district: data.district });
      if (!editId) store.del('draft');
      toast(t(editId ? 'saved' : 'publishedOk'));
      go(`/item/${id}`, { replace: true });
    } catch (err) {
      button.disabled = false;
      button.textContent = t(editId ? 'save' : 'publish');
      if (err.code === 'login_required') {
        dropSession();
        return rerender();
      }
      if (err.field && showError(err.field)) return;
      errorBox.textContent = errorText(err);
    }
  });
}
