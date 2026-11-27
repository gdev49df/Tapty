// Фото лежат в D1. Если подключить R2 с биндингом PHOTOS, новые фото пойдут туда,
// а старые продолжат отдаваться из базы.
import { LIMITS } from '../public/js/catalog.js';
import { DAY, fail, json, limit, now, randomHex } from './util.js';

function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const tag = (from) => String.fromCharCode(...bytes.subarray(from, from + 4));
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'image/webp';
  return null;
}

async function readPart(form, name, max) {
  const file = form.get(name);
  if (!file || typeof file === 'string') fail(400, 'bad_photo');
  if (file.size > max) fail(413, 'photo_too_large');
  const buf = await file.arrayBuffer();
  const mime = sniff(new Uint8Array(buf, 0, Math.min(buf.byteLength, 16)));
  if (!mime) fail(400, 'bad_photo');
  return { buf, mime };
}

export async function uploadPhoto(request, env, { owner, ip }) {
  await limit(env, `up:${ip}`, 200, 3600);
  await limit(env, `up:${owner}`, 60, 3600);
  return json({ id: await storePhoto(request, env, owner) }, 201);
}

// chatId задан у снимков из переписки: их видят только участники диалога.
export async function storePhoto(request, env, owner, chatId = null) {
  if (Number(request.headers.get('content-length') || 0) > 1_200_000) fail(413, 'photo_too_large');
  const form = await request.formData().catch(() => fail(400, 'bad_photo'));
  const full = await readPart(form, 'full', LIMITS.fullBytes);
  const thumb = await readPart(form, 'thumb', LIMITS.thumbBytes);
  if (full.mime !== thumb.mime) fail(400, 'bad_photo');

  const id = randomHex(12);
  const inR2 = Boolean(env.PHOTOS);
  if (inR2) {
    await env.PHOTOS.put(`${id}/full`, full.buf);
    await env.PHOTOS.put(`${id}/thumb`, thumb.buf);
  }
  await env.DB.prepare(
    'INSERT INTO photos (id, owner, mime, full, thumb, created_at, chat_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, owner, full.mime, inR2 ? null : full.buf, inR2 ? null : thumb.buf, now(), chatId)
    .run();
  return id;
}

// Ответ с картинкой из базы или R2; null, если файла нет.
export async function photoResponse(env, id, variant, row, cache) {
  const column = variant === 'thumb' ? 'thumb' : 'full';
  let body;
  if (row.data) body = new Uint8Array(row.data);
  else if (env.PHOTOS) body = (await env.PHOTOS.get(`${id}/${column}`))?.body;
  if (!body) return null;
  return new Response(body, {
    headers: { 'content-type': row.mime, 'cache-control': cache, 'x-content-type-options': 'nosniff' },
  });
}

export async function servePhoto(request, env, ctx, id, variant) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const column = variant === 'thumb' ? 'thumb' : 'full';
  // Снимки из переписки по открытому адресу не отдаются.
  const row = await env.DB.prepare(`SELECT mime, ${column} AS data FROM photos WHERE id = ? AND chat_id IS NULL`)
    .bind(id)
    .first();
  const response = row && (await photoResponse(env, id, variant, row, 'public, max-age=31536000, immutable'));
  if (!response) return new Response('Not found', { status: 404 });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

export async function deletePhotos(env, ids) {
  if (!ids.length) return;
  if (env.PHOTOS) await env.PHOTOS.delete(ids.flatMap((id) => [`${id}/full`, `${id}/thumb`]));
  const marks = ids.map(() => '?').join(',');
  await env.DB.prepare(`DELETE FROM photos WHERE id IN (${marks})`).bind(...ids).run();
}

// Незавершённые черновики: фото без объявления старше двух суток.
export async function deleteOrphans(env) {
  const { results } = await env.DB.prepare(
    'SELECT id FROM photos WHERE listing_id IS NULL AND chat_id IS NULL AND created_at < ? LIMIT 40'
  )
    .bind(now() - 2 * DAY)
    .all();
  await deletePhotos(env, results.map((r) => r.id));
}
