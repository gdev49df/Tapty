// Блокировки: на срок или бессрочно (until = 0). Блокируются аккаунт и номера телефонов.
// Объявления и магазин, скрытые блокировкой, помнят прежнее состояние (ban_status)
// и возвращаются, когда срок вышел или модератор снял блокировку.
import { DAY, now } from './util.js';

export const BAN_DAYS = [1, 7, 30, 0];
export const BAN_NOTE = 'Аккаунт заблокирован';
const REPORTED = 'Скрыто после жалоб';

// Возвращает скрытое блокировкой, если ни аккаунт, ни номер больше не заблокированы.
const free = (table) => `ban_status != '' AND NOT EXISTS (SELECT 1 FROM bans WHERE value IN (${table}.owner, ${table}.phone))`;
const restore = (env, t) => [
  env.DB.prepare(`UPDATE listings SET status = ban_status, ban_status = '', hide_reason = '' WHERE ${free('listings')}`),
  env.DB.prepare(
    `UPDATE shops SET status = ban_status, ban_status = '', note = '', updated_at = ?, rev = rev + 1 WHERE ${free('shops')}`
  ).bind(t),
];

// Снимает блокировки, у которых вышел срок.
export async function liftExpired(env) {
  const t = now();
  const { meta } = await env.DB.prepare('DELETE FROM bans WHERE until > 0 AND until <= ?').bind(t).run();
  if (meta.changes) await env.DB.batch(restore(env, t));
}

// Между запросами посетителей проверка идёт не чаще раза в минуту.
let checked = 0;
export async function liftSometimes(env) {
  if (now() - checked < 60) return;
  checked = now();
  await liftExpired(env);
}

// Заблокирован ли хоть один из аккаунтов или номеров. Истёкшая блокировка снимается тут же.
export async function isBanned(env, ...values) {
  const find = () =>
    env.DB.prepare(`SELECT until FROM bans WHERE value IN (${values.map(() => '?').join(',')})`).bind(...values).all();
  const { results } = await find();
  const t = now();
  if (!results.some((r) => r.until && r.until <= t)) return results.length > 0;
  await liftExpired(env);
  return (await find()).results.length > 0;
}

// Повторная блокировка того же аккаунта меняет срок. Номер, который уже закрыт из-за
// другого аккаунта, получает более долгий из двух сроков.
const UPSERT = `ON CONFLICT(value) DO UPDATE SET
  until = CASE WHEN bans.owner = excluded.owner THEN excluded.until
    WHEN bans.until = 0 OR excluded.until = 0 THEN 0 ELSE MAX(bans.until, excluded.until) END,
  owner = excluded.owner, created_at = excluded.created_at`;

export async function ban(env, owner, days = 0) {
  const t = now();
  const until = days ? t + days * DAY : 0;
  const mine = 'SELECT id FROM listings WHERE owner = ?1';
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO bans (value, owner, until, created_at) VALUES (?1, ?1, ?2, ?3) ${UPSERT}`).bind(owner, until, t),
    env.DB.prepare(
      `INSERT INTO bans (value, owner, until, created_at)
       SELECT phone, ?1, ?2, ?3 FROM (SELECT phone FROM listings WHERE owner = ?1 UNION SELECT phone FROM shops WHERE owner = ?1)
       WHERE true ${UPSERT}`
    ).bind(owner, until, t),
    // жалобы на этого человека разобраны
    env.DB.prepare(`DELETE FROM reports WHERE listing_id IN (${mine})`).bind(owner),
    env.DB.prepare('DELETE FROM complaints WHERE target = ?').bind(owner),
    // ждавшее проверки после жалоб остаётся скрытым и после блокировки
    env.DB.prepare("UPDATE listings SET hide_reason = ?2 WHERE owner = ?1 AND status = 'hidden' AND hide_reason = ''").bind(owner, REPORTED),
    env.DB.prepare(
      "UPDATE listings SET ban_status = status, status = 'hidden', approved = 0, hide_reason = ? WHERE owner = ? AND status != 'hidden'"
    ).bind(BAN_NOTE, owner),
    env.DB.prepare(
      `UPDATE shops SET ban_status = status, status = 'closed', note = ?, updated_at = ?, rev = rev + 1
       WHERE owner = ? AND status IN ('pending', 'approved')`
    ).bind(BAN_NOTE, t, owner),
  ]);
}

// key — номер аккаунта (u:…, d:…) или телефон.
export async function unban(env, key) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      // owner = '' — записи, сделанные до того, как номер стал связываться с аккаунтом
      `DELETE FROM bans WHERE value = ?1 OR owner = ?1
         OR (owner = '' AND value IN (SELECT phone FROM listings WHERE owner = ?1))`
    ).bind(key),
    // общий с другим заблокированным номер остаётся закрытым
    env.DB.prepare(
      `INSERT OR IGNORE INTO bans (value, owner, until, created_at)
       SELECT l.phone, b.value, b.until, b.created_at FROM listings l JOIN bans b ON b.value = l.owner`
    ),
    ...restore(env, t),
  ]);
}
