import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { AuthContext } from './auth.decorator';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = req.auth as AuthContext | undefined;
    if (auth?.userId) return Promise.resolve(auth.userId);
    const forwarded = req.headers as { 'x-forwarded-for'?: string } | undefined;
    const ip = (req.ip as string | undefined) ?? forwarded?.['x-forwarded-for'] ?? 'unknown';
    return Promise.resolve(String(ip));
  }
}
