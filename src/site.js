// Настройки сайта, которые модератор меняет без кода: ссылки на соцсети, текст плашки,
// режим технических работ и стоп-слова. Лежат в таблице meta.
import { fail, json, normalizeText, now, readJson } from './util.js';

const EMPTY = { telegram: '', instagram: '', promoRu: '', promoKk: '', maintenance: false, downRu: '', downKk: '' };
// чтобы не читать базу на каждый запрос; другие экземпляры воркера видят изменения не позже чем через это время
const FRESH = 10;

// Начала слов, по которым объявление подсвечивается в админке.
export const STOP_WORDS = [
  'предоплат', 'задаток', 'оружие', 'пистолет', 'патрон', 'наркот', 'закладк', 'спайс', 'табак', 'сигарет', 'вейп', 'алкогол',
  'казино', 'букмекер', 'ставки на', 'пирамид', 'интим', 'эскорт', 'диплом', 'удостоверени', 'реплика', 'без документов',
  'заработок в интернете', 'пассивный доход', 'криптовалют',
];

let cache = null;

export async function siteSettings(env) {
  if (cache && now() - cache.at < FRESH) return cache.value;
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'site'").first();
  const value = { ...EMPTY, ...(row && JSON.parse(row.value)) };
  cache = { at: now(), value };
  return value;
}

// То, что нужно самому сайту.
export async function publicConfig(env) {
  const s = await siteSettings(env);
  return json({
    ai: Boolean(env.AI),
    social: { telegram: s.telegram, instagram: s.instagram },
    promo: { ru: s.promoRu, kk: s.promoKk },
    maintenance: s.maintenance ? { ru: s.downRu, kk: s.downKk } : null,
  });
}

export async function stopWords(env) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'stopwords'").first();
  return row ? JSON.parse(row.value) : STOP_WORDS;
}

export async function getSettings(env) {
  cache = null;
  return json({ site: await siteSettings(env), stopwords: await stopWords(env) });
}

// Ссылка принимается целиком или одним именем: «@tapty», «t.me/tapty», «https://t.me/tapty».
const SOCIAL = {
  telegram: [/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(\+?[\w-]{2,64})\/?$/i, /^@?([a-z]\w{3,31})$/i, 'https://t.me/'],
  instagram: [/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([\w.]{1,30})\/?(?:\?[\w=&%.-]*)?$/i, /^@?([\w.]{1,30})$/, 'https://instagram.com/'],
};

function link(name, value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const [full, short, base] = SOCIAL[name];
  const found = full.exec(text) || short.exec(text);
  return found ? base + found[1] : fail(400, 'invalid', name);
}

const line = (name, value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? fail(400, 'invalid', name) : text;
};

// Меняются только присланные поля.
export async function saveSettings(request, env) {
  const body = await readJson(request);
  const has = (key) => Object.hasOwn(body, key);
  cache = null;
  const next = { ...(await siteSettings(env)) };
  for (const name of ['telegram', 'instagram']) if (has(name)) next[name] = link(name, body[name]);
  for (const name of ['promoRu', 'promoKk']) if (has(name)) next[name] = line(name, body[name], 140);
  for (const name of ['downRu', 'downKk']) if (has(name)) next[name] = line(name, body[name], 300);
  if (has('maintenance')) next.maintenance = body.maintenance === true;
  const save = env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2');
  const statements = [save.bind('site', JSON.stringify(next))];
  if (has('stopwords')) {
    const words = [...new Set(String(body.stopwords).split(/[\n,;]+/).map(normalizeText).filter(Boolean))];
    if (words.length > 80 || words.some((w) => w.length < 3 || w.length > 40)) fail(400, 'invalid', 'stopwords');
    statements.push(save.bind('stopwords', JSON.stringify(words)));
  }
  await env.DB.batch(statements);
  cache = null;
  return getSettings(env);
}
