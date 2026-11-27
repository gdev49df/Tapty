// Избранное хранится в аккаунте: без входа лайкать нельзя.
import { fail, json, limit, now, readJson } from './util.js';

const MAX = 60;

function signedIn(who) {
  if (!who.user) fail(401, 'login_required');
}

async function ids(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT listing_id AS id FROM favorites WHERE user_id = ? ORDER BY created_at DESC, listing_id DESC LIMIT ?'
  )
    .bind(user, MAX)
    .all();
  return json({ ids: results.map((r) => r.id) });
}

// Только существующие объявления; сверх лимита выпадают самые давние.
async function add(env, user, list) {
  const t = now();
  const insert = env.DB.prepare(
    'INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) SELECT ?, id, ? FROM listings WHERE id = ?'
  );
  await env.DB.batch([
    // первый в списке — самый свежий
    ...list.map((id, i) => insert.bind(user, t - i, id)),
    env.DB.prepare(
      `DELETE FROM favorites WHERE user_id = ?1 AND listing_id NOT IN
       (SELECT listing_id FROM favorites WHERE user_id = ?1 ORDER BY created_at DESC, listing_id DESC LIMIT ?2)`
    ).bind(user, MAX),
  ]);
}

export async function listFavorites(env, who) {
  signedIn(who);
  return ids(env, who.owner);
}

export async function setFavorite(env, id, on, who) {
  signedIn(who);
  await limit(env, `fav:${who.owner}`, 600, 3600);
  if (on) await add(env, who.owner, [id]);
  else await env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?').bind(who.owner, id).run();
  return ids(env, who.owner);
}

// Отметки, накопленные на устройстве до того, как избранное переехало в аккаунт.
export async function importFavorites(request, env, who) {
  signedIn(who);
  await limit(env, `fav:${who.owner}`, 600, 3600);
  const body = await readJson(request);
  const list = Array.isArray(body.ids) ? [...new Set(body.ids)].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, MAX) : [];
  if (list.length) await add(env, who.owner, list);
  return ids(env, who.owner);
}
