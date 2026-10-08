import { Module } from '@nestjs/common';

import { AppleSigninCredentials } from './apple-credentials';
import { AppleTokenVerifier } from './apple.verifier';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseTokenVerifier } from './firebase.verifier';
import { GoogleTokenVerifier } from './google.verifier';
import { APPLE_JWKS, TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    AppleTokenVerifier,
    GoogleTokenVerifier,
    FirebaseTokenVerifier,
    AppleSigninCredentials,
    {
      provide: APPLE_JWKS,
      useFactory: async () => {
        const { createRemoteJWKSet } = await import('jose');
        return createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
      },
    },
  ],
  exports: [
    AuthService,
    TokenService,
    FirebaseTokenVerifier,
    AppleSigninCredentials,
    AppleTokenVerifier,
    GoogleTokenVerifier,
    APPLE_JWKS,
  ],
})
export class AuthModule {}
