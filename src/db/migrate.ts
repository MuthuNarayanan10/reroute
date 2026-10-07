import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, closeDb } from './client.js';
import { logger } from '../lib/logger.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

await migrate(db, { migrationsFolder: path.join(dir, 'migrations') });
logger.info('migrations applied');
await closeDb();
