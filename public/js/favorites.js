// Избранное принадлежит аккаунту. Здесь — копия списка, чтобы сердечки рисовались сразу.
import { api, auth } from './api.js';
import { store } from './store.js';

// Ещё не подтверждённые сервером нажатия.
const pending = new Map();
let queue = Promise.resolve();

const changed = () => dispatchEvent(new Event('tapty:fav'));

// Запросы идут по очереди: ответ на старый не должен затирать новый.
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

function save(ids, session) {
  // пока шёл запрос, могли выйти из аккаунта
  if (store.get('session') === session) store.set('favs', ids);
}

export const favorites = {
  list() {
    if (!auth.signedIn()) return [];
    const ids = new Set(store.get('favs', []));
    for (const [id, on] of pending) {
      if (on) ids.add(id);
      else ids.delete(id);
    }
    return [...ids];
  },
  has: (id) => favorites.list().includes(id),

  set(id, on) {
    pending.set(id, on);
    changed();
    return enqueue(async () => {
      const session = store.get('session');
      try {
        const { ids } = await api(`/favorites/${id}`, { method: on ? 'PUT' : 'DELETE' });
        save(ids, session);
      } finally {
        if (pending.get(id) === on) pending.delete(id);
        changed();
      }
    });
  },

  sync() {
    return enqueue(async () => {
      const session = store.get('session');
      if (!session) return;
      // отметки, сделанные на этом устройстве раньше, переносим в аккаунт один раз
      const old = store.get('fav', []);
      const { ids } = old.length ? await api('/favorites', { method: 'POST', body: { ids: old } }) : await api('/favorites');
      store.del('fav');
      save(ids, session);
      changed();
    });
  },
};
