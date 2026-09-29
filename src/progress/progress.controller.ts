import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

import { CurrentAuth, type AuthContext } from '../common/auth.decorator';
import { ProgressService } from './progress.service';

@SkipThrottle({ default: true, otp: true, sync: true })
@Throttle({ progress: { limit: 600, ttl: 60_000 } })
@Controller('progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  beacon(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<void> {
    return this.progress.beacon(auth.userId, auth.deviceId, body);
  }
}
