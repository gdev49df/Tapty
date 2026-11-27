// Отзывы о продавцах. Оставить можно только после настоящей переписки: писали обе стороны.
import { fail, json, limit, now, readJson } from './util.js';
import { requireUser } from './auth.js';

export async function canReview(env, author, seller) {
  if (!author?.startsWith('u:') || author === seller) return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM chats c WHERE c.buyer = ?1 AND c.seller = ?2
       AND EXISTS (SELECT 1 FROM messages WHERE chat_id = c.id AND sender = ?1)
       AND EXISTS (SELECT 1 FROM messages WHERE chat_id = c.id AND sender = ?2)
     LIMIT 1`
  )
    .bind(author, seller)
    .first();
  return Boolean(row);
}

// «Проверенный продавец»: минимум три отзыва со средней оценкой не ниже 4,5.
export async function rating(env, seller) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE seller = ?')
    .bind(seller)
    .first();
  const average = row.count ? Math.round(row.average * 10) / 10 : 0;
  return { reviews: row.count, rating: average, verified: row.count >= 3 && row.average >= 4.5 };
}

export async function sellerReviews(env, seller, viewer) {
  const [{ results }, allowed] = await Promise.all([
    env.DB.prepare(
      `SELECT r.author, r.rating, r.text, r.created_at, u.name FROM reviews r JOIN users u ON u.id = r.author
       WHERE r.seller = ?1 ORDER BY r.author = ?2 DESC, r.created_at DESC LIMIT 50`
    )
      .bind(seller, viewer || '')
      .all(),
    canReview(env, viewer, seller),
  ]);
  return {
    canReview: allowed,
    items: results.map((r) => ({ name: r.name, rating: r.rating, text: r.text, at: r.created_at, mine: r.author === viewer })),
  };
}

// Продавец определяется по объявлению или по переписке: удаление объявления не должно отменять отзыв.
async function sellerOf(env, from, who) {
  if (from.chat) {
    const chat = await env.DB.prepare('SELECT seller FROM chats WHERE id = ? AND buyer = ?').bind(from.chat, who.owner).first();
    if (!chat) fail(404, 'not_found');
    return chat.seller;
  }
  const row = await env.DB.prepare('SELECT owner, status FROM listings WHERE id = ?').bind(from.listing).first();
  if (!row || row.status === 'hidden') fail(404, 'not_found');
  return row.owner;
}

export async function saveReview(request, env, from, who) {
  const body = await readJson(request);
  const stars = Number(body.rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail(400, 'invalid', 'rating');
  const text = String(body.text ?? '').replace(/\r/g, '').trim();
  if (text.length > 600) fail(400, 'invalid', 'text');
  await requireUser(env, who);
  const seller = await sellerOf(env, from, who);
  if (!(await canReview(env, who.owner, seller))) fail(403, 'review_not_allowed');
  await limit(env, `review:${who.owner}`, 20, 86400);
  await env.DB.prepare(
    `INSERT INTO reviews (seller, author, rating, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(seller, author) DO UPDATE SET rating = ?3, text = ?4, created_at = ?5`
  )
    .bind(seller, who.owner, stars, text, now())
    .run();
  return json({ ok: true });
}

export async function deleteReview(env, from, who) {
  await requireUser(env, who);
  await env.DB.prepare('DELETE FROM reviews WHERE seller = ? AND author = ?')
    .bind(await sellerOf(env, from, who), who.owner)
    .run();
  return json({ ok: true });
}

export async function adminReviews(env) {
  const { results } = await env.DB.prepare(
    `SELECT r.rowid AS id, r.rating, r.text, a.name AS author, s.name AS seller
     FROM reviews r JOIN users a ON a.id = r.author JOIN users s ON s.id = r.seller
     ORDER BY r.created_at DESC LIMIT 40`
  ).all();
  return json({ items: results });
}

export async function adminDeleteReview(env, id) {
  await env.DB.prepare('DELETE FROM reviews WHERE rowid = ?').bind(id).run();
  return json({ ok: true });
}
