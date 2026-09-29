import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

import { Public } from '../common/public.decorator';
import {
  AppleAuthDto,
  AuthService,
  GoogleAuthDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshDto,
  type AuthResult,
} from './auth.service';

@Public()
@SkipThrottle({ otp: true, sync: true, progress: true })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('apple')
  signInWithApple(@Body() body: AppleAuthDto): Promise<AuthResult> {
    return this.auth.signInWithApple(body);
  }

  @Post('google')
  signInWithGoogle(@Body() body: GoogleAuthDto): Promise<AuthResult> {
    return this.auth.signInWithGoogle(body);
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipThrottle({ default: true, sync: true, progress: true })
  @Throttle({ otp: { limit: 20, ttl: 3_600_000 } })
  requestOtp(@Body() body: OtpRequestDto): Promise<void> {
    return this.auth.requestOtp(body.email);
  }

  @Post('otp/verify')
  verifyOtp(@Body() body: OtpVerifyDto): Promise<AuthResult> {
    return this.auth.verifyOtp(body);
  }

  @Post('refresh')
  refresh(@Body() body: RefreshDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() body: RefreshDto): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }
}
