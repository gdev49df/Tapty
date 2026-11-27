import { api } from '../api.js';
import { t } from '../i18n.js';
import { favorites } from '../store.js';
import { $, emptyState, esc, feed } from '../ui.js';

export default function fav({ root, alive, onLeave }) {
  const ids = favorites.list();
  root.innerHTML = `<div class="page-head"><h1>${esc(t('fav'))}</h1></div><div class="feed"></div>${
    ids.length ? `<p class="muted small center">${esc(t('favGone'))}</p>` : ''
  }`;
  const empty = emptyState(t('emptyFav'), t('emptyFavHint'), `<a class="btn" href="/">${esc(t('toHome'))}</a>`);
  onLeave(
    feed($('.feed', root), () => api(`/listings?ids=${ids.join(',')}`), {
      alive,
      empty,
      state: { items: [], next: ids.length ? 0 : null },
    })
  );
}
