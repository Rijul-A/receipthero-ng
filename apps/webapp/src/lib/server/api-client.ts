/**
 * Shared fetch wrapper for every server function that proxies to the
 * internal API. Centralized so the session token (read from the httpOnly
 * cookie set at login) is attached exactly once, everywhere, instead of
 * each *.functions.ts file re-deriving its own request headers.
 */

import { getCookie } from '@tanstack/react-start/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

export const SESSION_COOKIE_NAME = 'ph_session'

/**
 * Fetches from the internal API, attaching the caller's session token (if
 * any) as an `Authorization: Token <token>` header - the same scheme
 * Paperless-NGX itself uses, since the token literally is a Paperless
 * token. Returns the raw Response for callers that need something other
 * than parsed JSON (CSV/binary downloads, or endpoints with meaningful
 * non-2xx bodies).
 */
export async function authorizedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getCookie(SESSION_COOKIE_NAME)

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...init.headers,
    },
  })
}

/**
 * authorizedFetch + JSON parsing, throwing a message extracted from the
 * error body on any non-2xx response. Used for the common JSON in/out case.
 */
export async function apiCall<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await authorizedFetch(path, init)

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(
      error.error || error.message || `API error: ${response.status}`,
    )
  }

  return response.json()
}
