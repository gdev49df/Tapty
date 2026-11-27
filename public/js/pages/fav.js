import { api, auth } from '../api.js';
import { authForm } from '../auth.js';
import { t } from '../i18n.js';
import { favorites } from '../favorites.js';
import { $, emptyState, esc, feed } from '../ui.js';

export default function fav({ root, alive, rerender, onLeave }) {
  root.innerHTML = `<div class="page-head"><h1>${esc(t('fav'))}</h1></div>`;
  if (!auth.signedIn()) {
    root.insertAdjacentHTML('beforeend', '<div class="narrow login-slot"></div>');
    authForm($('.login-slot', root), { note: t('authFav'), onDone: rerender });
    return;
  }
  root.insertAdjacentHTML('beforeend', `<div class="feed"></div><p class="muted small center" hidden>${esc(t('favGone'))}</p>`);
  const empty = emptyState(t('emptyFav'), t('emptyFavHint'), `<a class="btn" href="/">${esc(t('toHome'))}</a>`);
  const load = async () => {
    // без сети показываем то, что уже было загружено
    await favorites.sync().catch((e) => {
      if (!favorites.list().length) throw e;
    });
    const ids = favorites.list();
    if (!ids.length) return { items: [], next: null };
    const data = await api(`/listings?ids=${ids.join(',')}`);
    if (alive()) $('.center', root).hidden = false;
    return data;
  };
  onLeave(feed($('.feed', root), load, { alive, empty }));
}
