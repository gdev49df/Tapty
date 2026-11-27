// Переписка покупателя и продавца внутри сайта.
import { CHAT_REASONS, LEGAL_VERSION, LIMITS } from '../public/js/catalog.js';
import { fail, json, limit, now, readJson } from './util.js';
import { requireUser } from './auth.js';
import { canReview } from './reviews.js';
import { photoResponse, storePhoto, storeVoice } from './photos.js';
import { banSeller } from './listings.js';

const MAX = 1000;

function cleanText(value) {
  const text = String(value ?? '').replace(/\r/g, '').trim();
  if (!text || text.length > MAX) fail(400, 'invalid', 'text');
  return text;
}

// Текст для предложения цены и ответа на него нужен там, где сообщение показывают как есть
// (модерация, старые копии сайта). Новые копии подписывают его сами, на языке читателя.
const PRICE_WORDS = { offer: 'Предлагаю', accepted: 'Принимаю цену', declined: 'Не принимаю цену' };
const priceMessage = (kind, amount) => ({ kind, amount, text: `${PRICE_WORDS[kind]} ${amount.toLocaleString('ru-RU')} ₸` });

const view = (m, me) => ({
  id: m.id, mine: m.sender === me, text: m.text, photo: m.photo, kind: m.kind, amount: m.amount, state: m.state,
  voice: m.voice, seconds: m.seconds, at: m.created_at,
});

async function add(env, chat, me, { text = '', photo = '', kind = '', amount = 0, voice = '', seconds = 0 }) {
  const row = await env.DB.prepare(
    `INSERT INTO messages (chat_id, sender, text, created_at, photo, kind, amount, voice, seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(chat.id, me, text, now(), photo, kind, amount, voice, seconds)
    .first();
  // Своё сообщение, а значит и всё до него, уже прочитано.
  const column = chat.buyer === me ? 'buyer_read' : 'seller_read';
  await env.DB.prepare(`UPDATE chats SET updated_at = ?, ${column} = ? WHERE id = ?`).bind(row.created_at, row.id, chat.id).run();
  return view(row, me);
}

const otherOf = (chat, me) => (chat.buyer === me ? chat.seller : chat.buyer);

// Кто кого заблокировал в этой паре.
async function blocksBetween(env, me, other) {
  const { results } = await env.DB.prepare(
    'SELECT blocker FROM blocks WHERE (blocker = ?1 AND blocked = ?2) OR (blocker = ?2 AND blocked = ?1)'
  )
    .bind(me, other)
    .all();
  return { byMe: results.some((r) => r.blocker === me), any: results.length > 0 };
}

// Блокировка закрывает переписку в обе стороны.
async function assertOpen(env, me, other) {
  const blocks = await blocksBetween(env, me, other);
  if (blocks.any) fail(403, blocks.byMe ? 'you_blocked' : 'blocked');
}

async function findChat(env, id, me) {
  const chat = await env.DB.prepare('SELECT * FROM chats WHERE id = ?').bind(id).first();
  if (!chat || (chat.buyer !== me && chat.seller !== me)) fail(404, 'not_found');
  return chat;
}

// Первое сообщение по объявлению (или очередное, если диалог уже есть). Вместо текста можно предложить свою цену.
export async function startChat(request, env, listingId, who) {
  const body = await readJson(request);
  const offering = body.offer !== undefined;
  if (offering && !(Number.isSafeInteger(body.offer) && body.offer > 0 && body.offer <= LIMITS.priceMax)) fail(400, 'invalid', 'price');
  const message = offering ? priceMessage('offer', body.offer) : { text: cleanText(body.text) };
  await requireUser(env, who);
  const row = await env.DB.prepare('SELECT id, owner, title, status, expires_at, price_type FROM listings WHERE id = ?')
    .bind(listingId)
    .first();
  if (!row || row.status === 'hidden') fail(404, 'not_found');
  if (row.owner === who.owner) fail(400, 'own_listing');
  // Продавцу без аккаунта сообщения некуда доставить.
  if (!row.owner.startsWith('u:')) fail(409, 'no_chat');
  await assertOpen(env, who.owner, row.owner);
  let chat = await env.DB.prepare('SELECT * FROM chats WHERE listing_id = ? AND buyer = ?').bind(listingId, who.owner).first();
  const live = row.status === 'active' && row.expires_at > now();
  // торговаться можно только по действующему объявлению с торгом
  if (!live && (offering || !chat)) fail(410, 'not_active');
  if (offering && row.price_type !== 'bargain') fail(409, 'no_offer');
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
  // ответить можно только на последнее предложение
  if (offering) await env.DB.prepare("UPDATE messages SET state = 'replaced' WHERE chat_id = ? AND kind = 'offer' AND state = ''").bind(chat.id).run();
  await add(env, chat, who.owner, message);
  return json({ chat: chat.id }, 201);
}

// Продавец принимает или отклоняет предложенную цену. Цена в объявлении при этом не меняется.
export async function answerOffer(request, env, id, messageId, who) {
  const { accept } = await readJson(request);
  if (typeof accept !== 'boolean') fail(400, 'invalid', 'accept');
  await requireUser(env, who);
  const chat = await findChat(env, id, who.owner);
  if (chat.seller !== who.owner) fail(403, 'forbidden');
  await assertOpen(env, who.owner, chat.buyer);
  const listing = await env.DB.prepare("SELECT 1 FROM listings WHERE id = ? AND status = 'active' AND expires_at > ?")
    .bind(chat.listing_id, now())
    .first();
  if (!listing) fail(410, 'not_active');
  await limit(env, `msg:${who.owner}`, 30, 60);
  const state = accept ? 'accepted' : 'declined';
  // одним запросом: из двух одновременных ответов пройдёт один
  const offer = await env.DB.prepare(
    "UPDATE messages SET state = ? WHERE id = ? AND chat_id = ? AND kind = 'offer' AND state = '' AND sender = ? RETURNING amount"
  )
    .bind(state, messageId, id, chat.buyer)
    .first();
  if (!offer) fail(409, 'offer_closed');
  return json({ message: await add(env, chat, who.owner, priceMessage(state, offer.amount)) }, 201);
}

export async function sendMessage(request, env, id, who) {
  const text = cleanText((await readJson(request)).text);
  await requireUser(env, who);
  const chat = await findChat(env, id, who.owner);
  await assertOpen(env, who.owner, otherOf(chat, who.owner));
  await limit(env, `msg:${who.owner}`, 30, 60);
  return json({ message: await add(env, chat, who.owner, { text }) }, 201);
}

export async function sendPhoto(request, env, id, who) {
  await requireUser(env, who);
  const chat = await findChat(env, id, who.owner);
  await assertOpen(env, who.owner, otherOf(chat, who.owner));
  await limit(env, `msg:${who.owner}`, 30, 60);
  // снимки занимают место в базе, поэтому у них свой дневной предел
  await limit(env, `chatphoto:${who.owner}`, 40, 86400);
  const photo = await storePhoto(request, env, who.owner, id);
  return json({ message: await add(env, chat, who.owner, { photo }) }, 201);
}

export async function sendVoice(request, env, id, who) {
  const user = await requireUser(env, who);
  // голос — новые сведения о человеке: сначала он должен принять действующую редакцию согласия
  if (user.consent !== LEGAL_VERSION) fail(403, 'consent_needed');
  const chat = await findChat(env, id, who.owner);
  await assertOpen(env, who.owner, otherOf(chat, who.owner));
  await limit(env, `msg:${who.owner}`, 30, 60);
  await limit(env, `chatvoice:${who.owner}`, 40, 86400);
  if (Number(request.headers.get('content-length') || 0) > LIMITS.voiceBytes + 10_000) fail(413, 'voice_too_large');
  const form = await request.formData().catch(() => fail(400, 'bad_voice'));
  const seconds = Number(form.get('seconds'));
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > LIMITS.voiceSeconds) fail(400, 'bad_voice');
  const voice = await storeVoice(env, form.get('voice'), who.owner, id);
  return json({ message: await add(env, chat, who.owner, { voice, seconds }) }, 201);
}

export async function chatPhoto(env, id, photo, variant, who) {
  if (!who.user) fail(401, 'login_required');
  await findChat(env, id, who.owner);
  const column = variant === 'thumb' ? 'thumb' : 'full';
  const row = await env.DB.prepare(`SELECT mime, ${column} AS data FROM photos WHERE id = ? AND chat_id = ?`).bind(photo, id).first();
  const response = row && (await photoResponse(env, photo, variant, row, 'private, no-store'));
  if (!response) fail(404, 'not_found');
  return response;
}

export async function setBlock(env, id, on, who) {
  if (!who.user) fail(401, 'login_required');
  const other = otherOf(await findChat(env, id, who.owner), who.owner);
  await (on
    ? env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?)').bind(who.owner, other, now())
    : env.DB.prepare('DELETE FROM blocks WHERE blocker = ? AND blocked = ?').bind(who.owner, other)
  ).run();
  return json({ ok: true });
}

export async function complain(request, env, id, who) {
  const body = await readJson(request);
  if (!CHAT_REASONS.includes(body.reason)) fail(400, 'invalid', 'reason');
  const comment = String(body.comment ?? '').replace(/\r/g, '').trim().slice(0, 500);
  await requireUser(env, who);
  const other = otherOf(await findChat(env, id, who.owner), who.owner);
  await limit(env, `complaint:${who.owner}`, 10, 86400);
  await env.DB.prepare(
    `INSERT INTO complaints (chat_id, reporter, target, reason, comment, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(chat_id, reporter) DO UPDATE SET reason = ?4, comment = ?5, created_at = ?6`
  )
    .bind(id, who.owner, other, body.reason, comment, now())
    .run();
  if (body.block) await setBlock(env, id, true, who);
  return json({ ok: true }, 201);
}

// Значение того участника диалога, который сделал запрос (?1).
const MINE = (field) => `(CASE WHEN c.buyer = ?1 THEN c.buyer_${field} ELSE c.seller_${field} END)`;
// Удалённое пользователем не показывается ему и не считается непрочитанным.
const UNREAD = `m.sender != ?1 AND m.id > ${MINE('read')} AND m.id > ${MINE('cleared')}`;
const side = (chat, me) => (chat.buyer === me ? 'buyer' : 'seller');

export async function setPin(env, id, on, who) {
  if (!who.user) fail(401, 'login_required');
  const chat = await findChat(env, id, who.owner);
  await env.DB.prepare(`UPDATE chats SET ${side(chat, who.owner)}_pinned = ? WHERE id = ?`)
    .bind(on ? now() : 0, id)
    .run();
  return json({ ok: true });
}

// Диалог удаляется только у того, кто просит: собеседник и модератор видят переписку по-прежнему.
// Новое сообщение вернёт диалог в список, но уже без старых.
export async function deleteChat(env, id, who) {
  if (!who.user) fail(401, 'login_required');
  const chat = await findChat(env, id, who.owner);
  const mine = side(chat, who.owner);
  await env.DB.prepare(
    `UPDATE chats SET ${mine}_pinned = 0,
       ${mine}_cleared = COALESCE((SELECT MAX(id) FROM messages WHERE chat_id = ?1), 0) WHERE id = ?1`
  )
    .bind(id)
    .run();
  return json({ ok: true });
}

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
       last.text AS last, last.sender AS last_sender, last.kind, last.amount, last.voice,
       EXISTS (SELECT 1 FROM blocks WHERE blocker = ?1 AND blocked = u.id) AS blocked,
       (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND ${UNREAD}) AS unread,
       ${MINE('pinned')} AS pinned
     FROM chats c
     JOIN users u ON u.id = CASE WHEN c.buyer = ?1 THEN c.seller ELSE c.buyer END
     LEFT JOIN listings l ON l.id = c.listing_id
     LEFT JOIN messages last ON last.id = (SELECT MAX(id) FROM messages WHERE chat_id = c.id)
     WHERE (c.buyer = ?1 OR c.seller = ?1)
       AND EXISTS (SELECT 1 FROM messages WHERE chat_id = c.id AND id > ${MINE('cleared')})
     ORDER BY pinned > 0 DESC, c.updated_at DESC, c.id DESC LIMIT 100`
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
      lastKind: r.kind,
      lastAmount: r.amount,
      lastVoice: Boolean(r.voice),
      lastMine: r.last_sender === who.owner,
      unread: r.unread,
      blocked: Boolean(r.blocked),
      pinned: Boolean(r.pinned),
      at: r.updated_at,
    })),
  });
}

export async function getChat(env, url, id, who) {
  if (!who.user) fail(401, 'login_required');
  const chat = await findChat(env, id, who.owner);
  const after = Math.max(parseInt(url.searchParams.get('after'), 10) || 0, 0);
  const buying = chat.buyer === who.owner;
  const mine = side(chat, who.owner);
  const [{ results }, other, listing, offers] = await Promise.all([
    env.DB.prepare('SELECT * FROM messages WHERE chat_id = ? AND id > ? ORDER BY id DESC LIMIT 200')
      .bind(id, Math.max(after, chat[`${mine}_cleared`]))
      .all(),
    env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(buying ? chat.seller : chat.buyer).first(),
    env.DB.prepare('SELECT title, photos, price, price_type, status, expires_at FROM listings WHERE id = ?').bind(chat.listing_id).first(),
    // состояние предложений меняется у уже полученных сообщений, поэтому приходит отдельно
    env.DB.prepare("SELECT id, state FROM messages WHERE chat_id = ? AND kind = 'offer' ORDER BY id DESC LIMIT 50").bind(id).all(),
  ]);
  const newest = results[0]?.id || 0;
  if (newest > (buying ? chat.buyer_read : chat.seller_read)) {
    await env.DB.prepare(`UPDATE chats SET ${buying ? 'buyer_read' : 'seller_read'} = ? WHERE id = ?`).bind(newest, id).run();
  }
  const blocks = await blocksBetween(env, who.owner, otherOf(chat, who.owner));
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
      blockedByMe: blocks.byMe,
      pinned: Boolean(chat[`${mine}_pinned`]),
      canWrite: !blocks.any,
      // перед первым голосовым надо принять действующую редакцию согласия
      needConsent: who.user.consent !== LEGAL_VERSION,
    },
    offers: offers.results,
    // до какого сообщения дочитал собеседник
    read: buying ? chat.seller_read : chat.buyer_read,
    messages: results.reverse().map((m) => view(m, who.owner)),
  });
}

export async function adminComplaints(env) {
  const { results } = await env.DB.prepare(
    `SELECT k.id, k.chat_id, k.reporter, k.target, k.reason, k.comment, c.title, a.name AS author, b.name AS accused,
       EXISTS (SELECT 1 FROM bans WHERE value = k.target) AS banned
     FROM complaints k JOIN chats c ON c.id = k.chat_id JOIN users a ON a.id = k.reporter JOIN users b ON b.id = k.target
     ORDER BY k.created_at DESC, k.id DESC LIMIT 20`
  ).all();
  const ids = [...new Set(results.map((r) => r.chat_id))];
  // последние 30 сообщений каждого диалога одним запросом
  const messages = ids.length
    ? (
        await env.DB.prepare(
          `SELECT chat_id, sender, text, photo, voice, seconds FROM (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY id DESC) AS n FROM messages
             WHERE chat_id IN (${ids.map(() => '?').join(',')})
           ) WHERE n <= 30 ORDER BY id`
        )
          .bind(...ids)
          .all()
      ).results
    : [];
  return json({
    items: results.map((r) => ({
      id: r.id,
      reason: r.reason,
      comment: r.comment,
      title: r.title,
      author: r.author,
      accused: r.accused,
      banned: Boolean(r.banned),
      messages: messages
        .filter((m) => m.chat_id === r.chat_id)
        .map((m) => ({ accused: m.sender === r.target, text: m.text, photo: m.photo, voice: m.voice, seconds: m.seconds })),
    })),
  });
}

// Модератору доступны снимки и голосовые только из тех диалогов, на которые пожаловались.
export async function adminChatPhoto(env, photo) {
  const row = await env.DB.prepare(
    'SELECT mime, full AS data FROM photos WHERE id = ? AND chat_id IN (SELECT chat_id FROM complaints)'
  )
    .bind(photo)
    .first();
  const response = row && (await photoResponse(env, photo, 'full', row, 'private, no-store'));
  if (!response) fail(404, 'not_found');
  return response;
}

export async function adminComplaint(request, env, id) {
  const { action } = await readJson(request);
  const row = await env.DB.prepare('SELECT target FROM complaints WHERE id = ?').bind(id).first();
  if (!row) fail(404, 'not_found');
  if (action === 'ban') {
    await banSeller(env, row.target);
    await env.DB.prepare('DELETE FROM complaints WHERE target = ?').bind(row.target).run();
  } else if (action === 'dismiss') {
    await env.DB.prepare('DELETE FROM complaints WHERE id = ?').bind(id).run();
  } else fail(400, 'invalid', 'action');
  return json({ ok: true });
}
