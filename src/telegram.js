// Вход через Telegram без SMS: сайт открывает бота, человек подтверждает вход кнопкой.
// Включается сам, когда у воркера появляется секрет BOT_TOKEN.
import { fail, json, limit, now, randomHex, safeEqual, sha256 } from './util.js';

const TTL = 600;

async function api(env, method, body) {
  const res = await fetch(`${env.TG_API || 'https://api.telegram.org'}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`telegram ${method}: ${data?.description || res.status}`);
  return data.result;
}

const webhookSecret = (env) => sha256(`webhook:${env.BOT_TOKEN}`);

// Один раз узнаёт имя бота и прописывает вебхук на текущий адрес сайта.
export async function botInfo(env, origin) {
  if (!env.BOT_TOKEN) return null;
  const stamp = await sha256(`${env.BOT_TOKEN}|${origin}`);
  const saved = await env.DB.prepare("SELECT value FROM meta WHERE key = 'bot'").first();
  if (saved) {
    const data = JSON.parse(saved.value);
    if (data.stamp === stamp) return data;
  }
  try {
    const me = await api(env, 'getMe');
    await api(env, 'setWebhook', {
      url: `${origin}/tg/webhook`,
      secret_token: await webhookSecret(env),
      allowed_updates: ['message', 'callback_query'],
    });
    const data = { stamp, username: me.username };
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('bot', ?)").bind(JSON.stringify(data)).run();
    return data;
  } catch (e) {
    console.error(e.message);
    return null;
  }
}

export async function startLogin(env, origin, who) {
  const bot = await botInfo(env, origin);
  if (!bot) fail(503, 'telegram_off');
  await limit(env, `login:${who.ip}`, 30, 3600);
  const nonce = randomHex(16);
  const secret = randomHex(24);
  const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  await env.DB.prepare('INSERT INTO logins (nonce, secret_hash, code, guest, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(nonce, await sha256(secret), code, who.user ? null : who.owner, now())
    .run();
  return json({ nonce, secret, code, url: `https://t.me/${bot.username}?start=${nonce}` });
}

export async function pollLogin(request, env) {
  const nonce = request.headers.get('x-login-nonce') || '';
  const secret = request.headers.get('x-login-secret') || '';
  const row = await env.DB.prepare('SELECT * FROM logins WHERE nonce = ? AND created_at > ?')
    .bind(nonce, now() - TTL)
    .first();
  if (!row || !(await safeEqual(await sha256(secret), row.secret_hash))) return json({ status: 'expired' });
  if (!row.user_id) return json({ status: 'pending' });

  // Одноразово: сессию получает только тот запрос, который удалил запись.
  const taken = await env.DB.prepare('DELETE FROM logins WHERE nonce = ? RETURNING nonce').bind(nonce).first();
  if (!taken) return json({ status: 'expired' });
  const token = randomHex(32);
  const statements = [
    env.DB.prepare('INSERT INTO sessions (hash, user_id, created_at) VALUES (?, ?, ?)').bind(await sha256(token), row.user_id, now()),
  ];
  if (row.guest) {
    // Объявления, поданные до входа, переезжают в аккаунт.
    statements.push(
      env.DB.prepare('UPDATE listings SET owner = ? WHERE owner = ?').bind(row.user_id, row.guest),
      env.DB.prepare('UPDATE photos SET owner = ? WHERE owner = ?').bind(row.user_id, row.guest)
    );
  }
  await env.DB.batch(statements);
  const user = await env.DB.prepare('SELECT name, username FROM users WHERE id = ?').bind(row.user_id).first();
  return json({ status: 'ok', token, user });
}

export async function webhook(request, env, origin) {
  if (!env.BOT_TOKEN) return new Response('off', { status: 404 });
  const header = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!(await safeEqual(header, await webhookSecret(env)))) return new Response('forbidden', { status: 403 });
  const update = await request.json().catch(() => ({}));
  try {
    if (update.message) await onMessage(env, origin, update.message);
    if (update.callback_query) await onButton(env, update.callback_query);
  } catch (e) {
    console.error(e.message);
  }
  return new Response('ok');
}

async function onMessage(env, origin, message) {
  if (message.chat?.type !== 'private') return;
  const [command, nonce] = String(message.text || '').split(/\s+/);
  if (command !== '/start') return;
  const chat_id = message.chat.id;
  const login =
    nonce &&
    (await env.DB.prepare('SELECT code FROM logins WHERE nonce = ? AND user_id IS NULL AND created_at > ?')
      .bind(nonce, now() - TTL)
      .first());
  if (login) {
    await api(env, 'sendMessage', {
      chat_id,
      text: `Вход на сайт tapty. Код: ${login.code}\n\nПодтвердите, только если вы сами начали вход и видите этот же код на экране.`,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Подтвердить вход', callback_data: `ok:${nonce}` },
          { text: 'Отмена', callback_data: `no:${nonce}` },
        ]],
      },
    });
    return;
  }
  await api(env, 'sendMessage', {
    chat_id,
    text: nonce ? 'Ссылка для входа устарела. Начните вход на сайте заново.' : 'tapty. — объявления по всему Казахстану.',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть tapty.', url: origin }]] },
  });
}

async function onButton(env, query) {
  const [action, nonce] = String(query.data || '').split(':');
  let text = 'Ссылка для входа устарела.';
  if (action === 'no') {
    await env.DB.prepare('DELETE FROM logins WHERE nonce = ?').bind(nonce).run();
    text = 'Вход отменён.';
  } else if (action === 'ok') {
    const from = query.from;
    const id = `tg:${from.id}`;
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 80) || 'Telegram';
    const done = await env.DB.prepare(
      'UPDATE logins SET user_id = ? WHERE nonce = ? AND user_id IS NULL AND created_at > ? RETURNING nonce'
    )
      .bind(id, nonce, now() - TTL)
      .first();
    if (done) {
      await env.DB.prepare(
        `INSERT INTO users (id, name, username, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = excluded.username`
      )
        .bind(id, name, from.username || '', now())
        .run();
      text = 'Готово. Вернитесь на сайт tapty.';
    }
  }
  await api(env, 'answerCallbackQuery', { callback_query_id: query.id });
  if (query.message) {
    await api(env, 'editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text });
  }
}
