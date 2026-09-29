import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { CurrentAuth, type AuthContext } from '../common/auth.decorator';
import { PatchMeDto, UsersService, type Profile } from './users.service';

@SkipThrottle({ otp: true, sync: true, progress: true })
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getMe(@CurrentAuth() auth: AuthContext): Promise<Profile> {
    return this.users.getMe(auth.userId);
  }

  @Patch()
  patchMe(@CurrentAuth() auth: AuthContext, @Body() body: PatchMeDto): Promise<Profile> {
    return this.users.patchMe(auth.userId, body.displayName);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMe(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.users.deleteMe(auth.userId);
  }
}
