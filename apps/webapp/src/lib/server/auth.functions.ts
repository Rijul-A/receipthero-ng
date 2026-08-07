/**
 * Login Session Server Functions
 */

import { createServerFn } from '@tanstack/react-start'
import {
  deleteCookie,
  getCookie,
  getRequestProtocol,
  setCookie,
} from '@tanstack/react-start/server'
import { SESSION_COOKIE_NAME, apiCall } from './api-client'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Logs in with Paperless-NGX credentials (proxied to Paperless's own token
 * endpoint - see apps/api/src/routes/auth.ts) and, on success, sets the
 * httpOnly session cookie every other route checks for.
 */
export const login = createServerFn({ method: 'POST' })
  .inputValidator((input: { username: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { token } = await apiCall<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })

    setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: getRequestProtocol() === 'https',
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
    })

    return { success: true }
  })

/**
 * Ends the session: evicts the token from the API's verified-token cache
 * and clears the cookie. Paperless itself isn't notified - its token stays
 * valid until the operator revokes it there.
 */
export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  try {
    await apiCall('/api/auth/logout', { method: 'POST' })
  } catch {
    // Best-effort - the cookie is cleared either way below.
  }
  deleteCookie(SESSION_COOKIE_NAME, { path: '/' })
  return { success: true }
})

/**
 * Whether the current request has a session cookie that Paperless still
 * accepts - used by the root route guard to decide whether to redirect to
 * /login.
 */
export const checkSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    if (!getCookie(SESSION_COOKIE_NAME)) return { valid: false }

    try {
      const { valid } = await apiCall<{ valid: boolean }>('/api/auth/session')
      return { valid }
    } catch {
      return { valid: false }
    }
  },
)

/**
 * Hands the raw session token to client JS - used only to authenticate the
 * live-events WebSocket connection, which runs against the API's own
 * origin/port and so can't ride the httpOnly cookie the way every other
 * (server-function-proxied, same-origin) request does. Everything else
 * stays server-side only; this is a deliberate, narrow exception.
 */
export const getSocketToken = createServerFn({ method: 'GET' }).handler(
  async () => {
    return { token: getCookie(SESSION_COOKIE_NAME) ?? null }
  },
)
