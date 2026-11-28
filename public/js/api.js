import { store } from './store.js';

const randomKey = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const auth = {
  // Ключ устройства: по нему узнаются объявления, поданные без аккаунта.
  deviceKey() {
    let key = store.get('key');
    if (!key) store.set('key', (key = randomKey()));
    return key;
  },
  token: () => store.get('session') || auth.deviceKey(),
  signedIn: () => Boolean(store.get('session')),
};

// Шапка и меню узнают о входе и выходе по этому событию.
const changed = () => dispatchEvent(new Event('tapty:auth'));

export function setSession({ token }) {
  store.set('session', token);
  changed();
}

export function dropSession() {
  if (!auth.signedIn()) return;
  store.del('session');
  store.del('favs');
  changed();
}

export async function signOut() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  // Черновик и контакты принадлежат вышедшему человеку.
  store.del('seller');
  store.del('draft');
  dropSession();
}

// Аккаунт удалён: на устройстве не остаётся ничего из того, что с ним связано.
export function forgetAccount() {
  for (const name of ['seller', 'draft', 'key']) store.del(name);
  // и сохранённые для работы без интернета объявления и фото
  globalThis.caches
    ?.keys()
    .then((names) => Promise.all(names.filter((n) => /^(data|photos)-/.test(n)).map((n) => caches.delete(n))))
    .catch(() => {});
  dropSession();
}

export class ApiError extends Error {
  constructor(status, code, field) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const init = { method, signal, headers: { authorization: `Bearer ${auth.token()}`, ...headers } };
  if (body instanceof FormData || body instanceof Blob) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  try {
    return await fetch(`/api${path}`, init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network');
  }
}

export async function api(path, options) {
  const res = await request(path, options);
  const data = await res.json().catch(() => null);
  // Сессия больше не действует.
  if (data?.error === 'login_required') dropSession();
  // На сайте идут технические работы: об этом узнаёт экран-заглушка.
  if (data?.error === 'maintenance') dispatchEvent(new Event('tapty:maintenance'));
  if (!res.ok || !data) throw new ApiError(res.status, data?.error || 'server', data?.field);
  return data;
}

// Файл, который виден только вошедшему: обычный <img src> не передал бы ключ.
export async function apiBlob(path, options) {
  const res = await request(path, options);
  if (!res.ok) throw new ApiError(res.status, 'server');
  return res.blob();
}

let configPromise = null;
export function config() {
  configPromise ??= api('/config').catch((e) => {
    configPromise = null;
    throw e;
  });
  return configPromise;
}

export function refreshConfig() {
  configPromise = null;
  return config();
}

// Вошедший пользователь; протухшую сессию убираем.
export async function currentUser() {
  if (!auth.signedIn()) return null;
  const { user } = await api('/me');
  if (!user) dropSession();
  return user;
}
