import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { isPterodactylConfigured, loadConfig } from './config/config';
import { explainDatabaseError, runMigrations } from './db/database.service';
import { ConsoleRelay } from './servers/console.relay';
import { RESTART_FOR_UPDATE_EXIT_CODE, UpdateService } from './updates/update.service';

const WEB_DIST = path.resolve(__dirname, '../../web/dist');

async function bootstrap(): Promise<void> {
  const logger = new Logger('ICE18');
  const config = loadConfig();

  if (!config.database) {
    // Stay up instead of exiting, so Pterodactyl doesn't keep restarting the server.
    const help = [
      'ICE18 needs a database before it can start. To set one up:',
      "  1. Open this server's Databases tab and create a database (Connections from: %).",
      '  2. Admin -> Servers -> this server -> Startup: fill in Database host, Database name,',
      '     Database username and Database password from that tab.',
      '     Use 172.18.0.1 as the host if the tab shows 127.0.0.1 or localhost.',
      '  3. Restart this server.',
    ].join('\n');
    logger.error(help);
    setInterval(() => logger.warn('Still waiting for database settings. See the steps above.'), 5 * 60_000);
    return;
  }

  // Keep retrying instead of exiting: a database that's still starting or a typo shouldn't crash-loop.
  for (let attempt = 1; ; attempt++) {
    try {
      logger.log('Applying database migrations…');
      await runMigrations(config.database);
      break;
    } catch (error) {
      logger.error(explainDatabaseError(error, config.database));
      logger.warn(`Retrying in 15 seconds (attempt ${attempt}). Fix the settings and restart the server if this keeps failing.`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { bufferLogs: false });
  app.enableShutdownHooks();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(cookieParser());
  app.setGlobalPrefix('api');

  // Serve the built web app from the same port (one port is all a Pterodactyl server gets).
  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.method !== 'GET' || request.path.startsWith('/api')) return next();
      response.setHeader('Cache-Control', 'no-cache');
      response.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  } else {
    logger.warn(`Web app not built (${WEB_DIST} missing). Only the API is served.`);
  }

  app.get(ConsoleRelay).attach(app.getHttpServer());

  // Applying an update = shut down cleanly and exit with a code scripts/start.sh understands.
  app.get(UpdateService).setRestartHandler(async () => {
    logger.log('Restarting to apply an update…');
    setTimeout(() => process.exit(RESTART_FOR_UPDATE_EXIT_CODE), 10_000).unref();
    await app.close().catch(() => undefined);
    process.exit(RESTART_FOR_UPDATE_EXIT_CODE);
  });

  if (!isPterodactylConfigured(config)) {
    logger.warn('Pterodactyl is not connected yet: set PTERODACTYL_URL, PTERODACTYL_APP_KEY and PTERODACTYL_CLIENT_KEY.');
  }

  await app.listen(config.PORT, '0.0.0.0');
  // The Pterodactyl egg watches for this exact line to mark the server as "running".
  logger.log(`ICE18 panel listening on port ${config.PORT}`);
}

bootstrap().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
