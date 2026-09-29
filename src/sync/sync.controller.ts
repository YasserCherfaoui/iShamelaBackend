import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

import { CurrentAuth, type AuthContext } from '../common/auth.decorator';
import { PullQueryDto, PushDto, SyncService } from './sync.service';

@SkipThrottle({ default: true, otp: true, progress: true })
@Throttle({ sync: { limit: 60, ttl: 60_000 } })
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('pull')
  pull(@CurrentAuth() auth: AuthContext, @Query() query: PullQueryDto) {
    return this.sync.pull(auth.userId, query.since, query.limit);
  }

  @Post('push')
  push(@CurrentAuth() auth: AuthContext, @Body() body: PushDto) {
    return this.sync.push(auth.userId, auth.deviceId, body.changes);
  }
}
