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
    expires_at INTEGER NOT NULL
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
    created_at INTEGER NOT NULL
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
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS logins (
    nonce TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    code TEXT NOT NULL,
    guest TEXT,
    user_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

let ready = null;
export function ensureSchema(env) {
  ready ??= env.DB.batch(STATEMENTS.map((s) => env.DB.prepare(s))).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
