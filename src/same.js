// «Такие же товары по другой цене»: объявления с тем же названием модели от других продавцов.
import { normalizeText } from './util.js';

// Слова, которые описывают состояние и продажу, а не сам товар.
const NOISE = new Set(
  ('продам продаю продается продаются новый новая новое новые бу состояние состоянии идеальное идеальном идеальный ' +
    'отличное отличном отличный хорошее хорошем хороший срочно торг цвет цвета оригинал комплект комплекте полный полном ' +
    'гб gb тб tb память на в с и для от по не за или к у из без ' +
    'черный белый серый синий голубой красный зеленый желтый розовый золотой серебристый фиолетовый black white').split(' ')
);
// Версия модели: «13» и «13 pro» — разные товары.
const VERSIONS = { pro: 'pro', про: 'pro', max: 'max', макс: 'max', mini: 'mini', мини: 'mini', plus: 'plus', плюс: 'plus', ultra: 'ultra', ультра: 'ultra', lite: 'lite', лайт: 'lite', se: 'se' };
const ALIASES = {
  айфон: 'iphone', айпад: 'ipad', макбук: 'macbook', эпл: 'apple', самсунг: 'samsung', галакси: 'galaxy',
  сяоми: 'xiaomi', ксиаоми: 'xiaomi', редми: 'redmi', поко: 'poco', хонор: 'honor', хуавей: 'huawei',
  плейстейшн: 'playstation', ps: 'playstation',
};
// Чехол к телефону и сам телефон называются почти одинаково, но это разные товары.
const PARTS = new Set(
  ('чехол кейс стекло пленка зарядка зарядное зарядник кабель шнур ремешок коробка дисплей экран аккумулятор ' +
    'батарея крышка корпус бампер держатель адаптер переходник запчасти разбор плата шлейф сумка').split(' ')
);
const MEMORY = new Set(['32', '64', '128', '256', '512', '1024']);

export function signature(title) {
  const text = normalizeText(title)
    // объём памяти не делает товар другим
    .replace(/\d+\s*\/\s*\d+/g, ' ')
    .replace(/\d+\s*(гб|gb|тб|tb)(?![a-zа-я])/g, ' ')
    // «iphone13pro» читаем как «iphone 13 pro», а «s23» остаётся одним словом
    .replace(/([a-zа-я]{2,})(?=\d)/g, '$1 ')
    .replace(/(\d)(?=[a-zа-я]{2,})/g, '$1 ')
    .replace(/(pro|про)\s*(max|макс)/g, ' pro max ');
  const words = new Set();
  const parts = new Set();
  const models = [];
  const versions = new Set();
  for (const raw of text.match(/[a-zа-я0-9]+/g) || []) {
    if (/\d/.test(raw)) models.push(raw);
    else if (VERSIONS[raw]) versions.add(VERSIONS[raw]);
    else if (raw.length > 1 && !NOISE.has(raw)) {
      words.add(ALIASES[raw] || raw);
      if (PARTS.has(raw)) parts.add(raw);
    }
  }
  // Память могли написать и без «ГБ»: «iPhone 13 128».
  const numbers = models.length > 1 && models.some((n) => !MEMORY.has(n)) ? models.filter((n) => !MEMORY.has(n)) : models;
  return {
    words,
    numbers: numbers.sort(),
    exact: [...numbers, ...[...versions].sort()].join(' '),
    parts: [...parts].sort().join(' '),
  };
}

export function sameProduct(a, b) {
  if (a.exact !== b.exact || a.parts !== b.parts) return false;
  const common = [...a.words].filter((w) => b.words.has(w)).length;
  const share = common / Math.max(1, Math.min(a.words.size, b.words.size));
  // Без номера модели одного общего слова мало: «диван» ещё не тот же самый диван.
  return a.numbers.length ? share > 0.5 : common >= 2 && share >= 0.6;
}

// Что искать в базе, чтобы не перебирать всю категорию.
export function needles(sig) {
  if (sig.numbers.length) return [sig.numbers[0].match(/\d+/)[0]];
  const words = [...sig.words].slice(0, 6);
  return words.flatMap((w) => [w, ...Object.keys(ALIASES).filter((k) => k.length > 2 && ALIASES[k] === w)]);
}
