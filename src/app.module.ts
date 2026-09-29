import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AccessAuthGuard } from './common/auth.guard';
import { AppThrottlerGuard } from './common/throttler.guard';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './db/database';
import { DevicesModule } from './devices/devices.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { ProgressModule } from './progress/progress.module';
import { SyncModule } from './sync/sync.module';
import { UsersModule } from './users/users.module';

function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: isTest() ? 'silent' : 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.body.code',
              'req.body.email',
              'req.body.refreshToken',
              'req.body.identityToken',
              'req.body.idToken',
              'req.body.authorizationCode',
            ],
            censor: '[Redacted]',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const testing = isTest();
        return {
          throttlers: [
            { name: 'default', ttl: 60_000, limit: testing ? 10_000 : 120 },
            { name: 'otp', ttl: 3_600_000, limit: testing ? 10_000 : 20 },
            { name: 'sync', ttl: 60_000, limit: testing ? 10_000 : 60 },
            { name: 'progress', ttl: 60_000, limit: testing ? 10_000 : 600 },
          ],
        };
      },
    }),
    DatabaseModule,
    MailModule,
    AuthModule,
    UsersModule,
    DevicesModule,
    SyncModule,
    ProgressModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AccessAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
