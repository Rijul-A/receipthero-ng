import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { loadConfig, loginToPaperless } from '@sm-rn/core'
import { cacheToken, evictToken } from '../lib/auth-cache'
import { extractToken, isTokenAuthorized } from '../middleware/require-auth'

const auth = new Hono()

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

/**
 * POST /api/auth/login
 *
 * Proxies credentials to Paperless-NGX's own token endpoint. The password
 * is used once here to obtain a token and is never stored.
 */
auth.post('/login', zValidator('json', LoginSchema), async (c) => {
  const { username, password } = c.req.valid('json')
  const config = loadConfig()

  const token = await loginToPaperless(config.paperless.host, username, password)
  if (!token) {
    return c.json({ error: 'Invalid Paperless username or password' }, 401)
  }

  cacheToken(token)
  return c.json({ token })
})

/**
 * POST /api/auth/logout
 *
 * Drops the token from the verified-token cache, so it's re-checked
 * against Paperless if it's ever presented again. This only ends the
 * app's session - Paperless itself doesn't revoke the token.
 */
auth.post('/logout', async (c) => {
  const token = extractToken(c.req.header('Authorization'))
  if (token) evictToken(token)
  return c.json({ success: true })
})

/**
 * GET /api/auth/session
 *
 * Reports whether the given token is still a valid Paperless session -
 * used by the webapp's route guard to decide whether to redirect to login.
 */
auth.get('/session', async (c) => {
  const token = extractToken(c.req.header('Authorization'))
  const valid = token ? await isTokenAuthorized(token) : false
  return c.json({ valid })
})

export default auth
