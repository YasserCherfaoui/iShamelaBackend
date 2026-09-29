export const FUTURE_SKEW_MS = 5 * 60 * 1000;

export function clampClientTime(input: Date, serverTime: Date): Date {
  if (input.getTime() > serverTime.getTime() + FUTURE_SKEW_MS) return serverTime;
  return input;
}

export type LwwDecision = 'apply' | 'stale' | 'duplicate';

export function decideLww(incoming: Date, stored: Date | null): LwwDecision {
  if (!stored) return 'apply';
  const left = incoming.getTime();
  const right = stored.getTime();
  if (left > right) return 'apply';
  if (left < right) return 'stale';
  return 'duplicate';
}

export function parseClientTime(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
