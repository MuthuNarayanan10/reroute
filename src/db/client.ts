import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema.js';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });
  }
  return pool;
}

export const db = drizzle({ client: getPoolLazy(), schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Pool proxy so importing `db` in tests doesn't open a connection until first query. */
function getPoolLazy(): pg.Pool {
  return new Proxy({} as pg.Pool, {
    get(_t, prop) {
      const p = getPool() as unknown as Record<string | symbol, unknown>;
      const v = p[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(p) : v;
    },
  });
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
