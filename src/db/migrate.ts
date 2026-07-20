/**
 * Migration runner: applies src/db/migrations/*.sql in filename order,
 * recording each in schema_migrations so re-runs are safe.
 *
 * Usage: npm run migrate
 * Requires DATABASE_URL in .env (Supabase Dashboard -> Connect -> Session pooler URI).
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { env } from '../config/env';

async function main() {
  if (!env.databaseUrl) {
    console.error(
      'DATABASE_URL is not set in .env.\n' +
        'Get it from Supabase Dashboard -> Connect -> Session pooler URI ' +
        '(it includes your database password).'
    );
    process.exit(1);
  }

  // Echo the target before touching anything — the username carries the
  // project ref, so this is how you confirm "am I about to migrate test or
  // prod?" before it runs. Password is never printed.
  const target = (() => {
    try {
      const u = new URL(env.databaseUrl);
      return `${u.username}@${u.host}`;
    } catch {
      return '(could not parse DATABASE_URL)';
    }
  })();
  console.log(`Target database: ${target}`);

  const client = new Client({
    connectionString: env.databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = join(__dirname, 'migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(dir, file), 'utf8');
      console.log(`apply ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    console.log(ran > 0 ? `Done — ${ran} migration(s) applied.` : 'Done — nothing to apply.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
