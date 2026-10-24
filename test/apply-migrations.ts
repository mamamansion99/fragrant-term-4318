import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations((env as any).INBOX_DB, (env as any).TEST_MIGRATIONS);
