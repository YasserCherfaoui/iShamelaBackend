import { Inject, Injectable } from '@nestjs/common';

import { ENV, type Env } from '../config/env';

export interface AppleCredentials {
  exchangeAuthorizationCode(code: string): Promise<string | null>;
  revokeRefreshToken(refreshToken: string): Promise<void>;
}

@Injectable()
export class AppleSigninCredentials implements AppleCredentials {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async exchangeAuthorizationCode(code: string): Promise<string | null> {
    const apple = await loadApple();
    const clientId = this.env.appleClientIds[0];
    if (!clientId) return null;
    const clientSecret = apple.getClientSecret({
      clientID: clientId,
      teamID: this.env.APPLE_TEAM_ID,
      privateKey: this.env.applePrivateKey,
      keyIdentifier: this.env.APPLE_KEY_ID,
    });
    const tokens = await apple.getAuthorizationToken(code, {
      clientID: clientId,
      clientSecret,
      redirectUri: this.env.PUBLIC_BASE_URL,
    });
    return tokens.refresh_token ?? null;
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const apple = await loadApple();
    const clientId = this.env.appleClientIds[0];
    if (!clientId) return;
    const clientSecret = apple.getClientSecret({
      clientID: clientId,
      teamID: this.env.APPLE_TEAM_ID,
      privateKey: this.env.applePrivateKey,
      keyIdentifier: this.env.APPLE_KEY_ID,
    });
    await apple.revokeAuthorizationToken(refreshToken, {
      clientID: clientId,
      clientSecret,
      tokenTypeHint: 'refresh_token',
    });
  }
}

async function loadApple() {
  const imported = await import('apple-signin-auth');
  return imported.default ?? imported;
}
