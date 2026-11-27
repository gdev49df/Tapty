// Аккаунты по логину и паролю.
// Пароль на сервер не приходит: браузер прогоняет его через PBKDF2 (долгий расчёт, на воркере
// он не уложился бы в лимит процессорного времени) и присылает ключ. В базе лежит только
// солёный хеш этого ключа.
import { fail, json, limit, now, randomHex, readJson, safeEqual, sha256 } from './util.js';

const LOGIN = /^[a-z0-9_.]{3,24}$/;
const KEY = /^[a-f0-9]{64}$/;

async function credentials(request) {
  const body = await readJson(request);
  const login = String(body.login ?? '').trim().toLowerCase();
  if (!LOGIN.test(login)) fail(400, 'invalid', 'login');
  if (!KEY.test(body.key)) fail(400, 'invalid', 'password');
  return { body, login, key: body.key };
}

// Новая сессия. Объявления, поданные с этого устройства без аккаунта, переезжают в аккаунт.
async function open(env, who, user) {
  const token = randomHex(32);
  const statements = [
    env.DB.prepare('INSERT INTO sessions (hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256(token), user.id, now()),
  ];
  if (who.owner?.startsWith('d:')) {
    statements.push(
      env.DB.prepare('UPDATE listings SET owner = ? WHERE owner = ?').bind(user.id, who.owner),
      env.DB.prepare('UPDATE photos SET owner = ? WHERE owner = ?').bind(user.id, who.owner),
      // блокировка не должна сниматься регистрацией
      env.DB.prepare('INSERT OR IGNORE INTO bans (value, created_at) SELECT ?, ? FROM bans WHERE value = ?').bind(user.id, now(), who.owner)
    );
  }
  await env.DB.batch(statements);
  return json({ token, user: { name: user.name, login: user.login } });
}

export async function register(request, env, who) {
  const { body, login, key } = await credentials(request);
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) fail(400, 'invalid', 'name');
  await limit(env, `register:${who.ip}`, 20, 86400);
  const id = `u:${randomHex(12)}`;
  const salt = randomHex(16);
  const created = await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, created_at, login, pass_hash, pass_salt) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(id, name, now(), login, await sha256(salt + key), salt)
    .first();
  if (!created) fail(409, 'login_taken', 'login');
  return open(env, who, { id, name, login });
}

export async function signIn(request, env, who) {
  const { login, key } = await credentials(request);
  await limit(env, `signin:${who.ip}`, 30, 900);
  await limit(env, `signin:${login}:${who.ip}`, 10, 900);
  const user = await env.DB.prepare('SELECT id, name, login, pass_hash, pass_salt FROM users WHERE login = ?').bind(login).first();
  // Одинаковый ответ и для неизвестного логина, и для неверного пароля.
  const ok = await safeEqual(await sha256((user?.pass_salt || '') + key), user?.pass_hash || '');
  if (!user || !ok) fail(401, 'bad_credentials');
  return open(env, who, user);
}

export async function signOut(env, who) {
  if (who.user) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(who.hash).run();
  return json({ ok: true });
}

// Для действий, которые доступны только с аккаунтом и не заблокированным.
export async function requireUser(env, who) {
  if (!who.user) fail(401, 'login_required');
  if (await env.DB.prepare('SELECT 1 FROM bans WHERE value = ?').bind(who.owner).first()) fail(403, 'banned');
  return who.user;
}
