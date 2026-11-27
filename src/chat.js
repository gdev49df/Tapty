// Переписка покупателя и продавца внутри сайта.
import { fail, json, limit, now, readJson } from './util.js';
import { requireUser } from './auth.js';
import { canReview } from './reviews.js';

const MAX = 1000;

async function readText(request) {
  const text = String((await readJson(request)).text ?? '').replace(/\r/g, '').trim();
  if (!text || text.length > MAX) fail(400, 'invalid', 'text');
  return text;
}

async function add(env, chat, me, text) {
  const t = now();
  const { id } = await env.DB.prepare('INSERT INTO messages (chat_id, sender, text, created_at) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(chat.id, me, text, t)
    .first();
  // Своё сообщение, а значит и всё до него, уже прочитано.
  const column = chat.buyer === me ? 'buyer_read' : 'seller_read';
  await env.DB.prepare(`UPDATE chats SET updated_at = ?, ${column} = ? WHERE id = ?`).bind(t, id, chat.id).run();
  return { id, mine: true, text, at: t };
}

async function findChat(env, id, me) {
  const chat = await env.DB.prepare('SELECT * FROM chats WHERE id = ?').bind(id).first();
  if (!chat || (chat.buyer !== me && chat.seller !== me)) fail(404, 'not_found');
  return chat;
}

// Первое сообщение по объявлению (или очередное, если диалог уже есть).
export async function startChat(request, env, listingId, who) {
  const text = await readText(request);
  await requireUser(env, who);
  const row = await env.DB.prepare('SELECT id, owner, title, status, expires_at FROM listings WHERE id = ?').bind(listingId).first();
  if (!row || row.status === 'hidden') fail(404, 'not_found');
  if (row.owner === who.owner) fail(400, 'own_listing');
  // Продавцу без аккаунта сообщения некуда доставить.
  if (!row.owner.startsWith('u:')) fail(409, 'no_chat');
  let chat = await env.DB.prepare('SELECT * FROM chats WHERE listing_id = ? AND buyer = ?').bind(listingId, who.owner).first();
  if (!chat && (row.status !== 'active' || row.expires_at <= now())) fail(410, 'not_active');
  await limit(env, `msg:${who.owner}`, 30, 60);
  if (!chat) {
    await limit(env, `chats:${who.owner}`, 30, 86400);
    const t = now();
    await env.DB.prepare(
      'INSERT OR IGNORE INTO chats (listing_id, title, buyer, seller, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(listingId, row.title, who.owner, row.owner, t, t)
      .run();
    chat = await env.DB.prepare('SELECT * FROM chats WHERE listing_id = ? AND buyer = ?').bind(listingId, who.owner).first();
  }
  await add(env, chat, who.owner, text);
  return json({ chat: chat.id }, 201);
}

export async function sendMessage(request, env, id, who) {
  const text = await readText(request);
  await requireUser(env, who);
  const chat = await findChat(env, id, who.owner);
  await limit(env, `msg:${who.owner}`, 30, 60);
  return json({ message: await add(env, chat, who.owner, text) }, 201);
}

const UNREAD = `m.sender != ?1 AND m.id > CASE WHEN c.buyer = ?1 THEN c.buyer_read ELSE c.seller_read END`;

export async function unread(env, who) {
  if (!who.user) return json({ count: 0 });
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM chats c JOIN messages m ON m.chat_id = c.id
     WHERE (c.buyer = ?1 OR c.seller = ?1) AND ${UNREAD}`
  )
    .bind(who.owner)
    .first();
  return json({ count: row.count });
}

const firstPhoto = (json_) => {
  try {
    return JSON.parse(json_)[0] || null;
  } catch {
    return null;
  }
};

export async function listChats(env, who) {
  if (!who.user) fail(401, 'login_required');
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.title AS saved_title, c.buyer, c.updated_at, u.name AS other, l.title, l.photos,
       (SELECT text FROM messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS last,
       (SELECT sender FROM messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_sender,
       (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND ${UNREAD}) AS unread
     FROM chats c
     JOIN users u ON u.id = CASE WHEN c.buyer = ?1 THEN c.seller ELSE c.buyer END
     LEFT JOIN listings l ON l.id = c.listing_id
     WHERE c.buyer = ?1 OR c.seller = ?1
     ORDER BY c.updated_at DESC, c.id DESC LIMIT 100`
  )
    .bind(who.owner)
    .all();
  return json({
    items: results.map((r) => ({
      id: r.id,
      other: r.other,
      title: r.title || r.saved_title,
      photo: r.photos ? firstPhoto(r.photos) : null,
      last: r.last,
      lastMine: r.last_sender === who.owner,
      unread: r.unread,
      at: r.updated_at,
    })),
  });
}

export async function getChat(env, url, id, who) {
  if (!who.user) fail(401, 'login_required');
  const chat = await findChat(env, id, who.owner);
  const after = Math.max(parseInt(url.searchParams.get('after'), 10) || 0, 0);
  const buying = chat.buyer === who.owner;
  const [{ results }, other, listing] = await Promise.all([
    env.DB.prepare('SELECT id, sender, text, created_at FROM messages WHERE chat_id = ? AND id > ? ORDER BY id DESC LIMIT 200')
      .bind(id, after)
      .all(),
    env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(buying ? chat.seller : chat.buyer).first(),
    env.DB.prepare('SELECT title, photos, price, price_type, status, expires_at FROM listings WHERE id = ?').bind(chat.listing_id).first(),
  ]);
  const newest = results[0]?.id || 0;
  if (newest > (buying ? chat.buyer_read : chat.seller_read)) {
    await env.DB.prepare(`UPDATE chats SET ${buying ? 'buyer_read' : 'seller_read'} = ? WHERE id = ?`).bind(newest, id).run();
  }
  const visible = listing && listing.status !== 'hidden';
  const canWriteReview = buying && (await canReview(env, who.owner, chat.seller));
  const review = canWriteReview
    ? await env.DB.prepare('SELECT rating, text FROM reviews WHERE seller = ? AND author = ?').bind(chat.seller, who.owner).first()
    : null;
  return json({
    chat: {
      id: chat.id,
      other: other?.name || '',
      buying,
      listing: {
        id: chat.listing_id,
        title: visible ? listing.title : chat.title,
        photo: visible ? firstPhoto(listing.photos) : null,
        price: visible ? listing.price : 0,
        priceType: visible ? listing.price_type : null,
        status: !visible ? 'gone' : listing.status === 'active' && listing.expires_at <= now() ? 'expired' : listing.status,
      },
      canReview: canWriteReview,
      review,
    },
    // до какого сообщения дочитал собеседник
    read: buying ? chat.seller_read : chat.buyer_read,
    messages: results.reverse().map((m) => ({ id: m.id, mine: m.sender === who.owner, text: m.text, at: m.created_at })),
  });
}
