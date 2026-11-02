-- LINE "reply" (quote) support. quoted_id is the LINE message id a customer
-- replied to; quote_token lets staff quote this message back; sent_ids holds
-- the LINE ids of what the bot/staff sent (",id1,id2,") so a customer's quote
-- of one of them can be found.
ALTER TABLE messages ADD COLUMN quoted_id TEXT;
ALTER TABLE messages ADD COLUMN quote_token TEXT;
ALTER TABLE messages ADD COLUMN sent_ids TEXT;
CREATE INDEX IF NOT EXISTS messages_line_id ON messages (line_message_id);
