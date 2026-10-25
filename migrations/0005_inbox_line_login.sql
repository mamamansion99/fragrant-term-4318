-- One row per "เข้าสู่ระบบด้วย LINE" attempt. The app makes the state, LINE
-- sends it back to the callback, and the app polls for the token, so login
-- works even when iOS finishes it in Safari or LINE instead of the home-screen app.
CREATE TABLE auth_states (
  state TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  token TEXT,
  staff TEXT,
  used INTEGER DEFAULT 0
);
