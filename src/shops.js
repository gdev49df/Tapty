// Магазины: пользователь подаёт заявку, модератор открывает магазин или отклоняет её.
// В магазине показываются все активные объявления его владельца.
// Статусы: pending — ждёт проверки, approved — открыт, rejected — отклонён, closed — закрыт модератором.
import { CITIES, LEGAL_VERSION, LIMITS, normalizePhone } from '../public/js/catalog.js';
import { DAY, fail, json, limit, normalizeText, now, readJson } from './util.js';
import { requireUser } from './auth.js';
import { deletePhotos } from './photos.js';
import { sellerAds, sellerInfo } from './listings.js';

// Одно и то же название с другими пробелами, точками или регистром считается занятым.
const nameKey = (name) => normalizeText(name).replace(/[^\p{L}\p{N}]/gu, '');

const view = (row) => ({
  id: row.id,
  name: row.name,
  about: row.about,
  city: row.city,
  address: row.address,
  hours: row.hours,
  logo: row.logo || null,
  since: row.created_at,
});

const own = (row) => ({ ...view(row), phone: row.phone, status: row.status, note: row.note, consent: row.consent_version });

function validate(body) {
  const str = (key, field, max, min = 0) => {
    const v = String(body[key] ?? '').replace(/\r/g, '').trim();
    if (v.length < min || v.length > max) fail(400, 'invalid', field);
    return v;
  };
  const name = str('name', 'shopName', LIMITS.shopNameMax, 2).replace(/\s+/g, ' ');
  if (nameKey(name).length < 2) fail(400, 'invalid', 'shopName');
  const about = str('about', 'about', LIMITS.shopAboutMax, LIMITS.shopAboutMin);
  const city = CITIES.some((c) => c.id === body.city) ? body.city : fail(400, 'invalid', 'city');
  const logo = String(body.logo || '');
  if (logo && !/^[a-f0-9]{24}$/.test(logo)) fail(400, 'invalid', 'logo');
  return {
    name,
    name_key: nameKey(name),
    about,
    city,
    address: str('address', 'address', LIMITS.addressMax).replace(/\s+/g, ' '),
    hours: str('hours', 'hours', LIMITS.hoursMax).replace(/\s+/g, ' '),
    phone: normalizePhone(body.phone) || fail(400, 'invalid', 'phone'),
    logo,
  };
}

const findByOwner = (env, owner) => env.DB.prepare('SELECT * FROM shops WHERE owner = ?').bind(owner).first();
const nameTaken = () => fail(409, 'shop_name_taken', 'shopName');

export async function getMyShop(env, { user, owner }) {
  if (!user) fail(401, 'login_required');
  const row = await findByOwner(env, owner);
  return json({ shop: row ? own(row) : null });
}

// Подать заявку или изменить свой магазин. У открытого магазина название не меняется,
// отклонённая заявка после правки снова уходит на проверку.
export async function saveShop(request, env, who) {
  const body = await readJson(request);
  await requireUser(env, who);
  const data = validate(body);
  const { owner, ip } = who;
  if (await env.DB.prepare('SELECT 1 FROM bans WHERE value = ?').bind(data.phone).first()) fail(403, 'banned');
  const old = await findByOwner(env, owner);
  if (old?.status === 'closed') fail(403, 'shop_closed');
  if (old?.status === 'approved' && data.name !== old.name) fail(400, 'shop_name_locked', 'shopName');
  // Данные магазина публикуются, поэтому на них берётся согласие с действующей редакцией документов.
  const consent = old?.consent_version !== LEGAL_VERSION;
  if (consent && body.consent !== LEGAL_VERSION) fail(400, 'consent');
  await limit(env, `shop:${owner}`, 20, DAY);
  await limit(env, `shop-ip:${ip}`, 60, DAY);
  if (data.logo) {
    const photo = await env.DB.prepare('SELECT 1 FROM photos WHERE id = ? AND owner = ? AND chat_id IS NULL AND listing_id IS NULL')
      .bind(data.logo, owner)
      .first();
    if (!photo) fail(400, 'photos_lost', 'logo');
  }
  const busy = await env.DB.prepare("SELECT 1 FROM shops WHERE name_key = ? AND status != 'rejected' AND owner != ?")
    .bind(data.name_key, owner)
    .first();
  if (busy) nameTaken();

  const t = now();
  const row = {
    ...data,
    status: old?.status === 'approved' ? 'approved' : 'pending',
    note: '',
    updated_at: t,
    ...(consent && { consent_at: t, consent_version: LEGAL_VERSION }),
  };
  const keys = Object.keys(row);
  const values = keys.map((k) => row[k]);
  try {
    if (old) {
      // статус в условии: если модератор успел принять решение, правка его не перезапишет
      const done = await env.DB.prepare(`UPDATE shops SET ${keys.map((k) => `${k} = ?`).join(',')}, rev = rev + 1 WHERE owner = ? AND rev = ?`)
        .bind(...values, owner, old.rev)
        .run();
      if (!done.meta.changes) fail(409, 'shop_changed');
    } else {
      await env.DB.prepare(`INSERT INTO shops (owner, created_at, ${keys.join(',')}) VALUES (?, ?, ${keys.map(() => '?').join(',')})`)
        .bind(owner, t, ...values)
        .run();
    }
  } catch (e) {
    // два одновременных запроса: название или сам магазин уже заняты
    if (/UNIQUE.*name_key/i.test(e.message)) nameTaken();
    if (/UNIQUE.*owner/i.test(e.message)) fail(409, 'shop_changed');
    throw e;
  }
  const saved = await findByOwner(env, owner);
  if (data.logo) await env.DB.prepare('UPDATE photos SET shop_id = ? WHERE id = ?').bind(saved.id, data.logo).run();
  if (old?.logo && old.logo !== data.logo) await deletePhotos(env, [old.logo]);
  return json({ shop: own(saved) }, old ? 200 : 201);
}

export async function deleteShop(env, { user, owner }) {
  if (!user) fail(401, 'login_required');
  const row = await findByOwner(env, owner);
  if (!row) fail(404, 'not_found');
  // Закрытый модератором магазин нельзя удалить и тут же подать заново.
  if (row.status === 'closed') fail(403, 'shop_closed');
  if (row.logo) await deletePhotos(env, [row.logo]);
  await env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(row.id).run();
  return json({ ok: true });
}

// Магазин виден всем, только пока открыт, а владелец и номер не заблокированы.
async function findOpen(env, id) {
  const row = await env.DB.prepare(
    `SELECT * FROM shops s WHERE id = ? AND status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM bans WHERE value IN (s.owner, s.phone))`
  )
    .bind(id)
    .first();
  if (!row) fail(404, 'not_found');
  return row;
}

export async function shopPage(env, id, { owner }) {
  const row = await findOpen(env, id);
  const [info, items] = await Promise.all([sellerInfo(env, row.owner), sellerAds(env, row.owner)]);
  const { rating, reviews, verified, count } = info;
  return json({ shop: { ...view(row), mine: owner === row.owner }, seller: { rating, reviews, verified, count }, items });
}

// Номер отдаётся по нажатию, с теми же пределами, что и номера из объявлений.
export async function shopContact(env, id, { ip }) {
  await limit(env, `contact:${ip}`, 120, 3600);
  await limit(env, `contact-day:${ip}`, 400, DAY);
  const row = await findOpen(env, id);
  return json({ phone: row.phone });
}

export async function adminShops(env) {
  const select = (where, order) =>
    env.DB.prepare(
      `SELECT s.*, u.login, u.name AS person,
         (SELECT COUNT(*) FROM listings l WHERE l.owner = s.owner AND l.status = 'active' AND l.expires_at > ?) AS ads
       FROM shops s LEFT JOIN users u ON u.id = s.owner WHERE ${where} ORDER BY ${order} LIMIT 50`
    )
      .bind(now())
      .all();
  const [waiting, decided] = await Promise.all([
    // заявки — в порядке поступления
    select("s.status = 'pending'", 's.updated_at, s.id'),
    select("s.status IN ('approved', 'closed')", 's.updated_at DESC, s.id DESC'),
  ]);
  return json({
    items: [...waiting.results, ...decided.results].map((r) => ({ ...own(r), rev: r.rev, login: r.login, person: r.person, ads: r.ads })),
  });
}

// действие: из какого статуса и в какой
const MOVES = { approve: ['pending', 'approved'], reject: ['pending', 'rejected'], close: ['approved', 'closed'], reopen: ['closed', 'approved'] };

export async function adminShop(request, env, id) {
  const { action, rev, note } = await readJson(request);
  if (!Object.hasOwn(MOVES, action)) fail(400, 'invalid', 'action');
  const [from, to] = MOVES[action];
  const reason = to === 'approved' ? '' : String(note ?? '').trim().slice(0, 200);
  if (to !== 'approved' && !reason) fail(400, 'invalid', 'note');
  // rev — та редакция заявки, которую видел модератор: изменённую после этого он не откроет вслепую
  const done = await env.DB.prepare(
    'UPDATE shops SET status = ?, note = ?, updated_at = ?, rev = rev + 1 WHERE id = ? AND status = ? AND rev = ?'
  )
    .bind(to, reason, now(), id, from, Number(rev))
    .run();
  if (!done.meta.changes) {
    if (!(await env.DB.prepare('SELECT 1 FROM shops WHERE id = ?').bind(id).first())) fail(404, 'not_found');
    fail(409, 'shop_changed');
  }
  return json({ ok: true });
}
