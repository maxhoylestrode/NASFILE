import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { authRouter } from './routes/auth';
import { invitesRouter } from './routes/invites';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      // Never log request/response bodies by default — the redaction
      // list in logger.ts covers the common cases if someone does
      // opt into body logging locally, but the safest default is to
      // just not attach it.
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/invites', invitesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
