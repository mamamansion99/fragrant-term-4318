-- 0 for customer messages that need no reply (stickers, thanks/ok, follow,
-- button taps, or what the AI judged NO_REPLY). Only the rest make a chat
-- wait for a reply.
ALTER TABLE messages ADD COLUMN actionable INTEGER DEFAULT 1;
ALTER TABLE contacts ADD COLUMN last_ask_at INTEGER DEFAULT 0;
