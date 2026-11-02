-- Offpage Planner (D1). Apply: npx wrangler d1 execute offpage-planner --remote --file schema.sql
CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'member');
-- which sites a member can open (admins see every site)
CREATE TABLE IF NOT EXISTS user_sites (email TEXT NOT NULL, site TEXT NOT NULL, PRIMARY KEY (email, site));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sites (domain TEXT PRIMARY KEY, created INTEGER NOT NULL);
-- one row of one tab of one site; cells = JSON array in the tab's column order
CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, tab TEXT NOT NULL,
  pos REAL NOT NULL, cells TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rows_site_tab ON rows (site, tab, pos);
