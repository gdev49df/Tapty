// Проверка API на локальном воркере и временной базе: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { localConfigs } from './local.mjs';
import { parseDraft } from '../src/ai.js';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const state = mkdtempSync(join(tmpdir(), 'tapty-'));
const wrangler = process.env.WRANGLER || 'npx wrangler';

// Поддельный Telegram: запоминает всё, что отправил бот.
const sent = [];
const tg = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const method = req.url.split('/').pop();
    sent.push({ method, body: JSON.parse(body || '{}') });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'tapty_test_bot' } : {} }));
  });
});

let server;
async function start(vars = {}) {
  const args = ['dev', ...localConfigs(), '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const [cmd, ...pre] = wrangler.split(' ');
  server = spawn(cmd, [...pre, ...args], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) return;
    } catch {}
  }
  throw new Error(`воркер не запустился:\n${log}`);
}
async function stop() {
  if (!server) return;
  try {
    process.kill(-server.pid);
  } catch {} // процесс мог уже завершиться, причина будет в ошибке запуска
  server = null;
  await new Promise((r) => setTimeout(r, 1500));
}

const key = () => randomBytes(32).toString('hex');
async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData) && !(body instanceof Uint8Array)) {
    h['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers: h, body });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, data: type.includes('json') ? await res.json() : await res.text() };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0xff, 0xd9]);
async function upload(token, bytes = jpeg) {
  const form = new FormData();
  form.set('full', new Blob([bytes]), 'full');
  form.set('thumb', new Blob([bytes]), 'thumb');
  return call('/api/photos', { token, method: 'POST', body: form });
}

const listing = (over = {}) => ({
  title: 'Велосипед горный', description: 'Почти новый, ЁЛОЧНЫЙ цвет', price: 85000, priceType: 'bargain',
  condition: 'used', category: 'hobby', city: 'astana', district: 'Есиль', name: 'Алия',
  phone: '8 (701) 123-45-67', whatsapp: true, telegram: '@aliya_kz', photos: [], ...over,
});

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('ok -', name);
}

try {
  await start({ ADMIN_KEY: 'секрет-админа' });
  const alice = key();
  const bob = key();
  let id, photo;

  await test('пустая лента', async () => {
    const r = await call('/api/listings');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { items: [], next: null, total: 0 });
  });

  await test('черновик по фото: поля, чистка ссылок и телефонов, отказы', async () => {
    const photo = (mode) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, mode, 0, 0xff, 0xd9]);
    const ask = (token, body) => call('/api/ai/draft?lang=ru', { token, method: 'POST', body, headers: { 'content-type': 'image/jpeg' } });
    const painter = key();
    assert.equal((await call('/api/config')).data.ai, true);
    assert.equal((await ask(undefined, photo(1))).status, 401);
    assert.equal((await ask(painter, new TextEncoder().encode('не картинка'))).status, 400);
    const ok = await ask(painter, photo(1));
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.draft.category, 'hobby');
    assert.equal(ok.data.draft.condition, 'used');
    assert.equal(ok.data.draft.description, 'Чёрная рама, заметны царапины.');
    assert.equal((await ask(painter, photo(2))).data.error, 'ai_unclear');
    assert.equal((await ask(painter, photo(3))).data.error, 'ai_failed');
    assert.equal((await ask(painter, photo(4))).data.error, 'ai_limit');
  });

  await test('разбор ответа модели', async () => {
    assert.equal(parseDraft(''), null);
    assert.equal(parseDraft('не знаю'), null);
    assert.equal(parseDraft('{"category": "x", "title": "Стул"}'), null);
    assert.equal(parseDraft('{"category": "hobby", "title": ""}'), null);
    assert.equal(parseDraft('{"category": "hobby", "title": "Мяч.", "condition": "?"}').title, 'Мяч');
    assert.equal(parseDraft('{"category": "services", "title": "Ремонт", "condition": "new"}').condition, null);
    const dirty = { category: 'hobby', title: 'Мяч t.me/shop', description: 'Сайт https://a.kz/x. Мяч 5 размера.' };
    assert.equal(parseDraft(JSON.stringify(dirty)), null);
    assert.equal(parseDraft(JSON.stringify({ ...dirty, title: 'Мяч кожаный' })).description, 'Мяч 5 размера.');
  });

  await test('без ключа подать нельзя', async () => {
    assert.equal((await call('/api/listings', { method: 'POST', body: listing() })).status, 401);
  });

  await test('фото: загрузка, отдача, отказ не-картинке', async () => {
    const r = await upload(alice);
    assert.equal(r.status, 201);
    photo = r.data.id;
    const res = await fetch(`${BASE}/p/${photo}/t`);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), jpeg);
    assert.equal((await upload(alice, new TextEncoder().encode('<script>alert(1)</script>'))).status, 400);
  });

  await test('проверка полей', async () => {
    for (const [over, field] of [
      [{ title: 'a' }, 'title'], [{ price: 0 }, 'price'], [{ phone: '+1 202 555 0100' }, 'phone'],
      [{ category: 'x' }, 'category'], [{ city: 'x' }, 'city'], [{ condition: '' }, 'condition'],
      [{ telegram: 'a b' }, 'telegram'], [{ photos: ['../x'] }, 'photos'],
    ]) {
      const r = await call('/api/listings', { token: alice, method: 'POST', body: listing(over) });
      assert.equal(r.status, 400, field);
      assert.equal(r.data.field, field);
    }
  });

  await test('чужое фото прикрепить нельзя', async () => {
    const r = await call('/api/listings', { token: bob, method: 'POST', body: listing({ photos: [photo] }) });
    assert.equal(r.data.error, 'photos_lost');
  });

  await test('создание и лента без телефона', async () => {
    const r = await call('/api/listings', { token: alice, method: 'POST', body: listing({ photos: [photo] }) });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    id = r.data.id;
    const feed = await call('/api/listings');
    assert.equal(feed.data.items[0].photo, photo);
    assert.ok(!JSON.stringify(feed.data).includes('77011234567'));
    const one = await call(`/api/listings/${id}`, { token: bob });
    assert.equal(one.data.item.mine, false);
    assert.ok(!JSON.stringify(one.data).includes('77011234567'));
    const contact = await call(`/api/listings/${id}/contact`, { method: 'POST' });
    assert.equal(contact.data.phone, '77011234567');
    assert.equal(contact.data.telegram, 'aliya_kz');
  });

  await test('поиск по-русски без учёта регистра и ё, фильтры, сортировка', async () => {
    const q = async (p) => (await call(`/api/listings?${new URLSearchParams(p)}`)).data.items.length;
    assert.equal(await q({ q: 'ВЕЛОСИПЕД елочный' }), 1);
    assert.equal(await q({ q: 'самолет' }), 0);
    assert.equal(await q({ city: 'astana', cat: 'hobby', min: 1000, max: 90000, cond: 'used', type: 'bargain', sort: 'cheap' }), 1);
    assert.equal(await q({ city: 'almaty' }), 0);
    assert.equal(await q({ max: 100 }), 0);
    assert.equal(await q({ q: "'; DROP TABLE listings; --" }), 0);
    assert.equal(await q({ ids: `${id},999` }), 1);
  });

  await test('услуга без состояния и «даром»', async () => {
    const r = await call('/api/listings', { token: bob, method: 'POST', body: listing({ title: 'Отдам котят', category: 'animals', condition: '', priceType: 'free', price: 500 }) });
    assert.equal(r.status, 201);
    const one = (await call(`/api/listings/${r.data.id}`)).data.item;
    assert.equal(one.price, 0);
    assert.equal(one.condition, null);
  });

  await test('чужое объявление нельзя менять и удалять', async () => {
    assert.equal((await call(`/api/listings/${id}`, { token: bob, method: 'PUT', body: listing() })).status, 404);
    assert.equal((await call(`/api/listings/${id}`, { token: bob, method: 'DELETE' })).status, 404);
    assert.equal((await call(`/api/mine/${id}`, { token: bob })).status, 404);
  });

  await test('мои объявления, правка, продано и возврат', async () => {
    assert.equal((await call('/api/mine', { token: alice })).data.items.length, 1);
    assert.equal((await call(`/api/listings/${id}`, { token: alice, method: 'PUT', body: listing({ price: 70000, photos: [photo] }) })).status, 200);
    await call(`/api/listings/${id}/status`, { token: alice, method: 'POST', body: { action: 'sold' } });
    assert.equal((await call('/api/listings?cat=hobby')).data.items.length, 0);
    assert.equal((await call(`/api/listings/${id}/contact`, { method: 'POST' })).status, 410);
    await call(`/api/listings/${id}/status`, { token: alice, method: 'POST', body: { action: 'restore' } });
    assert.equal((await call('/api/listings?cat=hobby')).data.items[0].price, 70000);
  });

  await test('страница продавца, похожие и счётчик', async () => {
    const second = (await call('/api/listings', { token: alice, method: 'POST', body: listing({ title: 'Самокат', city: 'almaty' }) })).data.id;
    const one = (await call(`/api/listings/${id}`, { token: bob })).data;
    assert.equal(one.seller.count, 2);
    assert.ok(one.seller.since > 0);
    assert.ok(one.similar.some((x) => x.id === second));
    assert.ok(one.similar.every((x) => x.id !== id));
    assert.equal(typeof one.item.whatsapp, 'boolean');
    const page = await call(`/api/listings/${id}/seller`);
    assert.equal(page.status, 200);
    assert.equal(page.data.seller.name, 'Алия');
    assert.deepEqual(page.data.items.map((x) => x.id).sort(), [id, second].sort());
    const text = JSON.stringify([one, page.data]);
    assert.ok(!text.includes(alice) && !/"owner"|77011234567/.test(text));
    assert.equal((await call('/api/listings')).data.total, 3);
    assert.equal((await call('/api/listings/999999/seller')).status, 404);
    assert.equal((await call(`/api/listings/${second}`, { token: alice, method: 'DELETE' })).status, 200);
  });

  await test('превью ссылки и обычные страницы', async () => {
    const page = await call(`/item/${id}`);
    assert.match(page.data, /<title>Велосипед горный — Tapty<\/title>/);
    assert.match(page.data, new RegExp(`/p/${photo}`));
    for (const path of ['/', '/search', '/me', '/new', `/seller/${id}`]) {
      const r = await fetch(BASE + path, { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } });
      assert.equal(r.status, 200, path);
      assert.match(await r.text(), /id="view"/);
    }
  });

  const adminHeaders = { 'x-admin-key': encodeURIComponent('секрет-админа') };
  await test('жалоба и модерация', async () => {
    assert.equal((await call(`/api/listings/${id}/report`, { method: 'POST', body: { reason: 'fraud' } })).status, 200);
    assert.equal((await call('/api/admin/reports', { headers: { 'x-admin-key': 'x' } })).status, 403);
    const q = await call('/api/admin/reports', { headers: adminHeaders });
    assert.equal(q.data.items[0].reports, 1);
    await call(`/api/admin/${id}`, { method: 'POST', body: { action: 'hide' }, headers: adminHeaders });
    assert.equal((await call(`/api/listings/${id}`, { token: bob })).status, 404);
    assert.equal((await call(`/api/listings/${id}/seller`)).status, 404);
    assert.equal((await call(`/api/listings/${id}`, { token: alice, method: 'DELETE' })).status, 403);
    await call(`/api/admin/${id}`, { method: 'POST', body: { action: 'ban' }, headers: adminHeaders });
    assert.equal((await call('/api/listings', { token: key(), method: 'POST', body: listing() })).data.error, 'banned');
    await call(`/api/admin/${id}`, { method: 'POST', body: { action: 'delete' }, headers: adminHeaders });
    // Кеш фото на краю сети живёт дальше, поэтому проверяем запрос без кеша.
    assert.equal((await fetch(`${BASE}/p/${photo}`)).status, 404);
  });

  await stop();
  await new Promise((r) => tg.listen(8798, '127.0.0.1', r));
  await start({ BOT_TOKEN: '1:test', TG_API: 'http://127.0.0.1:8798' });

  await test('с ботом: вход через Telegram и перенос объявлений', async () => {
    const guest = bob;
    assert.equal((await call('/api/config')).data.bot, 'tapty_test_bot');
    assert.equal((await call('/api/listings', { token: guest, method: 'POST', body: listing({ phone: '77020000000' }) })).data.error, 'login_required');

    const secretHeader = sent.find((s) => s.method === 'setWebhook').body.secret_token;
    const login = (await call('/api/auth/start', { token: guest, method: 'POST' })).data;
    const poll = () => call('/api/auth/poll', { headers: { 'x-login-nonce': login.nonce, 'x-login-secret': login.secret } });
    assert.equal((await poll()).data.status, 'pending');

    const hook = (body, secret = secretHeader) => call('/tg/webhook', { method: 'POST', body, headers: { 'x-telegram-bot-api-secret-token': secret } });
    assert.equal((await hook({}, 'wrong')).status, 403);
    await hook({ message: { chat: { id: 5, type: 'private' }, text: `/start ${login.nonce}` } });
    assert.match(sent.at(-1).body.text, new RegExp(login.code));
    await hook({ callback_query: { id: '1', data: `ok:${login.nonce}`, from: { id: 5, first_name: 'Данияр' }, message: { chat: { id: 5 }, message_id: 2 } } });

    const wrong = await call('/api/auth/poll', { headers: { 'x-login-nonce': login.nonce, 'x-login-secret': 'nope' } });
    assert.equal(wrong.data.status, 'expired');
    const done = (await poll()).data;
    assert.equal(done.status, 'ok');
    assert.equal((await poll()).data.status, 'expired');
    assert.equal((await call('/api/me', { token: done.token })).data.user.name, 'Данияр');
    assert.equal((await call('/api/mine', { token: done.token })).data.items.length, 1);
    assert.equal((await call('/api/mine', { token: guest })).data.items.length, 0);
    assert.equal((await call('/api/listings', { token: done.token, method: 'POST', body: listing({ phone: '77020000000' }) })).status, 201);
    await call('/api/auth/logout', { token: done.token, method: 'POST' });
    assert.equal((await call('/api/me', { token: done.token })).data.user, null);
  });

  console.log(`\nвсе проверки пройдены: ${passed}`);
} finally {
  await stop();
  tg.close();
  rmSync(state, { recursive: true, force: true });
}
