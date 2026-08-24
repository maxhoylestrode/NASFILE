import { Pool } from 'pg';
import { config } from './config';
import { logger } from './logger';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
});

pool.on('error', (err) => {
  // Errors on idle clients (e.g. connection dropped) — log and keep running,
  // the pool will create a new connection on next use.
  logger.error({ err: err.message }, 'Unexpected Postgres pool error');
});

export async function assertDbConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
