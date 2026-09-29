import 'reflect-metadata';

import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { config as loadDotenv } from 'dotenv';

import { ApiExceptionFilter } from './common/api-exception.filter';
import { loadEnv, type Env } from './config/env';
import { runMigrations } from './db/migrate';
import { AppModule } from './app.module';

loadDotenv({ quiet: true });

export function configureApp(app: NestExpressApplication, env: Env): void {
  app.setGlobalPrefix('v1', {
    exclude: ['health'],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use(helmet());
  app.enableCors({ origin: env.corsOrigins });
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.useLogger(app.get(Logger));
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  if (process.env.SKIP_MIGRATE !== '1') {
    await runMigrations(env.DATABASE_URL);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app, env);
  await app.listen(env.PORT);
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'failed to start';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
