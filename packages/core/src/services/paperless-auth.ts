/**
 * Paperless-NGX Login Verification
 *
 * Proxies a username/password to Paperless-NGX's own token endpoint so the
 * app's login page can gate access with the operator's real Paperless
 * credentials, without ever storing the password - it's used once here to
 * obtain (or confirm) a Paperless API token, then discarded.
 */

/**
 * Exchanges a Paperless username/password for an API token, exactly as
 * Paperless-NGX's own login screen does. Returns null on invalid
 * credentials or an unreachable host - never throws for a 400/401, since
 * that's an expected outcome (wrong password) rather than a bug.
 */
export async function loginToPaperless(
  host: string,
  username: string,
  password: string,
): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(`${host.replace(/\/$/, '')}/api/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  const data = (await response.json().catch(() => null)) as { token?: unknown } | null
  return typeof data?.token === 'string' ? data.token : null
}

/**
 * Confirms a token is still accepted by Paperless-NGX, by hitting an
 * endpoint that requires auth but returns a small payload.
 */
export async function verifyPaperlessToken(host: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${host.replace(/\/$/, '')}/api/ui_settings/`, {
      headers: { Authorization: `Token ${token}` },
    })
    return response.ok
  } catch {
    return false
  }
}
