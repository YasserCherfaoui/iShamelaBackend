import { clampClientTime, decideLww, FUTURE_SKEW_MS } from '../src/common/lww';

describe('last-writer-wins', () => {
  const earlier = new Date('2024-01-01T00:00:00.000Z');
  const later = new Date('2024-01-02T00:00:00.000Z');

  it('applies a newer client time and rejects an older one', () => {
    expect(decideLww(later, earlier)).toBe('apply');
    expect(decideLww(earlier, later)).toBe('stale');
    expect(decideLww(later, later)).toBe('duplicate');
    expect(decideLww(later, null)).toBe('apply');
  });

  it('clamps timestamps more than five minutes ahead to server time', () => {
    const serverTime = new Date('2024-01-01T00:00:00.000Z');
    const tooFar = new Date(serverTime.getTime() + FUTURE_SKEW_MS + 1);
    const within = new Date(serverTime.getTime() + FUTURE_SKEW_MS);
    expect(clampClientTime(tooFar, serverTime)).toEqual(serverTime);
    expect(clampClientTime(within, serverTime)).toEqual(within);
  });
});
