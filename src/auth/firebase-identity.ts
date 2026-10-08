export type FirebaseIdentity = {
  provider: 'apple' | 'google' | 'email';
  subject: string;
  email: string | null;
};

export type FirebaseIdTokenClaims = {
  email?: string;
  firebase?: {
    sign_in_provider?: string;
    identities?: Record<string, string[]>;
  };
};

/// SPEC-032 uid mapping. Firebase `uid` is not `users.id`.
export function firebaseIdentity(claims: FirebaseIdTokenClaims): FirebaseIdentity | null {
  const providerName = claims.firebase?.sign_in_provider;
  const identities = claims.firebase?.identities ?? {};
  const email = claims.email?.trim().toLowerCase() || null;
  if (providerName === 'google.com') {
    const subject = identities['google.com']?.[0];
    if (!subject) return null;
    return { provider: 'google', subject, email };
  }
  if (providerName === 'apple.com') {
    const subject = identities['apple.com']?.[0];
    if (!subject) return null;
    return { provider: 'apple', subject, email };
  }
  if (providerName === 'password') {
    if (!email) return null;
    return { provider: 'email', subject: email, email };
  }
  return null;
}

export function jwtAlg(token: string): string | null {
  const head = token.split('.')[0];
  if (!head) return null;
  try {
    const json = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { alg?: unknown };
    return typeof json.alg === 'string' ? json.alg : null;
  } catch {
    return null;
  }
}
