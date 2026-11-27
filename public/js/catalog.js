// Общий справочник: используется и сайтом, и воркером.
export const CATEGORIES = [
  { id: 'clothes', ru: 'Одежда и обувь', kk: 'Киім мен аяқ киім', goods: true },
  { id: 'phones', ru: 'Телефоны', kk: 'Телефондар', goods: true },
  { id: 'electronics', ru: 'Электроника', kk: 'Электроника', goods: true },
  { id: 'transport', ru: 'Транспорт и запчасти', kk: 'Көлік және бөлшектер', goods: true },
  { id: 'realty', ru: 'Недвижимость', kk: 'Жылжымайтын мүлік', goods: false },
  { id: 'kids', ru: 'Детский мир', kk: 'Балалар әлемі', goods: true },
  { id: 'home_garden', ru: 'Дом и сад', kk: 'Үй және бақша', goods: true },
  { id: 'beauty', ru: 'Красота и парфюмерия', kk: 'Сұлулық және парфюмерия', goods: true },
  { id: 'hobby', ru: 'Хобби, отдых и спорт', kk: 'Хобби, демалыс, спорт', goods: true },
  { id: 'repair', ru: 'Строительство и ремонт', kk: 'Құрылыс және жөндеу', goods: true },
  { id: 'animals', ru: 'Животные', kk: 'Жануарлар', goods: false },
  { id: 'services', ru: 'Услуги', kk: 'Қызметтер', goods: false },
  { id: 'jobs', ru: 'Работа', kk: 'Жұмыс', goods: false },
  { id: 'other', ru: 'Другое', kk: 'Басқа', goods: true },
];

export const CITIES = [
  { id: 'astana', ru: 'Астана', kk: 'Астана' },
  { id: 'almaty', ru: 'Алматы', kk: 'Алматы' },
  { id: 'shymkent', ru: 'Шымкент', kk: 'Шымкент' },
  { id: 'karaganda', ru: 'Караганда', kk: 'Қарағанды' },
  { id: 'aktobe', ru: 'Актобе', kk: 'Ақтөбе' },
  { id: 'taraz', ru: 'Тараз', kk: 'Тараз' },
  { id: 'pavlodar', ru: 'Павлодар', kk: 'Павлодар' },
  { id: 'oskemen', ru: 'Усть-Каменогорск', kk: 'Өскемен' },
  { id: 'semey', ru: 'Семей', kk: 'Семей' },
  { id: 'atyrau', ru: 'Атырау', kk: 'Атырау' },
  { id: 'kostanay', ru: 'Костанай', kk: 'Қостанай' },
  { id: 'kyzylorda', ru: 'Кызылорда', kk: 'Қызылорда' },
  { id: 'oral', ru: 'Уральск', kk: 'Орал' },
  { id: 'petropavl', ru: 'Петропавловск', kk: 'Петропавл' },
  { id: 'aktau', ru: 'Актау', kk: 'Ақтау' },
  { id: 'temirtau', ru: 'Темиртау', kk: 'Теміртау' },
  { id: 'turkistan', ru: 'Туркестан', kk: 'Түркістан' },
  { id: 'kokshetau', ru: 'Кокшетау', kk: 'Көкшетау' },
  { id: 'taldykorgan', ru: 'Талдыкорган', kk: 'Талдықорған' },
  { id: 'ekibastuz', ru: 'Экибастуз', kk: 'Екібастұз' },
  { id: 'rudny', ru: 'Рудный', kk: 'Рудный' },
  { id: 'zhezkazgan', ru: 'Жезказган', kk: 'Жезқазған' },
  { id: 'konaev', ru: 'Конаев', kk: 'Қонаев' },
  { id: 'zhanaozen', ru: 'Жанаозен', kk: 'Жаңаөзен' },
];

export const PRICE_TYPES = ['fixed', 'bargain', 'exchange', 'free'];
export const CONDITIONS = ['new', 'used'];
export const REPORT_REASONS = ['fraud', 'banned', 'sold', 'wrong', 'other'];

export const LIMITS = {
  photos: 6,
  titleMin: 3,
  titleMax: 80,
  descMax: 3000,
  nameMax: 40,
  districtMax: 60,
  priceMax: 100_000_000_000,
  fullBytes: 900_000,
  thumbBytes: 150_000,
  days: 30,
};

// «+7 (701) 123-45-67», «8701…», «701…» → «77011234567»; иначе null.
export function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10 && d[0] === '7') d = '7' + d;
  return /^7[67]\d{9}$/.test(d) ? d : null;
}
