import { describe, it, expect, afterEach } from 'bun:test'
import { loginToPaperless, verifyPaperlessToken } from '../services/paperless-auth'

const HOST = 'http://paperless.local'

describe('loginToPaperless', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns the token on valid credentials, hitting Paperless-NGX own token endpoint', async () => {
    let requestedUrl = ''
    let requestedBody: unknown = null
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requestedUrl = url
      requestedBody = init?.body ? JSON.parse(init.body as string) : null
      return new Response(JSON.stringify({ token: 'abc123' }), { status: 200 })
    }) as unknown as typeof fetch

    const token = await loginToPaperless(HOST, 'rijul', 'hunter2')

    expect(token).toBe('abc123')
    expect(requestedUrl).toBe(`${HOST}/api/token/`)
    expect(requestedBody).toEqual({ username: 'rijul', password: 'hunter2' })
  })

  it('strips a trailing slash from the host before building the URL', async () => {
    let requestedUrl = ''
    globalThis.fetch = (async (url: string) => {
      requestedUrl = url
      return new Response(JSON.stringify({ token: 'abc123' }), { status: 200 })
    }) as unknown as typeof fetch

    await loginToPaperless(`${HOST}/`, 'rijul', 'hunter2')

    expect(requestedUrl).toBe(`${HOST}/api/token/`)
  })

  it('returns null on a 400 (wrong username/password), not a thrown error', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ non_field_errors: ['Unable to log in'] }), {
        status: 400,
      })) as unknown as typeof fetch

    expect(await loginToPaperless(HOST, 'rijul', 'wrong')).toBeNull()
  })

  it('returns null when Paperless is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    expect(await loginToPaperless(HOST, 'rijul', 'hunter2')).toBeNull()
  })

  it('returns null when the 200 response has no token field', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch

    expect(await loginToPaperless(HOST, 'rijul', 'hunter2')).toBeNull()
  })
})

describe('verifyPaperlessToken', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns true and sends the token as an Authorization header when Paperless accepts it', async () => {
    let requestedUrl = ''
    let authHeader: string | null = null
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requestedUrl = url
      authHeader = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const valid = await verifyPaperlessToken(HOST, 'abc123')

    expect(valid).toBe(true)
    expect(requestedUrl).toBe(`${HOST}/api/ui_settings/`)
    // TS narrows `authHeader` to `null` here since the only assignment it
    // can see in this scope is the initializer - the real reassignment
    // happens inside the fetch mock closure above.
    expect(authHeader as string | null).toBe('Token abc123')
  })

  it('returns false when Paperless rejects the token', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch

    expect(await verifyPaperlessToken(HOST, 'revoked-token')).toBe(false)
  })

  it('returns false when Paperless is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    expect(await verifyPaperlessToken(HOST, 'abc123')).toBe(false)
  })
})
