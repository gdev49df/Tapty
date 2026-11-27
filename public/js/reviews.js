// Форма отзыва: на странице продавца и из переписки.
import { api } from './api.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, errorText, esc, toast } from './ui.js';

export function reviewForm(root, { path, review, onDone }) {
  root.innerHTML = `
    <form class="form review-form" novalidate>
      <fieldset><legend>${esc(t('reviewRate'))}</legend>
        <div class="rate">${[1, 2, 3, 4, 5]
          .map((n) => `<label><input type="radio" name="rating" value="${n}" aria-label="${n} / 5"${review?.rating === n ? ' checked' : ''}>${icon('star')}</label>`)
          .join('')}</div>
      </fieldset>
      <textarea class="input" name="text" rows="3" maxlength="600" aria-label="${esc(t('reviewWrite'))}" placeholder="${esc(t('reviewText'))}">${esc(review?.text || '')}</textarea>
      <button class="btn wide">${esc(t('reviewSend'))}</button>
      ${review ? `<button type="button" class="link-btn" data-remove>${esc(t('reviewRemove'))}</button>` : ''}
    </form>`;
  const form = $('form', root);
  const labels = [...form.querySelectorAll('.rate label')];
  const paint = () => {
    const value = Number(new FormData(form).get('rating'));
    labels.forEach((l, i) => l.classList.toggle('on', i < value));
  };
  form.addEventListener('change', paint);
  paint();

  const run = async (request, message) => {
    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => (b.disabled = true));
    try {
      await request();
      toast(message);
      onDone();
    } catch (e) {
      buttons.forEach((b) => (b.disabled = false));
      toast(errorText(e));
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const rating = Number(data.get('rating'));
    if (!rating) return toast(t('reviewPick'));
    run(() => api(path, { method: 'POST', body: { rating, text: String(data.get('text')) } }), t('reviewSaved'));
  };
  $('[data-remove]', form)?.addEventListener('click', () => run(() => api(path, { method: 'DELETE' }), t('removed')));
}
