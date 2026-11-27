import { store } from './store.js';

const randomKey = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const auth = {
  deviceKey() {
    let key = store.get('key');
    if (!key) store.set('key', (key = randomKey()));
    return key;
  },
  token: () => store.get('session') || auth.deviceKey(),
};

export class ApiError extends Error {
  constructor(status, code, field) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const init = { method, signal, headers: { authorization: `Bearer ${auth.token()}`, ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new ApiError(res.status, data?.error || 'server', data?.field);
  return data;
}

let configPromise = null;
export function config() {
  configPromise ??= api('/config').catch((e) => {
    configPromise = null;
    throw e;
  });
  return configPromise;
}

// Текущий пользователь Telegram; протухшую сессию убираем.
export async function currentUser() {
  if (!store.get('session')) return null;
  const { user } = await api('/me');
  if (!user) store.del('session');
  return user;
}
