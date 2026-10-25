-- Screening facts the AI pulled from the chat, shown above the conversation.
ALTER TABLE contacts ADD COLUMN facts TEXT;
-- 1 when the live AI already sent this draft itself, so the inbox does not offer it again.
ALTER TABLE drafts ADD COLUMN ai_sent INTEGER DEFAULT 0;
