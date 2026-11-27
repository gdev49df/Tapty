// localStorage может быть недоступен (приватный режим) — тогда держим всё в памяти.
const memory = new Map();

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`tapty:${key}`);
      if (raw !== null) return JSON.parse(raw);
    } catch {}
    return memory.has(key) ? memory.get(key) : fallback;
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(`tapty:${key}`, JSON.stringify(value));
    } catch {}
  },
  del(key) {
    memory.delete(key);
    try {
      localStorage.removeItem(`tapty:${key}`);
    } catch {}
  },
};

export const favorites = {
  list: () => store.get('fav', []),
  has: (id) => favorites.list().includes(id),
  toggle(id) {
    const list = favorites.list();
    const on = !list.includes(id);
    store.set('fav', on ? [id, ...list].slice(0, 60) : list.filter((x) => x !== id));
    return on;
  },
};
