/**
 * Apply SQL files from supabase/migrations in timestamp order.
 *
 * Setup:
 *   1. In Supabase Dashboard → Project Settings → Database, copy the
 *      "URI" connection string (Direct connection or Session pooler).
 *   2. Add to backend/.env:
 *        DATABASE_URL=postgresql://postgres.[ref]:YOUR_PASSWORD@...
 *
 * Usage:
 *   node scripts/migr.mjs
 *   node scripts/migr.mjs --from 20250404000000
 *
 * --from <14-digit timestamp>  Skip migrations whose filename timestamp is
 *   strictly before this value (useful if the DB already has earlier migrations).
 */

import pg from 'pg';
import { config } from 'dotenv';
import { readFile, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');

function parseArgs() {
  const argv = process.argv.slice(2);
  let fromTs = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from' && argv[i + 1]) {
      fromTs = argv[i + 1].replace(/\D/g, '').slice(0, 14);
      if (fromTs.length !== 14) {
        console.error('--from expects a 14-digit migration timestamp, e.g. 20250404000000');
        process.exit(1);
      }
      break;
    }
    if (argv[i].startsWith('--from=')) {
      fromTs = argv[i].split('=')[1].replace(/\D/g, '').slice(0, 14);
      if (fromTs.length !== 14) {
        console.error('--from expects a 14-digit migration timestamp');
        process.exit(1);
      }
      break;
    }
  }
  return { fromTs };
}

function fileTimestamp(filename) {
  const m = filename.match(/^(\d{14})/);
  return m ? m[1] : '00000000000000';
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function main() {
  const { fromTs } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Missing DATABASE_URL in backend/.env — copy the Postgres URI from Supabase → Settings → Database.'
    );
    process.exit(1);
  }

  let files;
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (e) {
    console.error('Cannot read migrations folder:', MIGRATIONS_DIR, e.message);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('No .sql files in', MIGRATIONS_DIR);
    return;
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await ensureMigrationsTable(client);

    for (const name of files) {
      if (fromTs && fileTimestamp(name) < fromTs) {
        console.log('[skip --from]', name);
        continue;
      }

      const { rows } = await client.query(
        'select 1 from public.schema_migrations where filename = $1',
        [name]
      );
      if (rows.length > 0) {
        console.log('[already applied]', name);
        continue;
      }

      const path = join(MIGRATIONS_DIR, name);
      const sql = await readFile(path, 'utf8');
      console.log('[running]', name);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into public.schema_migrations (filename) values ($1)', [
          name,
        ]);
        await client.query('COMMIT');
        console.log('[ok]', name);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('[failed]', name, e.message);
        process.exit(1);
      }
    }
    console.log('Done.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
