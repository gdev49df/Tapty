// Админка: счётчики и цифры, очередь жалоб, объявления и пользователи.
// Доступ проверяет воркер до вызова этих функций.
import { DAY, fail, json, now, readJson } from './util.js';
import { findRow, own, parsePhotos, publicStatus, removeRow } from './listings.js';
import { complaints } from './chat.js';
import { BAN_DAYS, ban, isBanned, unban } from './bans.js';
import { stopWords } from './site.js';
import { SESSION_DAYS } from './auth.js';

const PAGE = 30;
// Весь Казахстан живёт по UTC+5: сутки в статистике считаются по этому времени.
const ZONE = 5 * 3600;

// Чем опаснее причина жалобы, тем выше она в очереди.
const WEIGHT = { fraud: 5, banned: 5, insult: 3, other: 2, spam: 1, wrong: 1, sold: 1 };

// В очереди: объявления с жалобами и скрытые сайтом после жалоб, по которым ещё нет решения.
const QUEUED = `(l.id IN (SELECT listing_id FROM reports)
  OR (l.status = 'hidden' AND l.hide_reason = '' AND NOT EXISTS (SELECT 1 FROM bans WHERE value = l.owner)))`;

const BANNED_ACCOUNTS = `SELECT value FROM bans WHERE value LIKE '%:%'
  UNION SELECT value FROM bans b WHERE value NOT LIKE '%:%' AND NOT EXISTS (SELECT 1 FROM bans a WHERE a.value = b.owner)`;

// ---------- стоп-слова ----------

// Слово ищется с начала: «ставки» не найдётся в «поставки».
const starts = (word) => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
const matcher = (words) => {
  const rules = words.map((w) => [w, starts(w)]);
  return (row) => rules.filter(([, re]) => re.test(row.search)).map(([w]) => w);
};

// Активные объявления со стоп-словами, которые модератор ещё не проверил.
async function flagged(env, words) {
  if (!words.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT l.*, u.name AS person, u.login, (SELECT COUNT(*) FROM reports r WHERE r.listing_id = l.id) AS reports
     FROM listings l LEFT JOIN users u ON u.id = l.owner
     WHERE l.status = 'active' AND l.approved = 0 AND l.expires_at > ?
       AND (${words.map(() => 'instr(l.search, ?) > 0').join(' OR ')})
     ORDER BY l.created_at DESC, l.id DESC LIMIT 200`
  )
    .bind(now(), ...words)
    .all();
  const find = matcher(words);
  return results.filter((r) => find(r).length);
}

// ---------- обзор ----------

// Числа на вкладках: сколько ждёт решения.
export async function counts(env) {
  const [found, suspicious] = await Promise.all([
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM listings l WHERE ${QUEUED}) AS listings,
         (SELECT COUNT(*) FROM complaints k JOIN chats c ON c.id = k.chat_id) AS chats,
         (SELECT COUNT(*) FROM shops WHERE status = 'pending') AS shops,
         (SELECT COUNT(*) FROM (${BANNED_ACCOUNTS})) AS banned`
    ).first(),
    stopWords(env).then((words) => flagged(env, words)),
  ]);
  return json({ queue: found.listings + found.chats, listings: suspicious.length, shops: found.shops, users: found.banned });
}

export async function stats(env) {
  const today = Math.floor((now() + ZONE) / DAY);
  const first = today - 29;
  const since = first * DAY - ZONE;
  const perDay = (table) =>
    env.DB.prepare(`SELECT (created_at + ${ZONE}) / ${DAY} AS day, COUNT(*) AS n FROM ${table} WHERE created_at >= ? GROUP BY day`)
      .bind(since);
  const [totals, ...series] = await env.DB.batch([
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM listings WHERE status = 'active' AND expires_at > ?) AS listings,
         (SELECT COUNT(*) FROM shops WHERE status = 'approved') AS shops`
    ).bind(now()),
    perDay('users'),
    perDay('listings'),
    perDay('messages'),
    perDay('shops'),
  ]);
  const names = ['users', 'listings', 'messages', 'shops'];
  const found = series.map((s) => new Map(s.results.map((r) => [r.day, r.n])));
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = first + i;
    return { date: new Date(day * DAY * 1000).toISOString().slice(0, 10), ...Object.fromEntries(names.map((n, k) => [n, found[k].get(day) || 0])) };
  });
  const sum = (list) => Object.fromEntries(names.map((n) => [n, list.reduce((a, d) => a + d[n], 0)]));
  return json({ totals: totals.results[0], today: sum(days.slice(-1)), week: sum(days.slice(-7)), days });
}

// ---------- очередь жалоб ----------

const urgency = (score) => (score >= 5 ? 'high' : score >= 3 ? 'middle' : 'low');
const tally = (list) => list.reduce((all, reason) => ({ ...all, [reason]: (all[reason] || 0) + 1 }), {});
const weigh = (list) => list.reduce((sum, reason) => sum + (WEIGHT[reason] || 1), 0);

export async function queue(env) {
  const [{ results }, chats] = await Promise.all([
    env.DB.prepare(
      `SELECT l.*, GROUP_CONCAT(r.reason) AS reasons, MIN(r.created_at) AS first
       FROM listings l LEFT JOIN reports r ON r.listing_id = l.id
       WHERE ${QUEUED} GROUP BY l.id LIMIT 200`
    ).all(),
    complaints(env),
  ]);
  const items = [
    ...results.map((r) => {
      const list = r.reasons ? r.reasons.split(',') : [];
      // скрытое сайтом никто не видит: решения ждёт автор
      const score = weigh(list) + (r.status === 'hidden' ? 5 : 0);
      return {
        type: 'listing', id: r.id, title: r.title, price: r.price, priceType: r.price_type, photo: parsePhotos(r)[0] || null,
        hidden: r.status === 'hidden', reasons: tally(list), score, level: urgency(score), at: r.first || r.bumped_at,
      };
    }),
    ...chats.map(({ target, ...c }) => {
      const score = weigh([c.reason]);
      return { type: 'chat', ...c, accusedId: target, reasons: { [c.reason]: 1 }, score, level: urgency(score) };
    }),
  ];
  // самые срочные сверху, среди равных — те, что ждут дольше
  items.sort((a, b) => b.score - a.score || a.at - b.at);
  return json({ items });
}

// ---------- объявления ----------

const row = (r, find) => ({
  id: r.id,
  title: r.title,
  price: r.price,
  priceType: r.price_type,
  photo: parsePhotos(r)[0] || null,
  status: publicStatus(r),
  city: r.city,
  category: r.category,
  createdAt: r.created_at,
  reports: r.reports,
  hideReason: r.hide_reason,
  flags: find(r),
  owner: r.owner,
  person: r.person || r.name,
  login: r.login || '',
});

export async function listingList(env, url) {
  const view = url.searchParams.get('view');
  const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0), 5000);
  const words = await stopWords(env);
  const find = matcher(words);
  if (view === 'flagged') return json({ items: (await flagged(env, words)).map((r) => row(r, find)), next: null });
  const hidden = view === 'hidden';
  const { results } = await env.DB.prepare(
    `SELECT l.*, u.name AS person, u.login, (SELECT COUNT(*) FROM reports r WHERE r.listing_id = l.id) AS reports
     FROM listings l LEFT JOIN users u ON u.id = l.owner ${hidden ? "WHERE l.status = 'hidden'" : ''}
     ORDER BY l.created_at DESC, l.id DESC LIMIT ${PAGE + 1} OFFSET ${offset}`
  ).all();
  return json({ items: results.slice(0, PAGE).map((r) => row(r, find)), next: results.length > PAGE ? offset + PAGE : null });
}

export async function listingDetail(env, id) {
  const found = await findRow(env, id);
  const [{ results }, words, author] = await Promise.all([
    env.DB.prepare('SELECT reason FROM reports WHERE listing_id = ?').bind(id).all(),
    stopWords(env),
    person(env, found.owner),
  ]);
  return json({
    item: { ...own(found), owner: found.owner },
    reasons: tally(results.map((r) => r.reason)),
    flags: matcher(words)(found),
    author,
  });
}

// Одно действие над одним или несколькими объявлениями. show — вернуть или оставить в ленте.
export async function listingAction(request, env) {
  const body = await readJson(request);
  const { action } = body;
  if (!['hide', 'show', 'delete'].includes(action)) fail(400, 'invalid', 'action');
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : [];
  if (!ids.length || ids.length > 50 || !ids.every((id) => Number.isInteger(id) && id > 0)) fail(400, 'invalid', 'ids');
  const reason = String(body.reason ?? '').replace(/\s+/g, ' ').trim();
  // автор должен знать, за что скрыто
  if (action === 'hide' && (!reason || reason.length > 200)) fail(400, 'invalid', 'reason');
  const { results } = await env.DB.prepare(`SELECT * FROM listings WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  let done = 0;
  for (const found of results) {
    const settled = env.DB.prepare('DELETE FROM reports WHERE listing_id = ?').bind(found.id);
    if (action === 'delete') await removeRow(env, found);
    else if (action === 'hide') {
      await env.DB.batch([
        env.DB.prepare("UPDATE listings SET status = 'hidden', approved = 0, hide_reason = ?, ban_status = '' WHERE id = ?").bind(reason, found.id),
        settled,
      ]);
    } else {
      // объявления заблокированного возвращаются только вместе с разблокировкой
      if (await isBanned(env, found.owner, found.phone)) continue;
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE listings SET status = CASE status WHEN 'hidden' THEN 'active' ELSE status END,
             approved = 1, hide_reason = '', ban_status = '' WHERE id = ?`
        ).bind(found.id),
        settled,
      ]);
    }
    done += 1;
  }
  return json({ done, skipped: ids.length - done });
}

// ---------- пользователи ----------

const signedIn = () => now() - SESSION_DAYS * DAY;

// Коротко о владельце: аккаунт мог быть удалён, а объявления без аккаунта подавались с устройства.
async function person(env, key) {
  const found = await env.DB.prepare(
    `SELECT (SELECT name FROM users WHERE id = ?1) AS name,
       (SELECT login FROM users WHERE id = ?1) AS login,
       (SELECT created_at FROM users WHERE id = ?1) AS since,
       (SELECT COUNT(*) FROM listings WHERE owner = ?1) AS ads,
       (SELECT COUNT(*) FROM sessions WHERE user_id = ?1 AND created_at > ?2) AS sessions,
       (SELECT until FROM bans WHERE value = ?1) AS until`
  )
    .bind(key, signedIn())
    .first();
  return { id: key, ...found, banned: found.until !== null };
}

export async function userList(env, url) {
  if (url.searchParams.get('view') === 'banned') {
    const { results } = await env.DB.prepare(
      `SELECT b.value AS id, b.until, b.created_at AS at, u.name, u.login,
         (SELECT GROUP_CONCAT(p.value) FROM bans p WHERE p.owner = b.value AND p.value != b.value) AS phones,
         (SELECT name FROM listings WHERE owner = b.value ORDER BY id DESC LIMIT 1) AS seller
       FROM bans b LEFT JOIN users u ON u.id = b.value WHERE b.value IN (${BANNED_ACCOUNTS})
       ORDER BY b.created_at DESC, b.value LIMIT 200`
    ).all();
    return json({
      items: results.map((r) => ({
        id: r.id, name: r.name || r.seller, login: r.login, until: r.until, at: r.at, banned: true,
        phones: r.id.includes(':') ? (r.phones ? r.phones.split(',') : []) : [r.id],
      })),
      next: null,
    });
  }
  const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0), 5000);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.login, u.created_at AS since, b.until,
       (SELECT COUNT(*) FROM listings l WHERE l.owner = u.id) AS ads,
       (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.created_at > ?) AS sessions
     FROM users u LEFT JOIN bans b ON b.value = u.id WHERE u.login IS NOT NULL
     ORDER BY u.created_at DESC, u.id LIMIT ${PAGE + 1} OFFSET ${offset}`
  )
    .bind(signedIn())
    .all();
  return json({
    items: results.slice(0, PAGE).map((r) => ({ ...r, banned: r.until !== null })),
    next: results.length > PAGE ? offset + PAGE : null,
  });
}

export async function userDetail(env, key) {
  const [user, { results }, shop, banned] = await Promise.all([
    person(env, key),
    env.DB.prepare('SELECT * FROM listings WHERE owner = ? ORDER BY created_at DESC, id DESC LIMIT 50').bind(key).all(),
    env.DB.prepare('SELECT id, name, status FROM shops WHERE owner = ?').bind(key).first(),
    env.DB.prepare('SELECT value FROM bans WHERE owner = ?1 AND value != ?1').bind(key).all(),
  ]);
  if (!user.login && !results.length && !user.banned) fail(404, 'not_found');
  return json({
    user,
    shop,
    phones: [...new Set([...results.map((r) => r.phone), ...banned.results.map((r) => r.value)])],
    items: results.map((r) => ({
      id: r.id, title: r.title, price: r.price, priceType: r.price_type, photo: parsePhotos(r)[0] || null,
      status: publicStatus(r), hideReason: r.hide_reason,
    })),
  });
}

export async function userAction(request, env, key) {
  const { action, days } = await readJson(request);
  const account = key.includes(':');
  if (action === 'unban') {
    await unban(env, key);
    return json({ ok: true });
  }
  if (!account) fail(400, 'invalid', 'action');
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?1 UNION SELECT 1 FROM listings WHERE owner = ?1').bind(key).first();
  if (!exists) fail(404, 'not_found');
  if (action === 'ban') {
    if (!BAN_DAYS.includes(days)) fail(400, 'invalid', 'days');
    await ban(env, key, days);
    return json({ ok: true });
  }
  if (action === 'logout') {
    const { meta } = await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(key).run();
    return json({ ended: meta.changes });
  }
  fail(400, 'invalid', 'action');
}
