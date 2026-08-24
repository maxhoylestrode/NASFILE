import { config } from './config';
import { logger } from './logger';
import { createApp } from './app';
import { assertDbConnection } from './db';
import { bootstrapBucket } from './storage';

async function main() {
  await assertDbConnection();
  logger.info('Postgres connection verified');

  await bootstrapBucket();

  const app = createApp();
  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'drive-clone server listening');
  });
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'Fatal startup error');
  process.exit(1);
});
