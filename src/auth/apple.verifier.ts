import { Inject, Injectable } from '@nestjs/common';

import { ApiException, tokenInvalid } from '../common/api.exception';
import { ENV, type Env } from '../config/env';
import { APPLE_JWKS, type AppleJwks } from './token.service';

export type VerifiedIdentity = {
  sub: string;
  email: string | null;
};

@Injectable()
export class AppleTokenVerifier {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(APPLE_JWKS) private readonly jwks: AppleJwks,
  ) {}

  async verify(identityToken: string): Promise<VerifiedIdentity> {
    const { jwtVerify } = await import('jose');
    try {
      const { payload } = await jwtVerify(identityToken, this.jwks, {
        issuer: 'https://appleid.apple.com',
        audience: this.env.appleClientIds,
      });
      if (!payload.sub) throw tokenInvalid('Apple identity token is invalid');
      const email = typeof payload.email === 'string' ? payload.email : null;
      return { sub: payload.sub, email };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw tokenInvalid('Apple identity token is invalid');
    }
  }
}
