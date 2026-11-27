import { ensureSchema } from './schema.js';
import { HttpError, fail, json, limit, randomHex, safeEqual, sha256 } from './util.js';
import * as listings from './listings.js';
import { servePhoto, uploadPhoto } from './photos.js';
import { changePassword, recover, register, replaceCode, requireUser, signIn, signOut } from './auth.js';
import * as chat from './chat.js';
import * as reviews from './reviews.js';
import * as favorites from './favorites.js';
import { draftFromPhoto } from './ai.js';
import { CITIES } from '../public/js/catalog.js';

let salt = null;
async function ipHash(request, env) {
  if (!salt) {
    await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('salt', ?)").bind(randomHex(24)).run();
    salt = (await env.DB.prepare("SELECT value FROM meta WHERE key = 'salt'").first()).value;
  }
  return 'ip:' + (await sha256(salt + (request.headers.get('cf-connecting-ip') || 'local'))).slice(0, 32);
}

// Кто делает запрос: вошедший пользователь или ключ устройства из браузера.
async function identify(request, env) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
  const ip = await ipHash(request, env);
  if (!token) return { ip, owner: null, user: null };
  const hash = await sha256(token);
  const user = await env.DB.prepare(
    'SELECT u.id, u.name, u.login, u.rec_hash IS NOT NULL AS recovery FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND u.login IS NOT NULL'
  )
    .bind(hash)
    .first();
  return { ip, hash, user, owner: user ? user.id : `d:${hash}` };
}

async function api(request, env, ctx, url) {
  const method = request.method;
  const path = url.pathname.slice(4);
  const who = await identify(request, env);
  let m;

  if (method === 'GET' && path === '/config') return json({ ai: Boolean(env.AI) });
  if (method === 'GET' && path === '/me') {
    const { user } = who;
    return json({ user: user ? { name: user.name, login: user.login, recovery: Boolean(user.recovery) } : null });
  }
  if (method === 'POST' && path === '/auth/register') return register(request, env, who);
  if (method === 'POST' && path === '/auth/login') return signIn(request, env, who);
  if (method === 'POST' && path === '/auth/logout') return signOut(env, who);
  if (method === 'POST' && path === '/auth/recover') return recover(request, env, who);
  if (method === 'POST' && path === '/auth/password') return changePassword(request, env, who);
  if (method === 'POST' && path === '/auth/code') return replaceCode(request, env, who);
  if (method === 'GET' && path === '/price-hint') return listings.priceHint(env, url, who);

  if (path === '/favorites') {
    if (method === 'GET') return favorites.listFavorites(env, who);
    if (method === 'POST') return favorites.importFavorites(request, env, who);
  }
  if ((m = /^\/favorites\/(\d{1,12})$/.exec(path)) && (method === 'PUT' || method === 'DELETE')) {
    return favorites.setFavorite(env, Number(m[1]), method === 'PUT', who);
  }

  if (method === 'GET' && path === '/chats') return chat.listChats(env, who);
  if (method === 'GET' && path === '/chats/unread') return chat.unread(env, who);
  if ((m = /^\/chats\/(\d{1,12})(\/review)?$/.exec(path))) {
    const id = Number(m[1]);
    if (m[2]) {
      if (method === 'POST') return reviews.saveReview(request, env, { chat: id }, who);
      if (method === 'DELETE') return reviews.deleteReview(env, { chat: id }, who);
    } else {
      if (method === 'GET') return chat.getChat(env, url, id, who);
      if (method === 'POST') return chat.sendMessage(request, env, id, who);
      if (method === 'DELETE') return chat.deleteChat(env, id, who);
    }
  }
  if ((m = /^\/chats\/(\d{1,12})\/(photo|block|complaint|pin)$/.exec(path))) {
    const id = Number(m[1]);
    if (m[2] === 'photo' && method === 'POST') return chat.sendPhoto(request, env, id, who);
    if (m[2] === 'complaint' && method === 'POST') return chat.complain(request, env, id, who);
    if (m[2] === 'block' && (method === 'POST' || method === 'DELETE')) return chat.setBlock(env, id, method === 'POST', who);
    if (m[2] === 'pin' && (method === 'POST' || method === 'DELETE')) return chat.setPin(env, id, method === 'POST', who);
  }
  if (method === 'GET' && (m = /^\/chats\/(\d{1,12})\/photos\/([a-f0-9]{24})(\/t)?$/.exec(path))) {
    return chat.chatPhoto(env, Number(m[1]), m[2], m[3] ? 'thumb' : 'full', who);
  }

  if (method === 'POST' && path === '/ai/draft') return draftFromPhoto(request, env, url, who);

  if (path === '/listings') {
    if (method === 'GET') return listings.listListings(env, url);
    if (method === 'POST') return listings.createListing(request, env, ctx, who);
  }
  if ((m = /^\/listings\/(\d{1,12})(\/contact|\/report|\/status|\/seller|\/chat|\/review)?$/.exec(path))) {
    const id = Number(m[1]);
    if (!m[2]) {
      if (method === 'GET') return listings.getListing(env, ctx, id, who);
      if (method === 'PUT') return listings.updateListing(request, env, id, who);
      if (method === 'DELETE') return listings.deleteListing(env, id, who);
    }
    if (method === 'GET' && m[2] === '/seller') return listings.sellerPage(env, id, who);
    if (method === 'POST' && m[2] === '/chat') return chat.startChat(request, env, id, who);
    if (method === 'POST' && m[2] === '/review') return reviews.saveReview(request, env, { listing: id }, who);
    if (method === 'DELETE' && m[2] === '/review') return reviews.deleteReview(env, { listing: id }, who);
    if (method === 'POST' && m[2] === '/contact') return listings.getContact(env, id, who);
    if (method === 'POST' && m[2] === '/report') return listings.reportListing(request, env, id, who);
    if (method === 'POST' && m[2] === '/status') return listings.setStatus(request, env, id, who);
  }
  if (method === 'GET' && path === '/mine') return listings.listMine(env, who);
  if (method === 'GET' && (m = /^\/mine\/(\d{1,12})$/.exec(path))) return listings.getMine(env, Number(m[1]), who);
  if (method === 'POST' && path === '/photos') {
    await requireUser(env, who);
    return uploadPhoto(request, env, who);
  }

  if (path.startsWith('/admin/')) {
    // Без секрета ADMIN_KEY админки не существует.
    if (!env.ADMIN_KEY) fail(404, 'not_found');
    let given = request.headers.get('x-admin-key') || '';
    try {
      given = decodeURIComponent(given);
    } catch {}
    if (!(await safeEqual(given, env.ADMIN_KEY))) {
      await limit(env, `admin:${who.ip}`, 20, 3600);
      fail(403, 'forbidden');
    }
    if (method === 'GET' && path === '/admin/reports') return listings.adminReports(env);
    if (method === 'GET' && path === '/admin/complaints') return chat.adminComplaints(env);
    if (method === 'GET' && (m = /^\/admin\/chat-photos\/([a-f0-9]{24})$/.exec(path))) return chat.adminChatPhoto(env, m[1]);
    if (method === 'POST' && (m = /^\/admin\/complaints\/(\d{1,12})$/.exec(path))) return chat.adminComplaint(request, env, Number(m[1]));
    if (method === 'GET' && path === '/admin/reviews') return reviews.adminReviews(env);
    if (method === 'DELETE' && (m = /^\/admin\/reviews\/(\d{1,12})$/.exec(path))) {
      return reviews.adminDeleteReview(env, Number(m[1]));
    }
    if (method === 'POST' && (m = /^\/admin\/(\d{1,12})$/.exec(path))) {
      return listings.adminAction(request, env, Number(m[1]));
    }
  }
  fail(404, 'not_found');
}

// Ссылка на товар в мессенджере должна показывать фото, название и цену.
async function itemPage(request, env, url, id) {
  const shell = await env.ASSETS.fetch(new Request(new URL('/', url)));
  const row = await env.DB.prepare(
    "SELECT title, price, price_type, city, photos FROM listings WHERE id = ? AND status = 'active'"
  )
    .bind(id)
    .first();
  if (!row) return shell;
  const price =
    row.price_type === 'free' ? 'Даром' : row.price ? `${row.price.toLocaleString('ru-RU')} ₸` : 'Обмен';
  const city = CITIES.find((c) => c.id === row.city)?.ru || '';
  const photo = JSON.parse(row.photos)[0];
  const meta = {
    'og:title': `${row.title}, ${price}`,
    'og:description': `${city}. Объявление на tapty.`,
    'og:url': `${url.origin}/item/${id}`,
    'og:image': photo ? `${url.origin}/p/${photo}` : `${url.origin}/icons/icon-512.png`,
  };
  return new HTMLRewriter()
    .on('title', { element: (el) => el.setInnerContent(`${row.title} — tapty.`) })
    .on('meta[property^="og:"]', {
      element: (el) => {
        const value = meta[el.getAttribute('property')];
        if (value) el.setAttribute('content', value);
      },
    })
    .transform(shell);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      let m;
      if (path.startsWith('/api/')) {
        await ensureSchema(env);
        return await api(request, env, ctx, url);
      }
      if (request.method === 'GET' && (m = /^\/p\/([a-f0-9]{24})(\/t)?$/.exec(path))) {
        await ensureSchema(env);
        return await servePhoto(request, env, ctx, m[1], m[2] ? 'thumb' : 'full');
      }
      if (request.method === 'GET' && (m = /^\/item\/(\d{1,12})$/.exec(path))) {
        await ensureSchema(env);
        return await itemPage(request, env, url, Number(m[1]));
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, field: e.field }, e.status);
      console.error(e.stack || e.message);
      return json({ error: 'server' }, 500);
    }
  },
};
