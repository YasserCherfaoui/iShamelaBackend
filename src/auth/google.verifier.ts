import { Inject, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

import { ApiException, tokenInvalid } from '../common/api.exception';
import { ENV, type Env } from '../config/env';
import type { VerifiedIdentity } from './apple.verifier';

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(@Inject(ENV) private readonly env: Env) {}

  async verify(idToken: string): Promise<VerifiedIdentity> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.env.googleClientIds,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) throw tokenInvalid('Google ID token is invalid');
      const aud = payload.aud;
      const audiences = Array.isArray(aud) ? aud : aud ? [aud] : [];
      if (!audiences.some((value) => this.env.googleClientIds.includes(value))) {
        throw tokenInvalid('Google ID token is invalid');
      }
      const email = typeof payload.email === 'string' ? payload.email : null;
      return { sub: payload.sub, email };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw tokenInvalid('Google ID token is invalid');
    }
  }
}
