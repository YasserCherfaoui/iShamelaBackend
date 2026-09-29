import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';

import { Public } from '../common/public.decorator';
import { DRIZZLE, type Database } from '../db/database';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  async health(@Res({ passthrough: true }) response: Response) {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', db: 'ok' };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', db: 'error' };
    }
  }
}
