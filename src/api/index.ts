import { env } from '../config/env.js';
import { closeDb } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { closeQueues } from '../lib/queues.js';
import { closeRedis } from '../lib/redis.js';
import { buildServer } from './server.js';

const e = env();
const app = await buildServer();
await app.listen({ port: e.PORT, host: '0.0.0.0' });

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down api');
  await app.close();
  await closeQueues();
  await closeRedis();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
