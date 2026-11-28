import { api, auth } from '../api.js';
import { authForm } from '../auth.js';
import { t } from '../i18n.js';
import { favorites } from '../favorites.js';
import { $, $$, emptyState, esc, feed, wasCheaper } from '../ui.js';

export default function fav({ root, alive, rerender, onLeave }) {
  root.innerHTML = `<div class="page-head wide"><h1>${esc(t('fav'))}</h1></div>`;
  if (!auth.signedIn()) {
    root.insertAdjacentHTML('beforeend', '<div class="narrow login-slot"></div>');
    authForm($('.login-slot', root), { note: t('authFav'), onDone: rerender });
    return;
  }
  root.insertAdjacentHTML(
    'beforeend',
    `<div class="chips fav-views" role="group" aria-label="${esc(t('filters'))}" hidden></div><div class="feed"></div><p class="muted small center" hidden>${esc(t('favGone'))}</p>`
  );
  // «Подешевели» — только когда среди избранного такие есть; лишнее прячется без нового запроса.
  const views = $('.fav-views', root);
  const showViews = (items) => {
    const dropped = items.filter(wasCheaper).length;
    views.hidden = !dropped;
    views.innerHTML = [['', t('favAll')], ['drop', `${t('favDropped')}: ${dropped}`]]
      .map(([id, name]) => `<button type="button" class="chip" data-view="${id}" aria-pressed="${!id}">${esc(name)}</button>`)
      .join('');
    $('.feed', root).classList.remove('only-drop');
  };
  views.onclick = (e) => {
    const chip = e.target.closest('[data-view]');
    if (!chip) return;
    $$('[data-view]', views).forEach((b) => b.setAttribute('aria-pressed', b === chip));
    $('.feed', root).classList.toggle('only-drop', chip.dataset.view === 'drop');
  };
  const empty = emptyState(t('emptyFav'), t('emptyFavHint'), `<a class="btn" href="/">${esc(t('toHome'))}</a>`);
  const load = async () => {
    // без сети показываем то, что уже было загружено
    await favorites.sync().catch((e) => {
      if (!favorites.list().length) throw e;
    });
    const ids = favorites.list();
    if (!ids.length) return { items: [], next: null };
    const data = await api(`/listings?ids=${ids.join(',')}`);
    if (alive()) {
      $('.center', root).hidden = false;
      showViews(data.items);
    }
    return data;
  };
  onLeave(feed($('.feed', root), load, { alive, empty }));
}
