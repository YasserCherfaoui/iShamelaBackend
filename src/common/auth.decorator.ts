import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export type AuthContext = {
  userId: string;
  deviceId: string;
};

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{ auth: AuthContext }>();
    return request.auth;
  },
);
