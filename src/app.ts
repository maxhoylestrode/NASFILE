import express from 'express';
import path from 'path';
import fs from 'fs';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { authRouter } from './routes/auth';
import { invitesRouter } from './routes/invites';
import { foldersRouter } from './routes/folders';
import { filesRouter } from './routes/files';
import { sharesRouter } from './routes/shares';
import { publicRouter } from './routes/public';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

// Built frontend (npm run build inside frontend/) lands here. Serving it
// from the same Express process means the UI and API share one origin —
// no CORS to configure for auth/folders/files calls, one process to
// deploy, one Nginx Proxy Manager host. Only MinIO (presigned upload/
// download URLs) is genuinely cross-origin, handled separately per the
// README's "Exposing MinIO" section.
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');

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

  // Let's Encrypt HTTP-01 validation hits this path directly. It must
  // never fall through to the SPA catch-all below (which would hand back
  // index.html instead of a 404/challenge token and break cert issuance).
  // Nginx Proxy Manager is expected to intercept this path itself before
  // it ever reaches the app — this route exists as a hard guarantee and a
  // diagnostic: if cert requests still fail with this in place, the
  // problem is confirmed to be on the NPM/certbot side, not here.
  app.get('/.well-known/acme-challenge/*', (_req, res) => {
    res.status(404).send('Not found');
  });

  app.use('/auth', authRouter);
  app.use('/invites', invitesRouter);
  app.use('/folders', foldersRouter);
  app.use('/files', filesRouter);
  app.use('/shares', sharesRouter);
  // Deliberately unauthenticated — see routes/public.ts.
  app.use('/public', publicRouter);

  // Static frontend, if it's been built. In dev, the frontend runs on
  // its own Vite dev server (`npm run dev` in frontend/) with a proxy
  // back to this API instead — see frontend/vite.config.ts.
  if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
    app.use(express.static(FRONTEND_DIST));
    // SPA fallback: any GET that didn't match an API route or a real
    // static file is a client-side route (e.g. /login, /accept-invite) —
    // hand it index.html and let React Router take over.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  } else {
    logger.warn(
      { expected: FRONTEND_DIST },
      'No built frontend found — API-only mode. Run `npm install && npm run build` in frontend/ to serve the UI.',
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
