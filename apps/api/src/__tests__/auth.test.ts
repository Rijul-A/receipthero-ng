import { describe, test, expect, afterEach } from 'bun:test'
import { app } from '../index'
import { cacheToken } from '../lib/auth-cache'

describe('POST /api/auth/login', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns a token on valid Paperless credentials', async () => {
    let requestedUrl = ''
    globalThis.fetch = (async (url: string) => {
      requestedUrl = url
      return new Response(JSON.stringify({ token: 'freshly-issued-token' }), { status: 200 })
    }) as unknown as typeof fetch

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rijul', password: 'hunter2' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string }
    expect(body.token).toBe('freshly-issued-token')
    expect(requestedUrl).toContain('/api/token/')

    // The freshly issued token should now work against a protected route
    // without a separate Paperless round trip (it was cached on login).
    const protectedRes = await app.request('/api/items/search?q=x', {
      headers: { Authorization: 'Token freshly-issued-token' },
    })
    expect(protectedRes.status).not.toBe(401)
  })

  test('401s on invalid credentials', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ non_field_errors: ['bad'] }), {
        status: 400,
      })) as unknown as typeof fetch

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rijul', password: 'wrong' }),
    })

    expect(res.status).toBe(401)
  })

  test('400s on a missing password', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rijul' }),
    })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/logout', () => {
  // Uses a dedicated token rather than the shared TEST_AUTH_TOKEN from
  // setup.ts, since evicting that one would break every other test file's
  // use of authHeaders() (bun test runs the whole suite in one process,
  // sharing the auth-cache module's state).
  test('evicts the token, so it must be re-verified against Paperless next time', async () => {
    cacheToken('logout-test-token')

    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Token logout-test-token' },
    })
    expect(res.status).toBe(200)

    const sessionRes = await app.request('/api/auth/session', {
      headers: { Authorization: 'Token logout-test-token' },
    })
    const body = (await sessionRes.json()) as { valid: boolean }
    // Re-verification hits the real (unreachable in tests) Paperless host,
    // so the evicted token is no longer considered valid.
    expect(body.valid).toBe(false)
  })
})

describe('GET /api/auth/session', () => {
  test('reports valid for a cached token', async () => {
    const res = await app.request('/api/auth/session', {
      headers: { Authorization: 'Token still-cached-token' },
    })
    // Not cached yet - re-verification against an unreachable Paperless
    // host fails, so this should read as invalid.
    const body = (await res.json()) as { valid: boolean }
    expect(res.status).toBe(200)
    expect(body.valid).toBe(false)
  })

  test('reports invalid with no Authorization header', async () => {
    const res = await app.request('/api/auth/session')
    const body = (await res.json()) as { valid: boolean }
    expect(res.status).toBe(200)
    expect(body.valid).toBe(false)
  })
})

describe('requireAuth gating', () => {
  test('a protected route 401s with no Authorization header', async () => {
    const res = await app.request('/api/items/search?q=milk')
    expect(res.status).toBe(401)
  })

  test('a protected route 401s with an unrecognized token', async () => {
    const res = await app.request('/api/items/search?q=milk', {
      headers: { Authorization: 'Token not-a-real-token' },
    })
    expect(res.status).toBe(401)
  })

  test('/api/health stays reachable without a session', async () => {
    const res = await app.request('/api/health')
    expect(res.status).not.toBe(401)
  })

  test('/api/events (worker callback) stays reachable without a session', async () => {
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'receipt:success', payload: { documentId: 1, progress: 100 } }),
    })
    expect(res.status).not.toBe(401)
  })

  // Browsers can't set custom headers on a WebSocket upgrade request, so
  // /ws checks a `token` query param instead - reachable as a plain HTTP
  // request in tests since the auth check runs before the actual upgrade.
  test('/ws 401s with no token query param', async () => {
    const res = await app.request('/ws')
    expect(res.status).toBe(401)
  })

  test('/ws 401s with an unrecognized token', async () => {
    const res = await app.request('/ws?token=not-a-real-token')
    expect(res.status).toBe(401)
  })
})
