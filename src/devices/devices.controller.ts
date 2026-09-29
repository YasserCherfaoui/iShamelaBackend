import { Body, Controller, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { CurrentAuth, type AuthContext } from '../common/auth.decorator';
import { DevicesService, RegisterDeviceDto } from './devices.service';

@SkipThrottle({ otp: true, sync: true, progress: true })
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('register')
  register(
    @CurrentAuth() auth: AuthContext,
    @Body() body: RegisterDeviceDto,
  ): Promise<{ id: string }> {
    return this.devices.register(auth.userId, auth.deviceId, body);
  }
}
