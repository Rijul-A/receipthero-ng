import type { Context, Next } from 'hono'
import { loadConfig, verifyPaperlessToken } from '@sm-rn/core'
import { cacheToken, isTokenCached } from '../lib/auth-cache'

/**
 * Extracts the bearer token from an `Authorization: Token <token>` header
 * (Paperless-NGX's own scheme, reused here since the value literally is a
 * Paperless token).
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Token ')) return null
  const token = authHeader.slice('Token '.length).trim()
  return token.length > 0 ? token : null
}

/**
 * True if `token` is still a valid Paperless-NGX session, using the
 * short-lived cache to avoid round-tripping to Paperless on every call.
 */
export async function isTokenAuthorized(token: string): Promise<boolean> {
  if (isTokenCached(token)) return true

  const config = loadConfig()
  const valid = await verifyPaperlessToken(config.paperless.host, token)
  if (valid) cacheToken(token)
  return valid
}

/**
 * Gates a route behind a valid Paperless session token.
 */
export async function requireAuth(c: Context, next: Next) {
  const token = extractToken(c.req.header('Authorization'))
  if (!token || !(await isTokenAuthorized(token))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
