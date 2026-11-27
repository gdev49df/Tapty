// Проверка API на локальном воркере и временной базе: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { localConfigs } from './local.mjs';
import { parseDraft } from '../src/ai.js';
import { sameProduct, signature } from '../src/same.js';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const state = mkdtempSync(join(tmpdir(), 'tapty-'));
const wrangler = process.env.WRANGLER || 'npx wrangler';

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

// Новый аккаунт; guest — ключ устройства, с которого регистрируются.
let logins = 0;
async function signUp(name, { guest = key(), login = `user_${++logins}` } = {}) {
  const r = await call('/api/auth/register', { token: guest, method: 'POST', body: { login, name, key: key() } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}

// База в том виде, в каком её оставила прежняя версия сайта: проверяем, что она обновится сама.
const oldGuest = key();
function prepareOldDatabase() {
  const [cmd, ...pre] = wrangler.split(' ');
  const [, config] = localConfigs();
  const owner = `d:${createHash('sha256').update(oldGuest).digest('hex')}`;
  const run = (args) => execFileSync(cmd, [...pre, 'd1', 'execute', 'tapty', '--local', '--persist-to', state, '-c', config, '-y', ...args], { stdio: 'pipe' });
  run(['--file', fileURLToPath(new URL('old-schema.sql', import.meta.url))]);
  run(['--command', `UPDATE listings SET owner = '${owner}'`]);
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
  prepareOldDatabase();
  await start({ ADMIN_KEY: 'секрет-админа' });
  let alice;
  let bob;
  let id, photo;

  await test('старая база обновляется, объявление гостя переезжает в аккаунт', async () => {
    const before = (await call('/api/listings/1')).data;
    assert.equal(before.item.title, 'Старое кресло');
    assert.equal(before.item.oldPrice, 0);
    assert.equal(before.item.area, '');
    assert.equal(before.item.chat, false);
    const buyer = await signUp('Покупатель');
    assert.equal((await call('/api/listings/1/chat', { token: buyer, method: 'POST', body: { text: 'Привет' } })).data.error, 'no_chat');
    assert.equal((await call('/api/mine', { token: oldGuest })).data.items.length, 1);
    const owner = await signUp('Старый продавец', { guest: oldGuest });
    assert.equal((await call('/api/mine', { token: owner })).data.items.length, 1);
    assert.equal((await call('/api/mine', { token: oldGuest })).data.items.length, 0);
    assert.equal((await call('/api/listings/1')).data.item.chat, true);
    assert.equal((await call('/api/listings/1', { token: owner, method: 'DELETE' })).status, 200);
  });

  await test('пустая лента', async () => {
    const r = await call('/api/listings');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { items: [], next: null, total: 0 });
  });

  await test('регистрация, вход и выход', async () => {
    const secret = key();
    const register = (body) => call('/api/auth/register', { token: key(), method: 'POST', body });
    for (const [body, field] of [
      [{ login: 'ab', name: 'Имя', key: secret }, 'login'],
      [{ login: 'логин', name: 'Имя', key: secret }, 'login'],
      [{ login: 'aliya', name: 'Имя', key: 'password' }, 'password'],
      [{ login: 'aliya', name: 'И', key: secret }, 'name'],
    ]) {
      const r = await register(body);
      assert.equal(r.status, 400, field);
      assert.equal(r.data.field, field);
    }
    const done = await register({ login: 'Aliya', name: 'Алия', key: secret });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.deepEqual(done.data.user, { name: 'Алия', login: 'aliya' });
    assert.equal((await register({ login: 'ALIYA', name: 'Другая', key: secret })).data.error, 'login_taken');

    const signIn = (login, k) => call('/api/auth/login', { token: key(), method: 'POST', body: { login, key: k } });
    assert.equal((await signIn('aliya', key())).data.error, 'bad_credentials');
    assert.equal((await signIn('nobody', secret)).data.error, 'bad_credentials');
    const again = await signIn(' Aliya ', secret);
    assert.equal(again.status, 200);
    assert.deepEqual((await call('/api/me', { token: again.data.token })).data.user, { name: 'Алия', login: 'aliya' });
    await call('/api/auth/logout', { token: again.data.token, method: 'POST' });
    assert.equal((await call('/api/me', { token: again.data.token })).data.user, null);
    alice = done.data.token;
    bob = await signUp('Борис');

    let last;
    for (let i = 0; i < 11; i++) last = await signIn('bruteforce', key());
    assert.equal(last.data.error, 'rate_limit');
  });

  await test('черновик по фото: поля, чистка ссылок и телефонов, отказы', async () => {
    const photo = (mode) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, mode, 0, 0xff, 0xd9]);
    const ask = (token, body) => call('/api/ai/draft?lang=ru', { token, method: 'POST', body, headers: { 'content-type': 'image/jpeg' } });
    const painter = await signUp('Художник');
    assert.equal((await call('/api/config')).data.ai, true);
    assert.equal((await ask(undefined, photo(1))).status, 401);
    assert.equal((await ask(key(), photo(1))).data.error, 'login_required');
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

  await test('без аккаунта нельзя подать объявление и загрузить фото', async () => {
    for (const token of [undefined, key()]) {
      assert.equal((await call('/api/listings', { token, method: 'POST', body: listing() })).data.error, 'login_required');
      assert.equal((await upload(token)).data.error, 'login_required');
    }
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
    assert.equal(one.item.chat, true);
    const page = await call(`/api/listings/${id}/seller`);
    assert.equal(page.status, 200);
    assert.equal(page.data.seller.name, 'Алия');
    assert.deepEqual(page.data.items.map((x) => x.id).sort(), [id, second].sort());
    const text = JSON.stringify([one, page.data]);
    assert.ok(!text.includes(alice) && !/"owner"|77011234567|u:[a-f0-9]{24}/.test(text));
    assert.equal((await call('/api/listings')).data.total, 3);
    assert.equal((await call('/api/listings/999999/seller')).status, 404);
    assert.equal((await call(`/api/listings/${second}`, { token: alice, method: 'DELETE' })).status, 200);
  });

  await test('превью ссылки и обычные страницы', async () => {
    const page = await call(`/item/${id}`);
    assert.match(page.data, /<title>Велосипед горный — tapty\.<\/title>/);
    assert.match(page.data, new RegExp(`/p/${photo}`));
    for (const path of ['/', '/search', '/me', '/new', '/chats', '/chat/1', `/seller/${id}`]) {
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
    const other = await signUp('Тот же номер');
    assert.equal((await call('/api/listings', { token: other, method: 'POST', body: listing() })).data.error, 'banned');
    assert.equal((await upload(alice)).data.error, 'banned');
    await call(`/api/admin/${id}`, { method: 'POST', body: { action: 'delete' }, headers: adminHeaders });
    // Кеш фото на краю сети живёт дальше, поэтому проверяем запрос без кеша.
    assert.equal((await fetch(`${BASE}/p/${photo}`)).status, 404);
  });

  const create = async (token, over) => {
    const r = await call('/api/listings', { token, method: 'POST', body: listing(over) });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.id;
  };
  const read = async (itemId, token) => (await call(`/api/listings/${itemId}`, { token })).data;

  await test('снижение цены: прежняя показывается, пока цена ниже неё', async () => {
    const seller = await signUp('Скидка');
    const body = { title: 'Кресло офисное', phone: '77030000001', price: 50000 };
    const item = await create(seller, body);
    const set = async (price, priceType = 'bargain') => {
      const r = await call(`/api/listings/${item}`, { token: seller, method: 'PUT', body: listing({ ...body, price, priceType }) });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return (await read(item)).item.oldPrice;
    };
    assert.equal((await read(item)).item.oldPrice, 0);
    assert.equal(await set(40000), 50000);
    assert.equal(await set(40000), 50000);
    assert.equal(await set(30000, 'fixed'), 50000);
    assert.equal((await call('/api/listings?ids=' + item)).data.items[0].oldPrice, 50000);
    assert.equal(await set(45000), 0);
    assert.equal(await set(44000), 45000);
    assert.equal(await set(60000), 0);
    assert.equal(await set(0, 'free'), 0);
    assert.equal(await set(100), 0);
  });

  await test('районы: только из списка своего города, фильтр', async () => {
    const seller = await signUp('Район');
    const body = { title: 'Стол письменный', phone: '77030000002', category: 'home_garden' };
    for (const over of [{ area: 'alm_medeu' }, { area: 'x' }, { city: 'shymkent', area: 'ast_esil' }]) {
      const r = await call('/api/listings', { token: seller, method: 'POST', body: listing({ ...body, ...over }) });
      assert.equal(r.data.field, 'area', JSON.stringify(over));
    }
    const item = await create(seller, { ...body, area: 'ast_nura' });
    const found = async (p) => (await call(`/api/listings?cat=home_garden&${p}`)).data.items.map((x) => x.id);
    assert.deepEqual(await found('city=astana&area=ast_nura'), [item]);
    assert.deepEqual(await found('city=astana&area=ast_esil'), []);
    assert.equal((await read(item)).item.area, 'ast_nura');
  });

  await test('какие названия считаются одним товаром', async () => {
    const same = (a, b) => sameProduct(signature(a), signature(b));
    for (const [a, b] of [
      ['iPhone 13, 128 ГБ', 'Продам айфон 13 256гб черный'],
      ['iPhone 13', 'Apple iPhone13 128'],
      ['iPhone 14 Pro Max', 'айфон 14 про макс'],
      ['Samsung Galaxy S23', 'самсунг галакси s23 8/256'],
      ['Sony PlayStation 5', 'ps5 sony'],
      ['Велосипед горный Trek', 'горный велосипед trek'],
    ]) assert.ok(same(a, b), `${a} = ${b}`);
    for (const [a, b] of [
      ['iPhone 13', 'iPhone 14'],
      ['iPhone 13', 'iPhone 13 Pro'],
      ['iPhone 13', 'Чехол для iPhone 13'],
      ['Samsung Galaxy S23', 'Samsung Galaxy A23'],
      ['Ноутбук Asus 15', 'Монитор Asus 15'],
      ['Диван', 'Диван угловой'],
      ['Велосипед горный', 'Велосипед детский'],
    ]) assert.ok(!same(a, b), `${a} != ${b}`);
  });

  await test('такие же товары по другой цене', async () => {
    const phone = (token, title, price, n) => create(token, { title, price, category: 'phones', phone: `7704000000${n}` });
    const [a, b, c] = [await signUp('Анна'), await signUp('Боря'), await signUp('Вера')];
    const mine = await phone(a, 'iPhone 13, 128 ГБ', 200000, 1);
    await phone(a, 'iPhone 13 второй', 150000, 1);
    const cheap = await phone(b, 'Айфон 13 синий', 180000, 2);
    const dear = await phone(c, 'iPhone 13 256gb', 230000, 3);
    await phone(b, 'iPhone 13 Pro', 300000, 2);
    await phone(c, 'iPhone 13', 200000, 3); // та же цена
    await phone(c, 'iPhone 13', 5000, 3); // слишком дёшево, чтобы быть тем же
    const r = await read(mine);
    assert.deepEqual(r.same.map((x) => x.id), [cheap, dear]);
    assert.ok(r.similar.every((x) => x.id !== cheap && x.id !== dear));
  });

  let chatId;
  let itemId;
  let seller;
  let buyer;
  const say = (token, text) => call(`/api/chats/${chatId}`, { token, method: 'POST', body: { text } });
  const unread = async (token) => (await call('/api/chats/unread', { token })).data.count;

  await test('чат: начало, непрочитанные, прочтение, чужим не виден', async () => {
    seller = await signUp('Сауле');
    buyer = await signUp('Тимур');
    itemId = await create(seller, { title: 'Гитара акустическая', phone: '77050000001', price: 40000 });
    const start = (token, text) => call(`/api/listings/${itemId}/chat`, { token, method: 'POST', body: { text } });
    assert.equal((await start(key(), 'Здравствуйте')).data.error, 'login_required');
    assert.equal((await start(seller, 'Себе')).data.error, 'own_listing');
    assert.equal((await start(buyer, '   ')).status, 400);
    assert.equal((await start(buyer, 'я'.repeat(1001))).status, 400);
    const first = await start(buyer, 'Ещё продаётся?');
    assert.equal(first.status, 201, JSON.stringify(first.data));
    chatId = first.data.chat;
    assert.equal((await start(buyer, '<img src=x onerror=alert(1)>')).data.chat, chatId);

    assert.equal(await unread(seller), 2);
    assert.equal(await unread(buyer), 0);
    assert.equal(await unread(key()), 0);
    const list = (await call('/api/chats', { token: seller })).data.items;
    assert.equal(list.length, 1);
    assert.equal(list[0].other, 'Тимур');
    assert.equal(list[0].unread, 2);
    assert.equal(list[0].lastMine, false);

    const unseen = (await call(`/api/chats/${chatId}`, { token: buyer })).data;
    assert.equal(unseen.read, 0);
    const opened = (await call(`/api/chats/${chatId}`, { token: seller })).data;
    assert.deepEqual(opened.messages.map((x) => x.mine), [false, false]);
    assert.equal(opened.chat.buying, false);
    assert.equal(await unread(seller), 0);
    const seen = (await call(`/api/chats/${chatId}`, { token: buyer })).data;
    assert.equal(seen.read, seen.messages.at(-1).id);
    assert.ok(!/u:[a-f0-9]{24}/.test(JSON.stringify([list, opened, seen])));

    const stranger = await signUp('Чужой');
    assert.equal((await call(`/api/chats/${chatId}`, { token: stranger })).status, 404);
    assert.equal((await say(stranger, 'влезу')).status, 404);
    assert.equal((await call('/api/chats', { token: stranger })).data.items.length, 0);
    assert.equal((await call('/api/chats', { token: key() })).status, 401);
  });

  await test('отзыв: только после ответа продавца, один на человека', async () => {
    const send = (token, rating, text = '', path = `/api/listings/${itemId}/review`) =>
      call(path, { token, method: 'POST', body: { rating, text } });
    assert.equal((await send(buyer, 5)).data.error, 'review_not_allowed');
    assert.equal((await say(seller, 'Да, продаётся')).status, 201);
    assert.equal((await call(`/api/chats/${chatId}?after=0`, { token: buyer })).data.chat.canReview, true);
    assert.equal((await call(`/api/chats/${chatId}`, { token: seller })).data.chat.canReview, false);
    assert.equal((await send(seller, 5)).data.error, 'review_not_allowed');
    assert.equal((await send(bob, 5)).data.error, 'review_not_allowed');
    assert.equal((await send(key(), 5)).data.error, 'login_required');
    for (const bad of [0, 6, 4.5, 'x']) assert.equal((await send(buyer, bad)).status, 400);
    assert.equal((await send(buyer, 5, 'Всё честно')).status, 200);
    assert.equal((await send(buyer, 4, 'Всё честно, чуть опоздала')).status, 200);
    const page = (await call(`/api/listings/${itemId}/seller`, { token: buyer })).data;
    assert.equal(page.seller.reviews, 1);
    assert.equal(page.seller.rating, 4);
    assert.equal(page.seller.verified, false);
    assert.equal(page.reviews.canReview, true);
    assert.deepEqual(page.reviews.items.map((x) => [x.name, x.rating, x.mine]), [['Тимур', 4, true]]);
    assert.equal((await call(`/api/listings/${itemId}/review`, { token: buyer, method: 'DELETE' })).status, 200);
    assert.equal((await read(itemId)).seller.reviews, 0);
  });

  await test('значок проверенного продавца и отзыв после удаления объявления', async () => {
    const buyers = [buyer, await signUp('Второй'), await signUp('Третий')];
    for (const token of buyers.slice(1)) {
      const r = await call(`/api/listings/${itemId}/chat`, { token, method: 'POST', body: { text: 'Возьму' } });
      assert.equal((await call(`/api/chats/${r.data.chat}`, { token: seller, method: 'POST', body: { text: 'Хорошо' } })).status, 201);
    }
    for (const [i, token] of buyers.slice(0, 2).entries()) {
      assert.equal((await call(`/api/listings/${itemId}/review`, { token, method: 'POST', body: { rating: 5 - i } })).status, 200);
    }
    assert.equal((await read(itemId)).seller.verified, false);
    const last = (await call('/api/chats', { token: buyers[2] })).data.items[0].id;
    // Продавец удалил объявление — переписка и право на отзыв остаются.
    const spare = await create(seller, { title: 'Струны', phone: '77050000001', price: 2000 });
    assert.equal((await call(`/api/listings/${itemId}`, { token: seller, method: 'DELETE' })).status, 200);
    const gone = (await call(`/api/chats/${last}`, { token: buyers[2] })).data.chat;
    assert.equal(gone.listing.status, 'gone');
    assert.equal(gone.listing.title, 'Гитара акустическая');
    assert.equal((await call(`/api/chats/${last}/review`, { token: buyers[2], method: 'POST', body: { rating: 5, text: 'Отлично' } })).status, 200);
    assert.equal((await call(`/api/chats/${last}/review`, { token: buyers[1], method: 'POST', body: { rating: 1 } })).status, 404);
    const info = (await read(spare)).seller;
    assert.deepEqual([info.reviews, info.rating, info.verified], [3, 4.7, true]);

    const queue = (await call('/api/admin/reviews', { headers: adminHeaders })).data.items;
    assert.equal(queue.length, 3);
    assert.equal((await call(`/api/admin/reviews/${queue[0].id}`, { method: 'DELETE', headers: { 'x-admin-key': 'x' } })).status, 403);
    await call(`/api/admin/reviews/${queue[0].id}`, { method: 'DELETE', headers: adminHeaders });
    assert.equal((await read(spare)).seller.reviews, 2);
  });

  await test('в чате нельзя слать без остановки', async () => {
    let r;
    for (let i = 0; i < 31; i++) r = await say(buyer, `сообщение ${i}`);
    assert.equal(r.data.error, 'rate_limit');
  });

  console.log(`\nвсе проверки пройдены: ${passed}`);
} finally {
  await stop();
  rmSync(state, { recursive: true, force: true });
}
