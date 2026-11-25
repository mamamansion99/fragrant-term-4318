CREATE TABLE IF NOT EXISTS reply_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reply_tokens_ts ON reply_tokens(ts);
