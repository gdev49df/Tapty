-- Таблицы, как их создавала версия сайта до аккаунтов: без районов, прежней цены и паролей.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  search TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, price_type TEXT NOT NULL, condition TEXT, category TEXT NOT NULL,
  city TEXT NOT NULL, district TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, phone TEXT NOT NULL,
  whatsapp INTEGER NOT NULL DEFAULT 1, telegram TEXT NOT NULL DEFAULT '', photos TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active', approved INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, bumped_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
INSERT INTO listings (owner, title, search, price, price_type, condition, category, city, name, phone, created_at, bumped_at, expires_at)
VALUES ('-', 'Старое кресло', 'старое кресло', 10000, 'fixed', 'used', 'home_garden', 'astana', 'Ерлан', '77010000000', 1700000000, 1700000000, 4000000000);
-- Фото и сообщения без столбцов, добавленных позже.
CREATE TABLE photos (id TEXT PRIMARY KEY, owner TEXT NOT NULL, listing_id INTEGER, mime TEXT NOT NULL, full BLOB, thumb BLOB, created_at INTEGER NOT NULL);
CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
