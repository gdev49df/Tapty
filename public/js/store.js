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
