import { isAllowedCorsOrigin } from '../src/config/cors';

const allowed = ['https://app.ishamela.online'];

describe('isAllowedCorsOrigin', () => {
  it('allows the configured site and loopback web ports', () => {
    expect(isAllowedCorsOrigin(undefined, allowed)).toBe(true);
    expect(isAllowedCorsOrigin('https://app.ishamela.online', allowed)).toBe(true);
    expect(isAllowedCorsOrigin('http://localhost:8080', allowed)).toBe(true);
    expect(isAllowedCorsOrigin('http://127.0.0.1:54321', allowed)).toBe(true);
    expect(isAllowedCorsOrigin('http://[::1]:8080', allowed)).toBe(true);
  });

  it('rejects other origins', () => {
    expect(isAllowedCorsOrigin('https://evil.example', allowed)).toBe(false);
    expect(isAllowedCorsOrigin('http://localhost.evil.example', allowed)).toBe(false);
    expect(isAllowedCorsOrigin('https://localhost:8080', allowed)).toBe(false);
  });
});