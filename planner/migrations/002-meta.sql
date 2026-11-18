-- key/value facts about the app itself (e.g. when Claude last used the MCP endpoint)
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
