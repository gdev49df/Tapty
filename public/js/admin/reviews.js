// Последние отзывы: лишний можно удалить.
import { $$, esc, stars, toast } from '../ui.js';
import { empty, run, send, sure } from './common.js';

export default async function reviews(ctx) {
  const { items } = await send('/reviews');
  if (!ctx.alive()) return;
  ctx.box.innerHTML = items.length
    ? `<ul class="adm-list">${items
        .map(
          (r) => `<li class="adm-review" data-key="review-${r.id}">
            <div><p><strong>${esc(r.author)}</strong> о продавце <strong>${esc(r.seller)}</strong></p>${stars(r.rating)}
              ${r.text ? `<p class="desc">${esc(r.text)}</p>` : ''}</div>
            <button type="button" class="btn small ghost warn" data-remove="${r.id}">Удалить</button>
          </li>`
        )
        .join('')}</ul>`
    : empty('Отзывов нет.');
  $$('[data-remove]', ctx.box).forEach((button) => {
    button.onclick = () =>
      sure(button) &&
      run(button, async () => {
        await send(`/reviews/${button.dataset.remove}`, { method: 'DELETE' });
        toast('Отзыв удалён');
        ctx.done();
      });
  });
}
