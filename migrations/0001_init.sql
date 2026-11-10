-- Initial schema. Apply with: npm run db:migrate:local  (remote: npm run db:migrate:remote)

CREATE TABLE users (
  username   TEXT PRIMARY KEY NOT NULL CHECK (length(username) BETWEEN 1 AND 64 AND instr(username, ':') = 0),
  key_hash   TEXT NOT NULL CHECK (length(key_hash) = 64),          -- hex HMAC-SHA256(AUTH_PEPPER, md5(password))
  disabled   INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at INTEGER NOT NULL                                      -- unix seconds
) WITHOUT ROWID;

CREATE TABLE progress (
  username   TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
  document   TEXT NOT NULL,
  progress   TEXT NOT NULL,
  percentage REAL NOT NULL,
  device     TEXT NOT NULL,
  device_id  TEXT,
  timestamp  INTEGER NOT NULL,                                     -- unix seconds, server-set
  PRIMARY KEY (username, document)
) WITHOUT ROWID;
