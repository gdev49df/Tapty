import {
  CATEGORIES, CITIES, CONDITIONS, LIMITS, PRICE_TYPES, REPORT_REASONS, normalizePhone,
} from '../public/js/catalog.js';
import { DAY, fail, json, limit, hit, normalizeText, now, readJson } from './util.js';
import { deleteOrphans, deletePhotos } from './photos.js';

const PAGE = 20;
const HIDE_AFTER_REPORTS = 5;
const CARD = 'id, title, price, price_type, city, district, condition, photos, bumped_at';

const parsePhotos = (row) => {
  try {
    return JSON.parse(row.photos);
  } catch {
    return [];
  }
};

const card = (row) => ({
  id: row.id,
  title: row.title,
  price: row.price,
  priceType: row.price_type,
  city: row.city,
  district: row.district,
  condition: row.condition,
  bumpedAt: row.bumped_at,
  photo: parsePhotos(row)[0] || null,
});

const publicStatus = (row) =>
  row.status === 'active' && row.expires_at <= now() ? 'expired' : row.status;

const detail = (row) => ({
  ...card(row),
  description: row.description,
  category: row.category,
  name: row.name,
  photos: parsePhotos(row),
  status: publicStatus(row),
  views: row.views,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

const own = (row) => ({
  ...detail(row),
  phone: row.phone,
  whatsapp: Boolean(row.whatsapp),
  telegram: row.telegram,
});

export async function listListings(env, url) {
  const p = url.searchParams;
  const where = ["status = 'active'", 'expires_at > ?'];
  const args = [now()];

  if (p.has('ids')) {
    const ids = p.get('ids').split(',').map(Number).filter(Number.isInteger).slice(0, 60);
    if (!ids.length) return json({ items: [], next: null });
    const { results } = await env.DB.prepare(
      `SELECT ${CARD} FROM listings WHERE id IN (${ids.map(() => '?').join(',')}) AND ${where.join(' AND ')}`
    )
      .bind(...ids, ...args)
      .all();
    const byId = new Map(results.map((r) => [r.id, card(r)]));
    return json({ items: ids.map((id) => byId.get(id)).filter(Boolean), next: null });
  }

  const add = (sql, value) => {
    where.push(sql);
    args.push(value);
  };
  if (CATEGORIES.some((c) => c.id === p.get('cat'))) add('category = ?', p.get('cat'));
  if (CITIES.some((c) => c.id === p.get('city'))) add('city = ?', p.get('city'));
  if (CONDITIONS.includes(p.get('cond'))) add('condition = ?', p.get('cond'));
  if (PRICE_TYPES.includes(p.get('type'))) add('price_type = ?', p.get('type'));
  for (const [key, sql] of [['min', 'price >= ?'], ['max', 'price <= ?']]) {
    const n = Number(p.get(key));
    if (p.get(key) && Number.isFinite(n) && n >= 0) add(sql, Math.floor(n));
  }
  const words = normalizeText(p.get('q')).slice(0, 80).split(' ').filter(Boolean).slice(0, 5);
  for (const w of words) add('instr(search, ?) > 0', w);

  const order =
    { cheap: 'price ASC, id DESC', expensive: 'price DESC, id DESC' }[p.get('sort')] ||
    'bumped_at DESC, id DESC';
  const offset = Math.min(Math.max(parseInt(p.get('offset'), 10) || 0, 0), 5000);

  const { results } = await env.DB.prepare(
    `SELECT ${CARD} FROM listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${offset}`
  )
    .bind(...args)
    .all();
  return json({
    items: results.slice(0, PAGE).map(card),
    next: results.length > PAGE ? offset + PAGE : null,
  });
}

async function findRow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  if (!row) fail(404, 'not_found');
  return row;
}

async function findOwn(env, id, owner) {
  const row = await findRow(env, id);
  if (row.owner !== owner) fail(404, 'not_found');
  return row;
}

export async function getListing(env, ctx, id, { owner, ip }) {
  const row = await findRow(env, id);
  const mine = owner === row.owner;
  if (row.status === 'hidden' && !mine) fail(404, 'not_found');
  if (!mine) {
    ctx.waitUntil(
      hit(env, `view:${id}:${ip}`, 1, DAY).then(
        (first) => first && env.DB.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').bind(id).run()
      )
    );
  }
  return json({ item: { ...detail(row), mine } });
}

export async function getContact(env, id, { ip }) {
  await limit(env, `contact:${ip}`, 120, 3600);
  const row = await findRow(env, id);
  if (publicStatus(row) !== 'active') fail(410, 'not_active');
  return json({ phone: row.phone, whatsapp: Boolean(row.whatsapp), telegram: row.telegram, name: row.name });
}

export async function listMine(env, { owner }) {
  if (!owner) fail(401, 'no_key');
  const { results } = await env.DB.prepare(
    'SELECT * FROM listings WHERE owner = ? ORDER BY created_at DESC LIMIT 100'
  )
    .bind(owner)
    .all();
  return json({ items: results.map(own) });
}

export async function getMine(env, id, { owner }) {
  return json({ item: own(await findOwn(env, id, owner)) });
}

function validate(body) {
  const str = (key, max, min = 0) => {
    const v = String(body[key] ?? '').replace(/\r/g, '').trim();
    if (v.length < min || v.length > max) fail(400, 'invalid', key);
    return v;
  };
  const oneOf = (key, list) => (list.includes(body[key]) ? body[key] : fail(400, 'invalid', key));

  const title = str('title', LIMITS.titleMax, LIMITS.titleMin).replace(/\s+/g, ' ');
  const category = oneOf('category', CATEGORIES.map((c) => c.id));
  const priceType = oneOf('priceType', PRICE_TYPES);
  let price = Math.floor(Number(body.price || 0));
  if (!Number.isFinite(price) || price < 0 || price > LIMITS.priceMax) fail(400, 'invalid', 'price');
  if (priceType === 'free') price = 0;
  if ((priceType === 'fixed' || priceType === 'bargain') && price <= 0) fail(400, 'invalid', 'price');
  const goods = CATEGORIES.find((c) => c.id === category).goods;

  const phone = normalizePhone(body.phone) || fail(400, 'invalid', 'phone');
  const telegram = String(body.telegram ?? '').trim().replace(/^(https?:\/\/)?(t\.me\/)?@?/i, '');
  if (telegram && !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(telegram)) fail(400, 'invalid', 'telegram');

  const photos = Array.isArray(body.photos) ? [...new Set(body.photos)] : [];
  if (photos.length > LIMITS.photos || !photos.every((id) => /^[a-f0-9]{24}$/.test(id))) {
    fail(400, 'invalid', 'photos');
  }
  const description = str('description', LIMITS.descMax);

  return {
    title,
    description,
    search: normalizeText(`${title} ${description}`),
    price,
    price_type: priceType,
    condition: goods ? oneOf('condition', CONDITIONS) : null,
    category,
    city: oneOf('city', CITIES.map((c) => c.id)),
    district: str('district', LIMITS.districtMax),
    name: str('name', LIMITS.nameMax, 2),
    phone,
    whatsapp: body.whatsapp ? 1 : 0,
    telegram,
    photos,
  };
}

async function checkPhotos(env, ids, owner, listingId) {
  if (!ids.length) return;
  const { results } = await env.DB.prepare(
    `SELECT id FROM photos WHERE id IN (${ids.map(() => '?').join(',')}) AND owner = ?
     AND (listing_id IS NULL OR listing_id = ?)`
  )
    .bind(...ids, owner, listingId)
    .all();
  if (results.length !== ids.length) fail(400, 'photos_lost', 'photos');
}

async function checkSeller(env, owner, phone, exceptId) {
  const banned = await env.DB.prepare('SELECT 1 FROM bans WHERE value IN (?, ?)').bind(owner, phone).first();
  if (banned) fail(403, 'banned');
  const { total } = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM listings WHERE phone = ? AND status = 'active' AND expires_at > ? AND id != ?"
  )
    .bind(phone, now(), exceptId)
    .first();
  if (total >= 20) fail(429, 'too_many_active');
}

const attach = (env, ids, listingId) =>
  env.DB.prepare(`UPDATE photos SET listing_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(listingId, ...ids)
    .run();

export async function createListing(request, env, ctx, who) {
  const data = validate(await readJson(request));
  if (!who.owner) fail(401, 'no_key');
  if (env.BOT_TOKEN && !who.user) fail(401, 'login_required');
  await checkSeller(env, who.owner, data.phone, 0);
  await checkPhotos(env, data.photos, who.owner, 0);
  await limit(env, `new:${who.owner}`, 10, 3600);
  await limit(env, `new:${who.ip}`, 40, DAY);

  const t = now();
  const row = { ...data, photos: JSON.stringify(data.photos), owner: who.owner, created_at: t, bumped_at: t, expires_at: t + LIMITS.days * DAY };
  const keys = Object.keys(row);
  const { id } = await env.DB.prepare(
    `INSERT INTO listings (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) RETURNING id`
  )
    .bind(...keys.map((k) => row[k]))
    .first();
  if (data.photos.length) await attach(env, data.photos, id);
  ctx.waitUntil(cleanup(env));
  return json({ id }, 201);
}

export async function updateListing(request, env, id, who) {
  const old = await findOwn(env, id, who.owner);
  if (old.status === 'hidden') fail(403, 'hidden');
  const data = validate(await readJson(request));
  await checkSeller(env, who.owner, data.phone, id);
  await checkPhotos(env, data.photos, who.owner, id);
  await limit(env, `edit:${who.owner}`, 60, 3600);

  const row = { ...data, photos: JSON.stringify(data.photos), approved: 0 };
  const keys = Object.keys(row);
  await env.DB.prepare(`UPDATE listings SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`)
    .bind(...keys.map((k) => row[k]), id)
    .run();
  if (data.photos.length) await attach(env, data.photos, id);
  await deletePhotos(env, parsePhotos(old).filter((p) => !data.photos.includes(p)));
  return json({ id });
}

export async function setStatus(request, env, id, who) {
  const row = await findOwn(env, id, who.owner);
  if (row.status === 'hidden') fail(403, 'hidden');
  const { action } = await readJson(request);
  const t = now();
  if (action === 'sold') {
    // expires_at хранит момент продажи + 60 дней: после этого объявление удаляется.
    await env.DB.prepare("UPDATE listings SET status = 'sold', expires_at = ? WHERE id = ?")
      .bind(t + 60 * DAY, id)
      .run();
  } else if (action === 'restore' || action === 'extend') {
    await checkSeller(env, who.owner, row.phone, id);
    // Наверх ленты поднимаются только объявления, у которых закончился срок.
    const bump = publicStatus(row) === 'expired';
    await env.DB.prepare(
      "UPDATE listings SET status = 'active', expires_at = ?, bumped_at = CASE WHEN ? THEN ? ELSE bumped_at END WHERE id = ?"
    )
      .bind(t + LIMITS.days * DAY, bump ? 1 : 0, t, id)
      .run();
  } else fail(400, 'invalid', 'action');
  return json({ ok: true });
}

export async function removeRow(env, row) {
  await deletePhotos(env, parsePhotos(row));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reports WHERE listing_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(row.id),
  ]);
}

export async function deleteListing(env, id, who) {
  const row = await findOwn(env, id, who.owner);
  // Скрытое модератором объявление нельзя стереть вместе с жалобами.
  if (row.status === 'hidden') fail(403, 'hidden');
  await removeRow(env, row);
  return json({ ok: true });
}

export async function reportListing(request, env, id, { ip }) {
  const { reason } = await readJson(request);
  if (!REPORT_REASONS.includes(reason)) fail(400, 'invalid', 'reason');
  await limit(env, `report:${ip}`, 10, DAY);
  const row = await findRow(env, id);
  await env.DB.prepare('INSERT OR IGNORE INTO reports (listing_id, reporter, reason, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, ip, reason, now())
    .run();
  const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM reports WHERE listing_id = ?').bind(id).first();
  if (total >= HIDE_AFTER_REPORTS && !row.approved) {
    await env.DB.prepare("UPDATE listings SET status = 'hidden' WHERE id = ?").bind(id).run();
  }
  return json({ ok: true });
}

export async function adminReports(env) {
  const { results } = await env.DB.prepare(
    `SELECT l.*, COUNT(r.reporter) AS total, GROUP_CONCAT(r.reason) AS reasons
     FROM listings l LEFT JOIN reports r ON r.listing_id = l.id
     GROUP BY l.id HAVING total > 0 OR l.status = 'hidden'
     ORDER BY total DESC, l.id DESC LIMIT 40`
  ).all();
  return json({ items: results.map((r) => ({ ...own(r), reports: r.total, reasons: r.reasons || '' })) });
}

export async function adminAction(request, env, id) {
  const { action } = await readJson(request);
  const row = await findRow(env, id);
  if (action === 'hide') {
    await env.DB.prepare("UPDATE listings SET status = 'hidden', approved = 0 WHERE id = ?").bind(id).run();
  } else if (action === 'approve') {
    await env.DB.batch([
      env.DB.prepare("UPDATE listings SET status = 'active', approved = 1 WHERE id = ?").bind(id),
      env.DB.prepare('DELETE FROM reports WHERE listing_id = ?').bind(id),
    ]);
  } else if (action === 'delete') {
    await removeRow(env, row);
  } else if (action === 'ban') {
    const t = now();
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO bans (value, created_at) VALUES (?, ?)').bind(row.phone, t),
      env.DB.prepare('INSERT OR IGNORE INTO bans (value, created_at) VALUES (?, ?)').bind(row.owner, t),
      env.DB.prepare("UPDATE listings SET status = 'hidden', approved = 0 WHERE phone = ? OR owner = ?").bind(row.phone, row.owner),
    ]);
  } else fail(400, 'invalid', 'action');
  return json({ ok: true });
}

// Фоновая уборка понемногу: черновые фото, старые счётчики, давно закрытые объявления.
async function cleanup(env) {
  if (Math.random() > 0.1) return;
  const t = now();
  await deleteOrphans(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate WHERE reset_at < ?').bind(t),
    env.DB.prepare('DELETE FROM logins WHERE created_at < ?').bind(t - 3600),
  ]);
  const { results } = await env.DB.prepare(
    "SELECT * FROM listings WHERE status != 'hidden' AND expires_at < CASE status WHEN 'sold' THEN ? ELSE ? END LIMIT 5"
  )
    .bind(t, t - 60 * DAY)
    .all();
  for (const row of results) await removeRow(env, row);
}
