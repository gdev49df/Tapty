export const now = () => Math.floor(Date.now() / 1000);
export const DAY = 86400;

export class HttpError extends Error {
  constructor(status, code, field) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}
export const fail = (status, code, field) => {
  throw new HttpError(status, code, field);
};

// Заголовки для ответов воркера. Статическим файлам такие же задаёт public/_headers.
export const GUARD = {
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'cross-origin-resource-policy': 'same-origin',
      ...GUARD,
      ...headers,
    },
  });
}

export async function readJson(request, max = 20_000) {
  // заведомо огромное тело отклоняется, не читая; символ в UTF-8 занимает до 4 байт
  if (Number(request.headers.get('content-length')) > max * 4) fail(413, 'too_large');
  const text = await request.text();
  if (text.length > max) fail(413, 'too_large');
  try {
    const data = JSON.parse(text || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'bad_json');
    return data;
  } catch {
    fail(400, 'bad_json');
  }
}

export function randomHex(bytes = 16) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function safeEqual(a, b) {
  return (await sha256(String(a))) === (await sha256(String(b)));
}

// Приведение текста для поиска: регистр кириллицы SQLite сам не понимает.
export const normalizeText = (s) =>
  String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// Счётчик «не больше limit действий за windowSec секунд».
export async function hit(env, key, limit, windowSec) {
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate.reset_at <= ?3 THEN 1 ELSE rate.count + 1 END,
       reset_at = CASE WHEN rate.reset_at <= ?3 THEN ?2 ELSE rate.reset_at END
     RETURNING count`
  )
    .bind(key, t + windowSec, t)
    .first();
  return row.count <= limit;
}

export async function limit(env, key, max, windowSec) {
  if (!(await hit(env, key, max, windowSec))) fail(429, 'rate_limit');
}

// То же для проверки секрета: место занимается до проверки, чтобы пачка одновременных попыток
// не обошла предел, и возвращается при удаче — так считаются только неудачные.
export async function attempt(env, key, max, windowSec) {
  await limit(env, key, max, windowSec);
  return () => env.DB.prepare('UPDATE rate SET count = count - 1 WHERE key = ?').bind(key).run();
}

// Для лимитов по адресу: у IPv6 один абонент получает целую сеть /64, поэтому считаем по ней.
export function network(ip) {
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail] = ip.split('::').map((part) => (part ? part.split(':') : []));
  const groups = tail ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':');
}

// Запрос по http к настоящему сайту (локальный запуск не в счёт).
export const insecure = (url) => url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
