/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import pool from '../config/database';
import { getMigrationFiles, resolveMigrationsDir } from './migrationFiles';

/**
 * The comments service shares the Supabase project with Quickbuild and the apps. Quickbuild records its migrations in
 * public.migrations, so this service keeps its own record inside the comments schema.
 */
const MIGRATIONS_TABLE = 'comments.schema_migrations';

const ensureMigrationsTable = async (): Promise<void> => {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS comments;
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE ${MIGRATIONS_TABLE} ENABLE ROW LEVEL SECURITY;
  `);
};

const executedMigrations = async (): Promise<string[]> => {
  const result = await pool.query<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`);
  return result.rows.map(row => row.name);
};

const runMigration = async (filename: string): Promise<void> => {
  const sql = fs.readFileSync(path.join(resolveMigrationsDir(), filename), 'utf-8');
  console.log(`Running migration: ${filename}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [filename]);
    await client.query('COMMIT');
    console.log(`Migration completed: ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Migration failed: ${filename}`);
    throw error;
  } finally {
    client.release();
  }
};

/** Arbitrary key for the advisory lock that stops two starting instances migrating at once. */
const MIGRATION_LOCK = 4_512_291;

export const migrate = async (): Promise<void> => {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await ensureMigrationsTable();
    const done = new Set(await executedMigrations());
    const pending = getMigrationFiles().filter(file => !done.has(file));
    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }
    for (const file of pending) {
      await runMigration(file);
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    lock.release();
  }
};

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
