// Аккаунты по логину и паролю.
// Пароль на сервер не приходит: браузер прогоняет его через PBKDF2 (долгий расчёт, на воркере
// он не уложился бы в лимит процессорного времени) и присылает ключ. В базе лежит только
// солёный хеш этого ключа.
import { attempt, fail, json, limit, now, randomHex, readJson, safeEqual, sha256 } from './util.js';

const LOGIN = /^[a-z0-9_.]{3,24}$/;
const KEY = /^[a-f0-9]{64}$/;
// Вход забывается, если им столько не пользовались.
export const SESSION_DAYS = 90;
// Без букв O, I, L и U, чтобы код нельзя было переписать с ошибкой.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const readCode = (s) => String(s ?? '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');

// Резервный код: 80 случайных бит. В базе только солёный хеш, увидеть код повторно нельзя.
async function newCode() {
  const code = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => ALPHABET[b & 31]).join('');
  const salt = randomHex(16);
  return { shown: code.match(/.{4}/g).join('-'), salt, hash: await sha256(salt + code) };
}

async function passwordColumns(key) {
  const salt = randomHex(16);
  return [await sha256(salt + key), salt];
}

async function credentials(request) {
  const body = await readJson(request);
  const login = String(body.login ?? '').trim().toLowerCase();
  if (!LOGIN.test(login)) fail(400, 'invalid', 'login');
  if (!KEY.test(body.key)) fail(400, 'invalid', 'password');
  return { body, login, key: body.key };
}

// Новая сессия. Объявления, поданные с этого устройства без аккаунта, переезжают в аккаунт.
async function open(env, who, user, extra = {}) {
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
  return json({ token, user: { name: user.name, login: user.login }, ...extra });
}

export async function register(request, env, who) {
  const { body, login, key } = await credentials(request);
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) fail(400, 'invalid', 'name');
  await limit(env, `register:${who.ip}`, 20, 86400);
  const id = `u:${randomHex(12)}`;
  const code = await newCode();
  const created = await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, created_at, login, pass_hash, pass_salt, rec_hash, rec_salt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(id, name, now(), login, ...(await passwordColumns(key)), code.hash, code.salt)
    .first();
  if (!created) fail(409, 'login_taken', 'login');
  return open(env, who, { id, name, login }, { code: code.shown });
}

export async function signIn(request, env, who) {
  const { login, key } = await credentials(request);
  await limit(env, `signin:${who.ip}`, 30, 900);
  await limit(env, `signin:${login}:${who.ip}`, 10, 900);
  // Подбор одного пароля со множества адресов: не больше 50 неудачных попыток в час на аккаунт.
  // Владелец в это время может восстановить доступ резервным кодом.
  const passed = await attempt(env, `signin-account:${login}`, 50, 3600);
  const user = await env.DB.prepare('SELECT id, name, login, pass_hash, pass_salt FROM users WHERE login = ?').bind(login).first();
  // Одинаковый ответ и для неизвестного логина, и для неверного пароля.
  const ok = await safeEqual(await sha256((user?.pass_salt || '') + key), user?.pass_hash || '');
  if (!user || !ok) fail(401, 'bad_credentials');
  await passed();
  return open(env, who, user);
}

// Забытый пароль: логин, резервный код и новый пароль. Код одноразовый — взамен выдаётся другой.
export async function recover(request, env, who) {
  const { body, login, key } = await credentials(request);
  await limit(env, `recover:${who.ip}`, 10, 900);
  await limit(env, `recover:${login}:${who.ip}`, 5, 900);
  const user = await env.DB.prepare('SELECT id, name, login, rec_hash, rec_salt FROM users WHERE login = ?').bind(login).first();
  const ok = await safeEqual(await sha256((user?.rec_salt || '') + readCode(body.code)), user?.rec_hash || '');
  if (!user || !ok) fail(401, 'bad_code');
  const code = await newCode();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, rec_hash = ?, rec_salt = ? WHERE id = ?')
      .bind(...(await passwordColumns(key)), code.hash, code.salt, user.id),
    // тот, кто знал старый пароль, выходит из аккаунта
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  return open(env, who, user, { code: code.shown });
}

// Смена пароля и новый код требуют текущий пароль: одной открытой вкладки для этого мало.
async function confirmPassword(request, env, who) {
  if (!who.user) fail(401, 'login_required');
  const body = await readJson(request);
  if (!KEY.test(body.key)) fail(400, 'invalid', 'password');
  await limit(env, `password:${who.owner}`, 10, 900);
  const user = await env.DB.prepare('SELECT pass_hash, pass_salt FROM users WHERE id = ?').bind(who.owner).first();
  if (!(await safeEqual(await sha256(user.pass_salt + body.key), user.pass_hash))) fail(403, 'wrong_password', 'password');
  return body;
}

export async function changePassword(request, env, who) {
  const body = await confirmPassword(request, env, who);
  if (!KEY.test(body.newKey)) fail(400, 'invalid', 'newPassword');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?')
      .bind(...(await passwordColumns(body.newKey)), who.owner),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND hash != ?').bind(who.owner, who.hash),
  ]);
  return json({ ok: true });
}

export async function replaceCode(request, env, who) {
  await confirmPassword(request, env, who);
  const code = await newCode();
  await env.DB.prepare('UPDATE users SET rec_hash = ?, rec_salt = ? WHERE id = ?').bind(code.hash, code.salt, who.owner).run();
  return json({ code: code.shown });
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
