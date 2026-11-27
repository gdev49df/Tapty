// Проверка API на локальном воркере и временной базе: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { localConfigs } from './local.mjs';
import { parseDraft } from '../src/ai.js';
import { LEGAL_VERSION } from '../public/js/catalog.js';
import { insecure, network } from '../src/util.js';
import { codeAt, secretBytes } from '../src/totp.js';
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
async function signUp(name, { guest = key(), login = `user_${++logins}`, ip, secret = key() } = {}) {
  const headers = ip ? { 'cf-connecting-ip': ip } : {};
  const r = await call('/api/auth/register', { token: guest, method: 'POST', body: { login, name, key: secret, consent: LEGAL_VERSION }, headers });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}

// База в том виде, в каком её оставила прежняя версия сайта: проверяем, что она обновится сама.
const oldGuest = key();
function runD1(args) {
  const [cmd, ...pre] = wrangler.split(' ');
  const [, config] = localConfigs();
  return execFileSync(cmd, [...pre, 'd1', 'execute', 'tapty', '--local', '--persist-to', state, '-c', config, '-y', ...args], { stdio: 'pipe' });
}
const runSql = (sql) => runD1(['--command', sql]);
const querySql = (sql) => JSON.parse(runD1(['--command', sql, '--json']).toString())[0].results;
function prepareOldDatabase() {
  const owner = `d:${createHash('sha256').update(oldGuest).digest('hex')}`;
  runD1(['--file', fileURLToPath(new URL('old-schema.sql', import.meta.url))]);
  runSql(`UPDATE listings SET owner = '${owner}'`);
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
    const register = (body) => call('/api/auth/register', { token: key(), method: 'POST', body: { consent: LEGAL_VERSION, ...body } });
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
    assert.match(done.data.code, /^([0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal((await register({ login: 'ALIYA', name: 'Другая', key: secret })).data.error, 'login_taken');

    const signIn = (login, k) => call('/api/auth/login', { token: key(), method: 'POST', body: { login, key: k } });
    assert.equal((await signIn('aliya', key())).data.error, 'bad_credentials');
    assert.equal((await signIn('nobody', secret)).data.error, 'bad_credentials');
    const again = await signIn(' Aliya ', secret);
    assert.equal(again.status, 200);
    assert.deepEqual((await call('/api/me', { token: again.data.token })).data.user, { name: 'Алия', login: 'aliya', recovery: true });
    assert.equal(again.data.code, undefined);
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
    assert.equal(contact.data.telegram, '');
    assert.equal((await call(`/api/listings/${id}/contact`, { token: bob, method: 'POST' })).data.telegram, 'aliya_kz');
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

  await test('«Телефоны» объединены с электроникой, старый id принимается', async () => {
    const token = await signUp('Нурлан');
    const old = await create(token, { title: 'Телефон кнопочный Nokia', category: 'phones', city: 'oral', phone: '77040000009' });
    assert.equal((await read(old)).item.category, 'electronics');
    const found = async (cat) => (await call(`/api/listings?city=oral&cat=${cat}`)).data.items.map((x) => x.id);
    assert.deepEqual(await found('electronics'), [old]);
    assert.deepEqual(await found('phones'), [old]);
    assert.equal((await call('/api/listings', { token, method: 'POST', body: listing({ category: 'constructor' }) })).status, 400);
    // объявление, сохранённое прежней версией, переезжает при запуске новой
    await stop();
    runSql(`UPDATE listings SET category = 'phones' WHERE id = ${old}`);
    await start({ ADMIN_KEY: 'секрет-админа' });
    assert.deepEqual(await found('electronics'), [old]);
    assert.equal((await read(old)).item.category, 'electronics');
    // дальше проверки считают электронику с нуля
    assert.equal((await call(`/api/listings/${old}`, { token, method: 'DELETE' })).status, 200);
  });

  await test('такие же товары по другой цене', async () => {
    const phone = (token, title, price, n) => create(token, { title, price, category: 'kids', phone: `7704000000${n}` });
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

  // Своя «сеть» для остальных проверок, чтобы не упереться в дневной предел регистраций.
  const ip = '203.0.113.7';
  const enter = (name, over = {}) => signUp(name, { ip, ...over });
  const post = (path, token, body) => call(path, { token, method: 'POST', body, headers: { 'cf-connecting-ip': ip } });
  const me = async (token) => (await call('/api/me', { token })).data.user;

  await test('резервный код: восстановление пароля, смена пароля, новый код', async () => {
    const first = key();
    const made = (await post('/api/auth/register', key(), { login: 'roza', name: 'Роза', key: first, consent: LEGAL_VERSION })).data;
    const signIn = (k) => post('/api/auth/login', key(), { login: 'roza', key: k });
    const recover = (code, k, login = 'roza') => post('/api/auth/recover', key(), { login, code, key: k });
    const second = key();
    assert.equal((await recover('0000-0000-0000-0000', second)).data.error, 'bad_code');
    assert.equal((await recover(made.code, second, 'nobody')).data.error, 'bad_code');
    // код можно вводить строчными, без дефисов и с пробелами
    const back = await recover(` ${made.code.toLowerCase().replaceAll('-', ' ')} `, second);
    assert.equal(back.status, 200, JSON.stringify(back.data));
    assert.notEqual(back.data.code, made.code);
    assert.equal(await me(made.token), null);
    assert.equal((await me(back.data.token)).login, 'roza');
    assert.equal((await signIn(first)).data.error, 'bad_credentials');
    assert.equal((await recover(made.code, key())).data.error, 'bad_code');

    const other = (await signIn(second)).data.token;
    const third = key();
    assert.equal((await post('/api/auth/password', key(), { key: second, newKey: third })).data.error, 'login_required');
    const wrong = await post('/api/auth/password', other, { key: first, newKey: third });
    assert.deepEqual([wrong.status, wrong.data.error], [403, 'wrong_password']);
    assert.equal((await post('/api/auth/password', other, { key: second, newKey: 'x' })).status, 400);
    assert.equal((await post('/api/auth/password', other, { key: second, newKey: third })).status, 200);
    assert.equal((await me(other)).login, 'roza');
    assert.equal(await me(back.data.token), null);
    assert.equal((await signIn(second)).data.error, 'bad_credentials');
    assert.equal((await signIn(third)).status, 200);

    assert.equal((await post('/api/auth/code', other, { key: second })).data.error, 'wrong_password');
    const fresh = (await post('/api/auth/code', other, { key: third })).data.code;
    assert.equal((await recover(back.data.code, key())).data.error, 'bad_code');
    assert.equal((await recover(fresh, key())).status, 200);

    let last;
    for (let i = 0; i < 6; i++) last = await recover('1111-1111-1111-1111', key(), 'guessing');
    assert.equal(last.data.error, 'rate_limit');
  });

  let anna;
  let boris;
  let talk;
  let shot;
  const form = (bytes = jpeg) => {
    const data = new FormData();
    data.set('full', new Blob([bytes]), 'full');
    data.set('thumb', new Blob([bytes]), 'thumb');
    return data;
  };

  await test('фото в чате видят только участники', async () => {
    [anna, boris] = [await enter('Продавец'), await enter('Покупатель два')];
    const goods = await create(anna, { title: 'Пылесос моющий', phone: '77060000001', price: 30000, category: 'electronics' });
    talk = (await post(`/api/listings/${goods}/chat`, boris, { text: 'Пришлите фото' })).data.chat;
    assert.equal((await post(`/api/chats/${talk}/photo`, anna, form(new TextEncoder().encode('не картинка')))).status, 400);
    const sent = await post(`/api/chats/${talk}/photo`, anna, form());
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    shot = sent.data.message.photo;
    assert.equal((await call('/api/chats', { token: boris })).data.items[0].last, '');
    assert.equal(await unread(boris), 1);
    assert.equal((await call(`/api/chats/${talk}`, { token: boris })).data.messages.at(-1).photo, shot);
    for (const size of ['', '/t']) {
      const r = await fetch(`${BASE}/api/chats/${talk}/photos/${shot}${size}`, { headers: { authorization: `Bearer ${boris}` } });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('cache-control'), /private/);
      assert.deepEqual(new Uint8Array(await r.arrayBuffer()), jpeg);
      assert.equal((await fetch(`${BASE}/p/${shot}${size}`)).status, 404);
    }
    const stranger = await enter('Посторонний');
    assert.equal((await call(`/api/chats/${talk}/photos/${shot}`, { token: stranger })).status, 404);
    assert.equal((await call(`/api/chats/${talk}/photos/${shot}`, { token: key() })).status, 401);
    assert.equal((await post(`/api/chats/${talk}/photo`, stranger, form())).status, 404);
    // через свой диалог чужой снимок тоже не достать
    const theirs = (await post(`/api/listings/${goods}/chat`, stranger, { text: 'Здравствуйте' })).data.chat;
    assert.equal((await call(`/api/chats/${theirs}/photos/${shot}`, { token: stranger })).status, 404);
    const attach = await call('/api/listings', { token: anna, method: 'POST', body: listing({ phone: '77060000001', photos: [shot] }) });
    assert.equal(attach.data.error, 'photos_lost');
  });

  await test('блокировка закрывает переписку в обе стороны', async () => {
    const block = (token, method = 'POST') => call(`/api/chats/${talk}/block`, { token, method });
    const text = (token) => post(`/api/chats/${talk}`, token, { text: 'Ау' });
    assert.equal((await block(await enter('Мимо'))).status, 404);
    assert.equal((await block(key())).status, 401);
    assert.equal((await block(boris)).status, 200);
    assert.equal((await block(boris)).status, 200);
    assert.equal((await text(anna)).data.error, 'blocked');
    assert.equal((await post(`/api/chats/${talk}/photo`, anna, form())).data.error, 'blocked');
    assert.equal((await text(boris)).data.error, 'you_blocked');
    const another = await create(anna, { title: 'Утюг паровой', phone: '77060000001', price: 9000, category: 'electronics' });
    assert.equal((await post(`/api/listings/${another}/chat`, boris, { text: 'А это?' })).data.error, 'you_blocked');
    const seen = async (token) => (await call(`/api/chats/${talk}`, { token })).data.chat;
    assert.deepEqual([(await seen(boris)).blockedByMe, (await seen(boris)).canWrite], [true, false]);
    assert.deepEqual([(await seen(anna)).blockedByMe, (await seen(anna)).canWrite], [false, false]);
    assert.equal((await call('/api/chats', { token: boris })).data.items[0].blocked, true);
    // снять чужую блокировку нельзя
    await block(anna, 'DELETE');
    assert.equal((await text(anna)).data.error, 'blocked');
    await block(boris, 'DELETE');
    assert.equal((await text(anna)).status, 201);
  });

  await test('закрепить и удалить чат можно только у себя', async () => {
    const act = (token, path, method) => call(`/api/chats/${path}`, { token, method });
    const ids = async (token) => (await call('/api/chats', { token })).data.items.map((c) => c.id);
    const open = async (token) => (await call(`/api/chats/${talk}`, { token })).data;
    const kettle = await create(anna, { title: 'Чайник электрический', phone: '77060000001', price: 7000, category: 'electronics' });
    const newer = (await post(`/api/listings/${kettle}/chat`, boris, { text: 'Свободен?' })).data.chat;
    const stranger = await enter('Чужой');
    for (const [path, method] of [[`${talk}/pin`, 'POST'], [`${talk}/pin`, 'DELETE'], [`${talk}`, 'DELETE']]) {
      assert.equal((await act(stranger, path, method)).status, 404);
      assert.equal((await act(key(), path, method)).status, 401);
    }

    assert.equal((await ids(boris))[0], newer);
    assert.equal((await act(boris, `${talk}/pin`, 'POST')).status, 200);
    assert.deepEqual([(await ids(boris))[0], (await open(boris)).chat.pinned], [talk, true]);
    assert.deepEqual([(await ids(anna))[0], (await open(anna)).chat.pinned], [newer, false]);
    await act(boris, `${talk}/pin`, 'DELETE');
    assert.equal((await ids(boris))[0], newer);

    await act(boris, `${talk}/pin`, 'POST');
    await post(`/api/chats/${talk}`, anna, { text: 'Непрочитанное' });
    const before = (await call('/api/chats/unread', { token: boris })).data.count;
    const history = (await open(anna)).messages.length;
    assert.equal((await act(boris, `${talk}`, 'DELETE')).status, 200);
    assert.ok(!(await ids(boris)).includes(talk));
    assert.ok((await call('/api/chats/unread', { token: boris })).data.count < before);
    assert.deepEqual([(await open(boris)).messages, (await open(boris)).chat.pinned], [[], false]);
    // у собеседника всё на месте
    assert.ok((await ids(anna)).includes(talk));
    assert.equal((await open(anna)).messages.length, history);
    // новое сообщение возвращает диалог, но без удалённого
    await post(`/api/chats/${talk}`, anna, { text: 'Вы тут?' });
    assert.ok((await ids(boris)).includes(talk));
    assert.deepEqual((await open(boris)).messages.map((m) => m.text), ['Вы тут?']);
    const card = (await call('/api/chats', { token: boris })).data.items.find((c) => c.id === talk);
    assert.deepEqual([card.unread, card.pinned], [0, false]);
  });

  await test('жалоба из чата и решение модератора', async () => {
    const complain = (token, body) => post(`/api/chats/${talk}/complaint`, token, body);
    assert.equal((await complain(boris, { reason: 'bored' })).status, 400);
    assert.equal((await complain(key(), { reason: 'spam' })).data.error, 'login_required');
    assert.equal((await complain(await enter('Сбоку'), { reason: 'spam' })).status, 404);
    const admin = (path, options = {}) => call(`/api/admin/${path}`, { ...options, headers: adminHeaders });
    assert.equal((await admin(`chat-photos/${shot}`)).status, 404); // пока жалобы нет
    assert.equal((await complain(boris, { reason: 'spam' })).status, 201);
    assert.equal((await complain(boris, { reason: 'fraud', comment: 'Просит предоплату', block: true })).status, 201);
    assert.equal((await post(`/api/chats/${talk}`, anna, { text: 'Эй' })).data.error, 'blocked');
    let queue = (await admin('complaints')).data.items;
    assert.equal(queue.length, 1);
    assert.deepEqual(
      [queue[0].reason, queue[0].comment, queue[0].author, queue[0].accused, queue[0].banned],
      ['fraud', 'Просит предоплату', 'Покупатель два', 'Продавец', false]
    );
    assert.ok(queue[0].messages.some((m) => m.photo === shot && m.accused));
    assert.equal(queue[0].messages[0].text, 'Пришлите фото');
    assert.equal((await admin(`chat-photos/${shot}`)).status, 200);
    assert.equal((await call(`/api/admin/chat-photos/${shot}`, { headers: { 'x-admin-key': 'x' } })).status, 403);
    assert.equal((await call('/api/admin/complaints', { token: boris, headers: { 'x-admin-key': 'x' } })).status, 403);
    await admin(`complaints/${queue[0].id}`, { method: 'POST', body: { action: 'dismiss' } });
    assert.equal((await admin('complaints')).data.items.length, 0);
    assert.equal((await me(anna)).name, 'Продавец');
    await complain(boris, { reason: 'fraud' });
    queue = (await admin('complaints')).data.items;
    await admin(`complaints/${queue[0].id}`, { method: 'POST', body: { action: 'ban' } });
    assert.equal((await post('/api/listings', anna, listing({ phone: '77060000009' }))).data.error, 'banned');
    assert.equal((await call('/api/listings?cat=electronics')).data.items.length, 0);
    const clean = await enter('Новый аккаунт');
    assert.equal((await post('/api/listings', clean, listing({ phone: '77060000001' }))).data.error, 'banned');
    assert.equal((await post('/api/listings', clean, listing({ phone: '77060000008' }))).status, 201);
  });

  await test('подсказка цены: похожие, проданные, состояние', async () => {
    const hint = async (over = {}, token) =>
      (await call(`/api/price-hint?${new URLSearchParams({ title: 'Монитор Dell P2419H', cat: 'electronics', ...over })}`, { token })).data;
    assert.deepEqual(await hint(), { count: 0 });
    const [x, y] = [await enter('Икс'), await enter('Игрек')];
    const sell = (token, price, n, over = {}) =>
      create(token, { title: 'Монитор Dell P2419H', category: 'electronics', phone: `7707000000${n}`, price, ...over });
    const one = await sell(x, 50000, 1);
    assert.deepEqual(await hint(), { count: 1, low: 50000, high: 50000, typical: 0, otherCondition: false });
    const sold = await sell(x, 60000, 1, { title: 'Dell P2419H монитор' });
    await post(`/api/listings/${sold}/status`, x, { action: 'sold' });
    await sell(y, 55555, 2);
    await sell(y, 900000, 2); // в разы дороже остальных
    await sell(y, 1000, 2, { title: 'Монитор Dell U2722D' }); // другая модель
    assert.deepEqual(await hint(), { count: 3, low: 50000, high: 60000, typical: 55600, otherCondition: false });
    assert.equal((await hint({}, x)).count, 1); // свои объявления не считаются
    assert.equal((await hint({ exclude: one })).count, 2);
    assert.deepEqual([(await hint({ cond: 'used' })).count, (await hint({ cond: 'used' })).otherCondition], [3, false]);
    assert.equal((await hint({ cond: 'new' })).otherCondition, true);
    await sell(y, 80000, 2, { condition: 'new' });
    assert.deepEqual(await hint({ cond: 'new' }), { count: 1, low: 80000, high: 80000, typical: 0, otherCondition: false });
    assert.deepEqual(await hint({ cat: 'x' }), { count: 0 });
    assert.deepEqual(await hint({ title: '!!!' }), { count: 0 });
  });

  await test('без аккаунта нельзя лайкать и писать', async () => {
    const [owner, fan, other] = [await enter('Хозяин'), await enter('Поклонник'), await enter('Другой')];
    const mk = (title) => create(owner, { title, phone: '77080000001' });
    const [one, two] = [await mk('Лампа настольная'), await mk('Стол письменный')];
    const fav = (token, path = '', method = 'GET', body) => call(`/api/favorites${path}`, { token, method, body });
    for (const token of [undefined, key()]) {
      for (const r of [await fav(token), await fav(token, `/${one}`, 'PUT'), await fav(token, `/${one}`, 'DELETE'), await fav(token, '', 'POST', { ids: [one] })]) {
        assert.equal(r.status, 401);
        assert.equal(r.data.error, 'login_required');
      }
      assert.equal((await call(`/api/listings/${one}/chat`, { token, method: 'POST', body: { text: 'Привет' } })).data.error, 'login_required');
      const contact = (await call(`/api/listings/${one}/contact`, { token, method: 'POST' })).data;
      assert.deepEqual(contact, { phone: '77080000001', whatsapp: false, telegram: '', locked: true, name: 'Алия' });
    }
    const open = (await call(`/api/listings/${one}/contact`, { token: fan, method: 'POST' })).data;
    assert.deepEqual([open.whatsapp, open.telegram, open.locked], [true, 'aliya_kz', false]);

    assert.deepEqual((await fav(fan)).data, { ids: [] });
    assert.deepEqual((await fav(fan, `/${one}`, 'PUT')).data.ids, [one]);
    assert.deepEqual((await fav(fan, `/${one}`, 'PUT')).data.ids, [one]);
    assert.deepEqual((await fav(fan, '/999999', 'PUT')).data.ids, [one]);
    assert.deepEqual((await fav(other)).data.ids, []);
    // перенос отметок с устройства: мусор и несуществующие номера отбрасываются
    const moved = (await fav(other, '', 'POST', { ids: [two, 'x', -1, 999999, one, two] })).data.ids;
    assert.deepEqual(moved, [two, one]);
    assert.deepEqual((await fav(other, `/${two}`, 'DELETE')).data.ids, [one]);
    await call(`/api/listings/${one}`, { token: owner, method: 'DELETE' });
    assert.deepEqual([(await fav(fan)).data.ids, (await fav(other)).data.ids], [[], []]);
  });

  await test('защитные заголовки у страниц, ответов и фото', async () => {
    const owner = await signUp('Заголовки', { ip: '203.0.113.40' });
    const photoId = (await upload(owner)).data.id;
    await create(owner, { title: 'Лампа настольная', phone: '77090000001', photos: [photoId] });
    const item = (await call('/api/listings')).data.items[0].id;
    for (const path of ['/', '/search', `/item/${item}`, '/js/app.js', '/api/config', `/p/${photoId}`, '/api/nothing']) {
      const r = await fetch(BASE + path);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', path);
      assert.match(r.headers.get('strict-transport-security') || '', /max-age=31536000; includeSubDomains/, path);
      assert.ok(r.headers.get('content-security-policy'), path);
    }
    const csp = (await fetch(`${BASE}/`)).headers.get('content-security-policy');
    assert.match(csp, /script-src 'self';.*frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe/);
    const photo = await fetch(`${BASE}/p/${photoId}?x=1`);
    assert.match(photo.headers.get('content-security-policy'), /sandbox/);
    assert.match(photo.headers.get('cache-control'), /s-maxage=86400/);
  });

  await test('большое тело запроса отклоняется', async () => {
    const r = await call('/api/auth/login', { method: 'POST', body: { login: 'a'.repeat(200_000) } });
    assert.equal(r.data.error, 'too_large');
  });

  await test('сети IPv6 считаются целиком', async () => {
    assert.equal(network('203.0.113.7'), '203.0.113.7');
    assert.equal(network('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), network('2001:0db8:0001:0002::1'));
    assert.notEqual(network('2001:db8:1:2::1'), network('2001:db8:1:3::1'));
    assert.equal(network('2001:db8::1'), network('2001:db8:0:0:9::'));
  });

  await test('пароль одного аккаунта нельзя перебирать со многих адресов', async () => {
    const password = key();
    const login = 'brute_target';
    const send = (secret, ip) =>
      call('/api/auth/login', { token: key(), method: 'POST', body: { login, key: secret }, headers: { 'cf-connecting-ip': ip } });
    await call('/api/auth/register', { token: key(), method: 'POST', body: { login, name: 'Цель', key: password, consent: LEGAL_VERSION }, headers: { 'cf-connecting-ip': '198.51.100.1' } });
    // удачные входы в счёт не идут
    for (let i = 0; i < 3; i++) assert.equal((await send(password, '198.51.100.2')).status, 200);
    for (let i = 0; i < 50; i++) assert.equal((await send(key(), `198.51.101.${Math.floor(i / 5) + 1}`)).status, 401, `попытка ${i}`);
    assert.equal((await send(password, '198.51.100.3')).data.error, 'rate_limit');
  });

  await test('ключ админки нельзя подбирать, даже угадав после предела', async () => {
    const send = (secret, ip) =>
      call('/api/admin/reports', { headers: { 'x-admin-key': encodeURIComponent(secret), 'cf-connecting-ip': ip } });
    for (let i = 0; i < 25; i++) assert.equal((await send('секрет-админа', '192.0.2.10')).status, 200);
    const burst = await Promise.all(Array.from({ length: 30 }, () => send('мимо', '2001:db8:5:5::1')));
    assert.equal(burst.filter((r) => r.status === 403).length, 20);
    assert.equal(burst.filter((r) => r.status === 429).length, 10);
    // другой адрес той же сети /64 тоже закрыт, остальные — нет
    assert.equal((await send('секрет-админа', '2001:db8:5:5:ffff::2')).status, 429);
    assert.equal((await send('секрет-админа', '192.0.2.11')).status, 200);
  });

  await test('вход забывается после долгого простоя', async () => {
    const stale = await signUp('Давно не был', { ip: '203.0.113.50' });
    const fresh = await signUp('Был вчера', { ip: '203.0.113.50' });
    const hash = (token) => createHash('sha256').update(token).digest('hex');
    const past = (days) => Math.floor(Date.now() / 1000) - days * 86400;
    await stop();
    runSql(`UPDATE sessions SET created_at = ${past(91)} WHERE hash = '${hash(stale)}'`);
    runSql(`UPDATE sessions SET created_at = ${past(30)} WHERE hash = '${hash(fresh)}'`);
    await start({ ADMIN_KEY: 'секрет-админа' });
    assert.equal((await call('/api/me', { token: stale })).data.user, null);
    assert.equal((await call('/api/me', { token: fresh })).data.user.name, 'Был вчера');
  });

  await test('регистрация только с согласием, дата и редакция сохраняются', async () => {
    const send = (consent) =>
      call('/api/auth/register', { token: key(), method: 'POST', body: { login: 'consent_one', name: 'Асель', key: key(), consent }, headers: { 'cf-connecting-ip': '203.0.113.60' } });
    for (const consent of [undefined, true, '2000-01-01']) assert.equal((await send(consent)).data.error, 'consent');
    assert.equal((await send(LEGAL_VERSION)).status, 200);
    await stop();
    const [row] = querySql("SELECT created_at, consent_at, consent_version FROM users WHERE login = 'consent_one'");
    assert.equal(row.consent_version, LEGAL_VERSION);
    assert.equal(row.consent_at, row.created_at);
    await start({ ADMIN_KEY: 'секрет-админа' });
  });

  const admin = (path, body) => call(`/api/admin/${path}`, { method: body ? 'POST' : 'GET', body, headers: adminHeaders });

  await test('удаление аккаунта стирает своё и не трогает чужое', async () => {
    const ip = '203.0.113.61';
    const secret = key();
    const leaver = await signUp('Уходящий', { ip, login: 'leaver', secret });
    const friend = await signUp('Остающийся', { ip });
    const send = (path, token, body) => call(path, { token, method: 'POST', body, headers: { 'cf-connecting-ip': ip } });
    const remove = (token, k) => send('/api/auth/delete', token, { key: k });
    const own = (await upload(leaver)).data.id;
    const mine = await create(leaver, { title: 'Самовар медный', phone: '77090000001', photos: [own] });
    const theirs = await create(friend, { title: 'Ковёр шерстяной', phone: '77090000002' });
    const toMe = (await send(`/api/listings/${mine}/chat`, friend, { text: 'Здравствуйте' })).data.chat;
    const fromMe = (await send(`/api/listings/${theirs}/chat`, leaver, { text: 'Привет' })).data.chat;
    await send(`/api/chats/${toMe}`, leaver, { text: 'Да' });
    await send(`/api/chats/${fromMe}`, friend, { text: 'Да' });
    const data = new FormData();
    data.set('full', new Blob([jpeg]), 'full');
    data.set('thumb', new Blob([jpeg]), 'thumb');
    const picture = (await send(`/api/chats/${fromMe}/photo`, friend, data)).data.message.photo;
    assert.ok((await send(`/api/listings/${theirs}/review`, leaver, { rating: 5 })).status < 300);
    assert.ok((await send(`/api/listings/${mine}/review`, friend, { rating: 4 })).status < 300);
    await call(`/api/favorites/${theirs}`, { token: leaver, method: 'PUT' });
    await call(`/api/favorites/${mine}`, { token: friend, method: 'PUT' });

    assert.equal((await remove(key(), secret)).data.error, 'login_required');
    assert.equal((await remove(leaver, key())).data.error, 'wrong_password');
    // пока жалоба не разобрана, переписка и объявление должны дождаться модератора
    await send(`/api/chats/${toMe}/complaint`, friend, { reason: 'spam' });
    const blocked = await remove(leaver, secret);
    assert.deepEqual([blocked.status, blocked.data.error], [409, 'under_review']);
    const [complaint] = (await admin('complaints')).data.items;
    await admin(`complaints/${complaint.id}`, { action: 'dismiss' });
    await admin(`${mine}`, { action: 'hide' });
    assert.equal((await remove(leaver, secret)).data.error, 'under_review');
    await admin(`${mine}`, { action: 'approve' });
    // жалоба самого уходящего удаляется вместе с ним
    await send(`/api/chats/${fromMe}/complaint`, leaver, { reason: 'spam' });
    const done = await remove(leaver, secret);
    assert.equal(done.status, 200, JSON.stringify(done.data));

    assert.equal((await call('/api/me', { token: leaver })).data.user, null);
    assert.equal((await send('/api/auth/login', key(), { login: 'leaver', key: secret })).data.error, 'bad_credentials');
    assert.equal((await call(`/api/listings/${mine}`)).status, 404);
    assert.equal((await fetch(`${BASE}/p/${own}`)).status, 404);
    assert.equal((await call('/api/chats', { token: friend })).data.items.length, 0);
    assert.equal((await call(`/api/chats/${fromMe}`, { token: friend })).status, 404);
    assert.deepEqual((await call('/api/favorites', { token: friend })).data.ids, []);
    assert.equal((await call(`/api/listings/${theirs}`)).data.seller.reviews, 0);
    assert.equal((await call('/api/mine', { token: friend })).data.items.length, 1);
    assert.equal((await admin('complaints')).data.items.length, 0);
    // логин освободился
    await signUp('Тот же логин', { ip, login: 'leaver' });

    await stop();
    const orphan = (table, column) => `(SELECT COUNT(*) FROM ${table} WHERE ${column} NOT IN (SELECT id FROM users)) AS ${table}_${column}`;
    const [left] = querySql(`SELECT
      (SELECT COUNT(*) FROM messages WHERE chat_id IN (${toMe}, ${fromMe})) AS messages,
      (SELECT COUNT(*) FROM photos WHERE id IN ('${own}', '${picture}')) AS photos,
      (SELECT COUNT(*) FROM favorites WHERE listing_id = ${mine}) AS favorites,
      ${orphan('sessions', 'user_id')}, ${orphan('favorites', 'user_id')}, ${orphan('reviews', 'author')}, ${orphan('reviews', 'seller')},
      ${orphan('chats', 'buyer')}, ${orphan('chats', 'seller')}`);
    assert.deepEqual(Object.entries(left).filter(([, n]) => n), []);
    await start({ ADMIN_KEY: 'секрет-админа' });
  });

  await test('заблокированный может удалить аккаунт, блокировка остаётся', async () => {
    const ip = '203.0.113.62';
    const secret = key();
    const cheat = await signUp('Нарушитель', { ip, secret });
    const goods = await create(cheat, { title: 'Дрель ударная', phone: '77090000003' });
    await admin(`${goods}`, { action: 'ban' });
    const done = await call('/api/auth/delete', { token: cheat, method: 'POST', body: { key: secret }, headers: { 'cf-connecting-ip': ip } });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const again = await signUp('Снова он', { ip });
    const retry = await call('/api/listings', { token: again, method: 'POST', body: listing({ phone: '77090000003' }) });
    assert.equal(retry.data.error, 'banned');
  });

  await test('изменения с чужих сайтов не принимаются', async () => {
    const send = (origin) =>
      call('/api/auth/logout', { token: key(), method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.30', ...(origin && { origin }) } });
    assert.equal((await send()).status, 200);
    assert.equal((await send(BASE)).status, 200);
    assert.equal((await send('https://evil.example')).data.error, 'foreign_origin');
    assert.equal((await send('null')).status, 403);
  });

  await test('переход на https только для настоящих адресов', async () => {
    assert.equal(insecure(new URL('http://tapty.gdev.uk/api/me')), true);
    for (const ok of ['https://tapty.gdev.uk/', 'http://127.0.0.1:8787/', 'http://localhost/', 'http://[::1]:8787/']) {
      assert.equal(insecure(new URL(ok)), false, ok);
    }
  });

  await test('общий предел запросов с одного адреса', async () => {
    const send = () => call('/api/config', { headers: { 'cf-connecting-ip': '192.0.2.40' } });
    const statuses = [];
    for (let i = 0; i < 13; i++) statuses.push(...(await Promise.all(Array.from({ length: 100 }, send))).map((r) => r.status));
    assert.equal(statuses[0], 200);
    assert.ok(statuses.includes(429), 'предел не сработал');
    assert.equal((await call('/api/config', { headers: { 'cf-connecting-ip': '192.0.2.41' } })).status, 200);
  });

  await test('коды совпадают с эталонными из RFC 6238', async () => {
    const secret = secretBytes('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
    assert.equal(new TextDecoder().decode(secret), '12345678901234567890');
    for (const [time, code] of [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037']]) {
      assert.equal(await codeAt(secret, Math.floor(time / 30)), code);
    }
    assert.equal(secretBytes('короткий'), null);
  });

  await test('вход в модерацию по коду из приложения', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    await stop();
    await start({ ADMIN_KEY: 'секрет-админа', ADMIN_TOTP: secret });
    const headers = { ...adminHeaders, 'cf-connecting-ip': '192.0.2.50' };
    const open = (code, extra = headers) => call('/api/admin/session', { method: 'POST', body: { code }, headers: extra });
    const reports = (pass) => call('/api/admin/reports', { headers: { ...headers, ...(pass && { 'x-admin-pass': pass }) } });
    assert.equal((await reports()).data.error, 'code_required');
    const code = await codeAt(secretBytes(secret), Math.floor(Date.now() / 30000));
    // без ключа код бесполезен
    assert.equal((await open(code, { 'cf-connecting-ip': '192.0.2.51' })).data.error, 'forbidden');
    const wrong = String((Number(code) + 500000) % 1000000).padStart(6, '0');
    assert.equal((await open(wrong)).data.error, 'bad_totp');
    const { pass } = (await open(code)).data;
    assert.equal((await reports(pass)).status, 200);
    // один код — один вход
    assert.equal((await open(code)).data.error, 'bad_totp');
    // поддельный и просроченный пропуск не годятся
    assert.equal((await reports(`${pass.slice(0, -1)}${pass.endsWith('0') ? '1' : '0'}`)).data.error, 'code_required');
    const old = Math.floor(Date.now() / 1000) - 5;
    const signed = createHmac('sha256', `секрет-админа\n${secret}`).update(`admin-pass:${old}`).digest('hex');
    assert.equal((await reports(`${old}.${signed}`)).data.error, 'code_required');
    // пропуск без ключа не работает
    assert.equal((await call('/api/admin/reports', { headers: { 'x-admin-pass': pass, 'cf-connecting-ip': '192.0.2.52' } })).status, 403);
    // перебор кодов закрывается общим пределом на все адреса
    const burst = [];
    for (let i = 0; i < 32; i++) burst.push((await open(wrong, { ...adminHeaders, 'cf-connecting-ip': `192.0.2.${100 + i}` })).status);
    assert.equal(burst.at(-1), 429);
  });

  console.log(`\nвсе проверки пройдены: ${passed}`);
} finally {
  await stop();
  rmSync(state, { recursive: true, force: true });
}
