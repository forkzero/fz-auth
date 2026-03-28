import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createBffRoutes } from './routes.js'
import { encrypt, decrypt, createAesCrypto } from './session.js'
import type { BffSession, SessionCrypto } from './types.js'

const testKey = randomBytes(32).toString('hex')

// Mock fetch for OIDC discovery + token exchange + profile fetches
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const discoveryResponse = {
  ok: true,
  json: async () => ({
    authorization_endpoint: 'https://oauth.example.com/oauth2/auth',
    token_endpoint: 'https://oauth.example.com/oauth2/token',
    end_session_endpoint: 'https://oauth.example.com/oauth2/sessions/logout',
  }),
}

async function makeRoutes() {
  // First fetch call is OIDC discovery
  mockFetch.mockResolvedValueOnce(discoveryResponse)
  return createBffRoutes({
    issuerUrl: 'https://oauth.example.com',
    clientId: 'test-app',
    redirectUri: 'https://app.example.com/auth/callback',
    authApiUrl: 'https://auth.example.com',
    encryptionKey: testKey,
    postLoginRedirect: '/dashboard',
    postLogoutRedirect: '/',
  })
}

describe('BFF routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /login', () => {
    it('redirects to Hydra with PKCE challenge', async () => {
      const app = await makeRoutes()
      const res = await app.request('/login')

      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).toContain('https://oauth.example.com/oauth2/auth')
      expect(location).toContain('response_type=code')
      expect(location).toContain('client_id=test-app')
      expect(location).toContain('code_challenge=')
      expect(location).toContain('code_challenge_method=S256')
      expect(location).toContain('state=')
    })

    it('sets an encrypted PKCE cookie', async () => {
      const app = await makeRoutes()
      const res = await app.request('/login')

      const setCookies = res.headers.getSetCookie()
      const pkceCookie = setCookies.find((c: string) => c.includes('fz_pkce'))
      expect(pkceCookie).toBeDefined()
      expect(pkceCookie).toContain('HttpOnly')
      expect(pkceCookie).toContain('Secure')
    })
  })

  describe('GET /callback', () => {
    it('returns 400 without code or state', async () => {
      const app = await makeRoutes()
      const res = await app.request('/callback')
      expect(res.status).toBe(400)
    })

    it('returns 400 without PKCE cookie', async () => {
      const app = await makeRoutes()
      const res = await app.request('/callback?code=abc&state=xyz')
      expect(res.status).toBe(400)
    })

    it('exchanges code for tokens and sets session cookie', async () => {
      const app = await makeRoutes()

      // First, hit /login to get the PKCE cookie
      const loginRes = await app.request('/login')
      const setCookies = loginRes.headers.getSetCookie()
      const pkceCookie = setCookies.find((c: string) => c.includes('fz_pkce'))!
      const cookieValue = pkceCookie.split('=').slice(1).join('=').split(';')[0]

      // Extract state from redirect URL
      const location = loginRes.headers.get('location')!
      const state = new URL(location).searchParams.get('state')!

      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-access-token',
          id_token: 'test-id-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
        }),
      })

      const callbackRes = await app.request(`/callback?code=test-code&state=${state}`, {
        headers: { cookie: `__Host-fz_pkce=${cookieValue}` },
      })

      expect(callbackRes.status).toBe(302)
      expect(callbackRes.headers.get('location')).toBe('/dashboard')

      // Verify session cookie was set
      const sessionCookies = callbackRes.headers.getSetCookie()
      const sessionCookie = sessionCookies.find((c: string) => c.includes('fz_session'))
      expect(sessionCookie).toBeDefined()
      expect(sessionCookie).toContain('HttpOnly')
      expect(sessionCookie).toContain('Secure')
    })
  })

  describe('GET /session', () => {
    it('returns 401 without session cookie', async () => {
      const app = await makeRoutes()
      const res = await app.request('/session')
      expect(res.status).toBe(401)
    })

    it('returns 401 for expired session', async () => {
      const app = await makeRoutes()
      const expired: BffSession = {
        accessToken: 'test',
        expiresAt: Date.now() - 1000,
      }
      const cookie = encrypt(expired, testKey)

      const res = await app.request('/session', {
        headers: { cookie: `__Host-fz_session=${cookie}` },
      })
      expect(res.status).toBe(401)
    })

    it('returns user profile for valid session', async () => {
      const app = await makeRoutes()
      const session: BffSession = {
        accessToken: 'valid-token',
        expiresAt: Date.now() + 3600000,
      }
      const cookie = encrypt(session, testKey)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'user-1',
          email: 'test@example.com',
          organizations: [],
        }),
      })

      const res = await app.request('/session', {
        headers: { cookie: `__Host-fz_session=${cookie}` },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(true)
      expect(body.user.email).toBe('test@example.com')
    })
  })

  describe('GET /logout', () => {
    it('redirects to Hydra logout with id_token_hint', async () => {
      const app = await makeRoutes()
      const session: BffSession = {
        accessToken: 'test',
        idToken: 'test-id-token',
        expiresAt: Date.now() + 3600000,
      }
      const cookie = encrypt(session, testKey)

      const res = await app.request('/logout', {
        headers: { cookie: `__Host-fz_session=${cookie}` },
      })
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).toContain('oauth2/sessions/logout')
      expect(location).toContain('id_token_hint=test-id-token')
    })

    it('clears session cookie', async () => {
      const app = await makeRoutes()
      const session: BffSession = {
        accessToken: 'test',
        expiresAt: Date.now() + 3600000,
      }
      const cookie = encrypt(session, testKey)

      const res = await app.request('/logout', {
        headers: { cookie: `__Host-fz_session=${cookie}` },
      })
      const setCookies = res.headers.getSetCookie()
      const cleared = setCookies.find((c: string) => c.includes('fz_session'))
      expect(cleared).toContain('Max-Age=0')
    })
  })

  describe('custom SessionCrypto', () => {
    it('accepts a pluggable crypto implementation', async () => {
      const encrypted: string[] = []
      const noopCrypto: SessionCrypto = {
        async encrypt(data: unknown) {
          const s = Buffer.from(JSON.stringify(data)).toString('base64url')
          encrypted.push(s)
          return s
        },
        async decrypt(encoded: string) {
          return JSON.parse(Buffer.from(encoded, 'base64url').toString())
        },
      }

      mockFetch.mockResolvedValueOnce(discoveryResponse)
      const app = await createBffRoutes({
        issuerUrl: 'https://oauth.example.com',
        clientId: 'test-app',
        redirectUri: 'https://app.example.com/auth/callback',
        authApiUrl: 'https://auth.example.com',
        crypto: noopCrypto,
        postLoginRedirect: '/dashboard',
      })

      const res = await app.request('/login')
      expect(res.status).toBe(302)
      // Verify custom crypto was called (not built-in AES)
      expect(encrypted.length).toBe(1)
      const decoded = JSON.parse(Buffer.from(encrypted[0], 'base64url').toString())
      expect(decoded).toHaveProperty('verifier')
      expect(decoded).toHaveProperty('state')
    })

    it('throws if neither crypto nor encryptionKey provided', async () => {
      mockFetch.mockResolvedValueOnce(discoveryResponse)
      await expect(createBffRoutes({
        issuerUrl: 'https://oauth.example.com',
        clientId: 'test-app',
        redirectUri: 'https://app.example.com/auth/callback',
        authApiUrl: 'https://auth.example.com',
      })).rejects.toThrow('Either crypto or encryptionKey must be provided')
    })
  })
})
