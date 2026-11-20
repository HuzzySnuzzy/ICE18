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
import { runMigrations } from './db/database.service';
import { ConsoleRelay } from './servers/console.relay';

const WEB_DIST = path.resolve(__dirname, '../../web/dist');

async function bootstrap(): Promise<void> {
  const logger = new Logger('ICE18');
  const config = loadConfig();

  logger.log('Applying database migrations…');
  await runMigrations(config);

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
