// Таблицы создаются сами при первом запросе — вручную мигрировать базу не нужно.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    search TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    price_type TEXT NOT NULL,
    condition TEXT,
    category TEXT NOT NULL,
    city TEXT NOT NULL,
    district TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    whatsapp INTEGER NOT NULL DEFAULT 1,
    telegram TEXT NOT NULL DEFAULT '',
    photos TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    approved INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    bumped_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    old_price INTEGER NOT NULL DEFAULT 0,
    area TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS listings_feed ON listings (status, bumped_at DESC)`,
  `CREATE INDEX IF NOT EXISTS listings_city ON listings (status, city, bumped_at DESC)`,
  `CREATE INDEX IF NOT EXISTS listings_cat ON listings (status, category, bumped_at DESC)`,
  `CREATE INDEX IF NOT EXISTS listings_owner ON listings (owner)`,
  `CREATE INDEX IF NOT EXISTS listings_phone ON listings (phone)`,
  `CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    listing_id INTEGER,
    mime TEXT NOT NULL,
    full BLOB,
    thumb BLOB,
    created_at INTEGER NOT NULL,
    chat_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS photos_listing ON photos (listing_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS reports (
    listing_id INTEGER NOT NULL,
    reporter TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (listing_id, reporter)
  )`,
  `CREATE TABLE IF NOT EXISTS bans (value TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, login TEXT, pass_hash TEXT, pass_salt TEXT, rec_hash TEXT, rec_salt TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // Переписка: один диалог на пару «объявление + покупатель».
  `CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    buyer TEXT NOT NULL,
    seller TEXT NOT NULL,
    buyer_read INTEGER NOT NULL DEFAULT 0,
    seller_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (listing_id, buyer)
  )`,
  `CREATE INDEX IF NOT EXISTS chats_buyer ON chats (buyer, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS chats_seller ON chats (seller, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    photo TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, id)`,
  `CREATE TABLE IF NOT EXISTS reviews (
    seller TEXT NOT NULL,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (seller, author)
  )`,
  `CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL, listing_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, listing_id))`,
  `CREATE TABLE IF NOT EXISTS blocks (blocker TEXT NOT NULL, blocked TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (blocker, blocked))`,
  // Жалоба на собеседника: модератор видит переписку, пока жалоба не разобрана.
  `CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    reporter TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (chat_id, reporter)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

// Столбцы, которых нет в базах, созданных прежними версиями сайта.
const COLUMNS = {
  listings: { old_price: 'INTEGER NOT NULL DEFAULT 0', area: "TEXT NOT NULL DEFAULT ''" },
  users: { login: 'TEXT', pass_hash: 'TEXT', pass_salt: 'TEXT', rec_hash: 'TEXT', rec_salt: 'TEXT' },
  photos: { chat_id: 'INTEGER' },
  // у каждого участника свои «закрепить» и «удалить»: *_cleared — номер последнего удалённого у него сообщения
  chats: {
    buyer_pinned: 'INTEGER NOT NULL DEFAULT 0',
    seller_pinned: 'INTEGER NOT NULL DEFAULT 0',
    buyer_cleared: 'INTEGER NOT NULL DEFAULT 0',
    seller_cleared: 'INTEGER NOT NULL DEFAULT 0',
  },
  messages: { photo: "TEXT NOT NULL DEFAULT ''" },
};

async function migrate(env) {
  await env.DB.batch(STATEMENTS.map((s) => env.DB.prepare(s)));
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const have = new Set(results.map((c) => c.name));
    for (const [name, type] of Object.entries(columns)) {
      if (have.has(name)) continue;
      try {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
      } catch (e) {
        // другой экземпляр воркера мог добавить столбец одновременно
        if (!/duplicate column/i.test(e.message)) throw e;
      }
    }
  }
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS users_login ON users (login)').run();
  // «Телефоны» влились в «Телефоны и электроника»; перебор статусов даёт запросу пройти по индексу
  await env.DB.prepare(
    "UPDATE listings SET category = 'electronics' WHERE status IN ('active', 'sold', 'hidden') AND category = 'phones'"
  ).run();
}

let ready = null;
export function ensureSchema(env) {
  ready ??= migrate(env).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
