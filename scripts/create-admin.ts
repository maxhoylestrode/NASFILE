/**
 * Bootstraps the very first admin account. There's no other way to get
 * a user into the system: invites can only be created by an existing
 * admin, and account creation only happens via invite acceptance. This
 * script bypasses both, directly, and should only ever be run once
 * against a fresh database (or again later for disaster recovery).
 *
 * Usage:
 *   npm run create-admin -- --email you@example.com --password 'a-strong-password'
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } from '../src/lib/password';

function parseArgs(): { email: string; password: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const email = get('--email');
  const password = get('--password');
  if (!email || !password) {
    console.error('Usage: npm run create-admin -- --email you@example.com --password "a-strong-password"');
    process.exit(1);
  }
  return { email: email.toLowerCase().trim(), password };
}

async function main() {
  const { email, password } = parseArgs();

  if (!isPasswordStrongEnough(password)) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if ((existing.rowCount ?? 0) > 0) {
      console.error(`A user with email ${email} already exists.`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);

    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, is_admin) VALUES ($1, $2, true) RETURNING id`,
      [email, passwordHash],
    );
    const userId = inserted.rows[0]!.id;
    await client.query(
      `INSERT INTO folders (owner_id, parent_id, name, is_root) VALUES ($1, NULL, 'My Drive', true)`,
      [userId],
    );
    await client.query('COMMIT');

    console.log(`Admin user created: ${email} (${userId})`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
