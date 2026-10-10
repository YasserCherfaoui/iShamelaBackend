const loopbackOrigin = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Browser origin allowed to call the API. Missing origin is a non-browser client. */
export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin == null || origin.length === 0) return true;
  if (allowed.includes(origin)) return true;
  return loopbackOrigin.test(origin);
}
