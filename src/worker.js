import { ensureSchema } from './schema.js';
import { HttpError, fail, json, limit, randomHex, safeEqual, sha256 } from './util.js';
import * as listings from './listings.js';
import { servePhoto, uploadPhoto } from './photos.js';
import { botInfo, pollLogin, startLogin, webhook } from './telegram.js';
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

// Кто делает запрос: сессия Telegram или ключ устройства из браузера.
async function identify(request, env) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
  const ip = await ipHash(request, env);
  if (!token) return { ip, owner: null, user: null };
  const hash = await sha256(token);
  const user = await env.DB.prepare(
    'SELECT u.id, u.name, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?'
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

  if (method === 'GET' && path === '/config') {
    const bot = await botInfo(env, url.origin);
    return json({ telegram: Boolean(env.BOT_TOKEN), bot: bot?.username || null, ai: Boolean(env.AI) });
  }
  if (method === 'GET' && path === '/me') {
    return json({ user: who.user ? { name: who.user.name, username: who.user.username } : null });
  }
  if (method === 'POST' && path === '/auth/start') return startLogin(env, url.origin, who);
  if (method === 'GET' && path === '/auth/poll') return pollLogin(request, env);
  if (method === 'POST' && path === '/auth/logout') {
    if (who.user) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(who.hash).run();
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/ai/draft') return draftFromPhoto(request, env, url, who);

  if (path === '/listings') {
    if (method === 'GET') return listings.listListings(env, url);
    if (method === 'POST') return listings.createListing(request, env, ctx, who);
  }
  if ((m = /^\/listings\/(\d{1,12})(\/contact|\/report|\/status|\/seller)?$/.exec(path))) {
    const id = Number(m[1]);
    if (!m[2]) {
      if (method === 'GET') return listings.getListing(env, ctx, id, who);
      if (method === 'PUT') return listings.updateListing(request, env, id, who);
      if (method === 'DELETE') return listings.deleteListing(env, id, who);
    }
    if (method === 'GET' && m[2] === '/seller') return listings.sellerPage(env, id);
    if (method === 'POST' && m[2] === '/contact') return listings.getContact(env, id, who);
    if (method === 'POST' && m[2] === '/report') return listings.reportListing(request, env, id, who);
    if (method === 'POST' && m[2] === '/status') return listings.setStatus(request, env, id, who);
  }
  if (method === 'GET' && path === '/mine') return listings.listMine(env, who);
  if (method === 'GET' && (m = /^\/mine\/(\d{1,12})$/.exec(path))) return listings.getMine(env, Number(m[1]), who);
  if (method === 'POST' && path === '/photos') {
    if (!who.owner) fail(401, 'no_key');
    if (env.BOT_TOKEN && !who.user) fail(401, 'login_required');
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
      if (request.method === 'POST' && path === '/tg/webhook') {
        await ensureSchema(env);
        return await webhook(request, env, url.origin);
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
