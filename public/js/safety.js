// Признаки обмана в переписке. Проверяется в браузере: сообщения никуда дополнительно не уходят.
// Это подсказка, а не приговор: она может сработать зря и может пропустить хитрую просьбу.

// Слово с начала: \b в JavaScript не понимает кириллицу.
const at = (pattern) => new RegExp(`(?<![\\p{L}])(?:${pattern})`, 'iu');

const OWN_HOSTS = /^(?:[a-z0-9-]+\.)*(?:tapty\.gdev\.uk|2gis\.kz|2gis\.com|maps\.google\.com|maps\.app\.goo\.gl|yandex\.(?:kz|ru))$/i;
const LINK = /(?:https?:\/\/|www\.)[^\s]+|(?<![\p{L}\p{N}@.-])(?:[a-z0-9-]+\.)+(?:kz|ru|com|net|org|info|site|online|shop|store|xyz|top|click|link|icu|cc|me|pro|io)(?![\p{L}\p{N}-])(?:\/[^\s]*)?/giu;

function badLink(text) {
  return (text.match(LINK) || []).some((link) => {
    const host = link.replace(/^https?:\/\//i, '').split(/[/?#:]/)[0].replace(/\.+$/, '');
    return !OWN_HOSTS.test(host);
  });
}

// Номер карты: 15–19 цифр с верной контрольной суммой. Телефон и ИИН короче.
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) d = d > 4 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}
const CARD = /(?<!\d)\d(?:[ -]?\d){14,18}(?!\d)/g;
const IBAN = /(?<![A-Za-z0-9])KZ\d{2}(?:[ ]?[A-Za-z0-9]){16}(?![A-Za-z0-9])/i;
const hasCard = (text) => IBAN.test(text) || (text.match(CARD) || []).some((n) => luhn(n.replace(/\D/g, '')));

// Код из СМС или банка. Штрих-код, QR-код и промокод не в счёт.
const CODE = [
  at('(?:смс|sms)[- ]?код|код\\p{L}{0,3}\\s+(?:из\\s+)?(?:смс|sms|банка|kaspi|каспи)'),
  at('(?:назови|скажи|скинь|пришли|отправь|продиктуй|напиши|сообщи)(?:те)?\\s+(?:мне\\s+)?(?:этот\\s+|свой\\s+)?(?<!штрих[- ])(?<!qr[- ])код(?!\\p{L}{3})'),
  at('код\\p{L}{0,3}\\s*,?\\s*(?:который\\s+)?(?:вам\\s+|тебе\\s+)?(?:пришел|пришёл|придет|придёт)'),
  at('(?:прид[её]т|пришел|пришёл)\\s+(?:вам\\s+|тебе\\s+)?код(?!\\p{L}{3})'),
  at('код(?:ты|ыңызды)?\\s+(?:жібер|айт)'),
];

// «Без предоплаты» и «предоплата не нужна» — не просьба о деньгах.
const DENIED = new RegExp(
  '(?<![\\p{L}])(?:без|не\\s+(?:беру|берем|берём|прошу|просим|требую|требуется|нужн\\p{L}*|надо))\\s+(?:предоплат|задат|аванс)\\p{L}*' +
    '|(?:предоплат|задаток|задатк|аванс)\\p{L}*\\s+(?:не\\s+(?:нуж|надо|треб|бер|прос)\\p{L}*)',
  'giu'
);
const MONEY = [
  at('предоплат|задаток|задатк[ауеио]|аванс(?!\\p{L}{3})'),
  at('(?:переведи|переведите|скинь|скиньте|отправь|отправьте|закинь|закиньте|кинь|киньте)\\s+(?:мне\\s+|пока\\s+|сначала\\s+|сразу\\s+)?(?:деньги|денег|оплату|сумму|\\d[\\d ]*\\s*(?:тг|тенге|₸)|на\\s+(?:карту|каспи|kaspi))'),
  at('(?:оплати|оплатите|переведите|переведи)\\s+(?:сначала|заранее|вперед|вперёд)|сначала\\s+(?:оплата|деньги|переведите|переведи)'),
  at('алдын\\s+ала\\s+(?:төле|ақы|ақша|аудар)|ақша(?:ны)?\\s+(?:жібер|аудар)|картаға\\s+(?:аудар|сал|жібер)'),
];

export function risks(text) {
  const value = String(text || '');
  const asked = value.replace(DENIED, ' ');
  return [
    CODE.some((re) => re.test(value)) && 'code',
    hasCard(value) && 'card',
    MONEY.some((re) => re.test(asked)) && 'money',
    badLink(value) && 'link',
  ].filter(Boolean);
}

// Каждое предупреждение показывается один раз — под последним сообщением с таким признаком.
export function warnings(messages) {
  const last = new Map();
  for (const m of messages) {
    if (m.mine || m.kind || m.photo) continue;
    for (const kind of risks(m.text)) last.set(kind, m.id);
  }
  const byMessage = new Map();
  for (const kind of ['code', 'card', 'money', 'link']) {
    if (!last.has(kind)) continue;
    const id = last.get(kind);
    byMessage.set(id, [...(byMessage.get(id) || []), kind]);
  }
  return byMessage;
}
