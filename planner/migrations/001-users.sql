-- Users with roles + per-site access. Existing accounts become admins (the owner).
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
UPDATE users SET role = 'admin';
CREATE TABLE IF NOT EXISTS user_sites (email TEXT NOT NULL, site TEXT NOT NULL, PRIMARY KEY (email, site));
