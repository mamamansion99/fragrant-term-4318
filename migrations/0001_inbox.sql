-- Inbox: every 1:1 LINE conversation, whoever wrote each message.
CREATE TABLE contacts (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  picture_url TEXT,
  room_id TEXT,
  tenant_name TEXT,
  contact_type TEXT,               -- TENANT | NON_TENANT | STAFF
  human_until INTEGER DEFAULT 0,   -- ms epoch; AI stays quiet until then
  human_by TEXT,
  last_message_at INTEGER DEFAULT 0,
  last_text TEXT,
  last_author TEXT,
  last_customer_at INTEGER DEFAULT 0,
  last_reply_at INTEGER DEFAULT 0,
  profile_checked_at INTEGER DEFAULT 0
);
CREATE INDEX contacts_last ON contacts(last_message_at DESC);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  direction TEXT NOT NULL,         -- IN | OUT
  author TEXT NOT NULL,            -- customer | bot | ai | staff:<name> | system
  kind TEXT,                       -- text | image | sticker | postback | flex | ...
  text TEXT,
  line_message_id TEXT,
  log_id TEXT UNIQUE,
  handler TEXT,
  in_reply_to TEXT
);
CREATE INDEX messages_user_ts ON messages(user_id, ts);

-- What the AI suggested next to what a person actually sent: the learning set.
CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  in_log_id TEXT,
  created_at INTEGER NOT NULL,
  draft TEXT,
  verdict TEXT,
  meta TEXT,
  final_text TEXT,
  final_author TEXT,
  sent_at INTEGER,
  edited INTEGER
);
CREATE INDEX drafts_user ON drafts(user_id, created_at);

CREATE TABLE access_log (
  ts INTEGER NOT NULL,
  staff TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT
);
