-- The LINE messages themselves (flex, template, image) for what the bot and
-- staff sent, so the inbox can draw the card the customer saw instead of its
-- alt text. Older rows stay NULL and show the text summary.
ALTER TABLE messages ADD COLUMN payload TEXT;
