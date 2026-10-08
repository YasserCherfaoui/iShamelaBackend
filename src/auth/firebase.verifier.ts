import { Inject, Injectable } from '@nestjs/common';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { ApiException, unauthorized } from '../common/api.exception';
import { ENV, type Env } from '../config/env';
import { firebaseIdentity, type FirebaseIdentity } from './firebase-identity';

@Injectable()
export class FirebaseTokenVerifier {
  constructor(@Inject(ENV) env: Env) {
    if (getApps().length === 0) {
      initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
    }
  }

  async verify(token: string): Promise<FirebaseIdentity> {
    try {
      const decoded = await getAuth().verifyIdToken(token);
      const identity = firebaseIdentity(decoded);
      if (!identity) {
        throw unauthorized('Firebase sign-in provider is not supported');
      }
      return identity;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw unauthorized('Firebase ID token is invalid');
    }
  }
}
