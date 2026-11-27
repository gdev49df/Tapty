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

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export async function readJson(request, max = 20_000) {
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
