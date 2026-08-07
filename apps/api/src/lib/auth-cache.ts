/**
 * Short-lived cache of Paperless tokens already confirmed valid, so an
 * authenticated request doesn't have to round-trip to Paperless on every
 * single call - just re-checked periodically. Also means a previously
 * verified session keeps working for a few minutes if Paperless is
 * briefly unreachable.
 */

const TTL_MS = 5 * 60 * 1000

const verifiedUntil = new Map<string, number>()

export function isTokenCached(token: string): boolean {
  const expiresAt = verifiedUntil.get(token)
  if (expiresAt === undefined) return false
  if (expiresAt < Date.now()) {
    verifiedUntil.delete(token)
    return false
  }
  return true
}

export function cacheToken(token: string): void {
  verifiedUntil.set(token, Date.now() + TTL_MS)
}

export function evictToken(token: string): void {
  verifiedUntil.delete(token)
}
