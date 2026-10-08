import { firebaseIdentity } from '../src/auth/firebase-identity';

describe('firebaseIdentity', () => {
  it('maps google.com to the Google subject', () => {
    expect(
      firebaseIdentity({
        email: 'Reader@example.com',
        firebase: {
          sign_in_provider: 'google.com',
          identities: { 'google.com': ['google-sub'], email: ['Reader@example.com'] },
        },
      }),
    ).toEqual({
      provider: 'google',
      subject: 'google-sub',
      email: 'reader@example.com',
    });
  });

  it('maps apple.com to the Apple subject', () => {
    expect(
      firebaseIdentity({
        firebase: {
          sign_in_provider: 'apple.com',
          identities: { 'apple.com': ['apple-sub'] },
        },
      }),
    ).toEqual({
      provider: 'apple',
      subject: 'apple-sub',
      email: null,
    });
  });

  it('maps password to the lowercased email', () => {
    expect(
      firebaseIdentity({
        email: 'Reader@example.com',
        firebase: { sign_in_provider: 'password', identities: { email: ['Reader@example.com'] } },
      }),
    ).toEqual({
      provider: 'email',
      subject: 'reader@example.com',
      email: 'reader@example.com',
    });
  });

  it('rejects an unknown provider and a missing subject', () => {
    expect(
      firebaseIdentity({ firebase: { sign_in_provider: 'phone', identities: {} } }),
    ).toBeNull();
    expect(
      firebaseIdentity({
        firebase: { sign_in_provider: 'google.com', identities: {} },
      }),
    ).toBeNull();
    expect(
      firebaseIdentity({ firebase: { sign_in_provider: 'password', identities: {} } }),
    ).toBeNull();
  });
});
