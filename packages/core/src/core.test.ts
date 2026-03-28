import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createBffCore, resolveCrypto } from './core.js'
import { createAesCrypto } from './session.js'

const testKey = randomBytes(32).toString('hex')
const crypto = createAesCrypto(testKey)

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const discoveryResponse = {
  ok: true,
  json: async () => ({
    authorization_endpoint: 'https://idp.example.com/authorize',
    token_endpoint: 'https://idp.example.com/token',
    end_session_endpoint: 'https://idp.example.com/logout',
  }),
}

async function makeCore() {
  mockFetch.mockResolvedValueOnce(discoveryResponse)
  return createBffCore(
    {
      issuerUrl: 'https://idp.example.com',
      clientId: 'test-app',
      redirectUri: 'https://app.example.com/auth/callback',
    },
    crypto,
  )
}

describe('BffCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('discovers OIDC endpoints at creation', async () => {
    const core = await makeCore()
    expect(core.endpoints.authorizationUrl).toBe('https://idp.example.com/authorize')
    expect(core.endpoints.tokenUrl).toBe('https://idp.example.com/token')
    expect(core.endpoints.endSessionUrl).toBe('https://idp.example.com/logout')
  })

  it('startLogin returns redirect URL with PKCE and encrypted cookie', async () => {
    const core = await makeCore()
    const { cookieValue, redirectUrl } = await core.startLogin()

    expect(redirectUrl).toContain('https://idp.example.com/authorize')
    expect(redirectUrl).toContain('code_challenge=')
    expect(redirectUrl).toContain('code_challenge_method=S256')
    expect(redirectUrl).toContain('client_id=test-app')
    expect(cookieValue).toBeTruthy()

    // Cookie decrypts to PkceState
    const pkce = (await crypto.decrypt(cookieValue)) as { verifier: string; state: string }
    expect(pkce.verifier).toBeTruthy()
    expect(pkce.state).toBeTruthy()
    expect(redirectUrl).toContain(`state=${pkce.state}`)
  })

  it('handleCallback exchanges code for tokens', async () => {
    const core = await makeCore()
    const { cookieValue, redirectUrl } = await core.startLogin()
    const state = new URL(redirectUrl).searchParams.get('state')!

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-access',
        id_token: 'test-id',
        refresh_token: 'test-refresh',
        expires_in: 3600,
      }),
    })

    const result = await core.handleCallback('auth-code', state, cookieValue)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.accessToken).toBe('test-access')
      expect(result.sessionValue).toBeTruthy()
    }
  })

  it('handleCallback rejects state mismatch', async () => {
    const core = await makeCore()
    const { cookieValue } = await core.startLogin()

    const result = await core.handleCallback('auth-code', 'wrong-state', cookieValue)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('OAuth state mismatch')
  })

  it('getSession decrypts and validates expiry', async () => {
    const core = await makeCore()
    const valid = await crypto.encrypt({
      accessToken: 'test',
      expiresAt: Date.now() + 3600000,
    })
    const expired = await crypto.encrypt({
      accessToken: 'test',
      expiresAt: Date.now() - 1000,
    })

    expect(await core.getSession(valid)).not.toBeNull()
    expect(await core.getSession(expired)).toBeNull()
    expect(await core.getSession('garbage')).toBeNull()
  })

  it('refreshSession returns new session with tokens', async () => {
    const core = await makeCore()
    const sessionValue = await crypto.encrypt({
      accessToken: 'old-access',
      refreshToken: 'test-refresh',
      expiresAt: Date.now() - 1000,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    })

    const result = await core.refreshSession(sessionValue)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.accessToken).toBe('new-access')
      expect(result.session.refreshToken).toBe('new-refresh')
    }
  })

  it('getLogoutUrl builds URL with id_token_hint', async () => {
    const core = await makeCore()
    const sessionValue = await crypto.encrypt({
      accessToken: 'test',
      idToken: 'test-id-token',
      expiresAt: Date.now() + 3600000,
    })

    const url = await core.getLogoutUrl(sessionValue, '/goodbye')
    expect(url).toContain('https://idp.example.com/logout')
    expect(url).toContain('id_token_hint=test-id-token')
    expect(url).toContain('post_logout_redirect_uri=%2Fgoodbye')
  })

  it('getLogoutUrl returns null if no end_session_endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/authorize',
        token_endpoint: 'https://idp.example.com/token',
      }),
    })
    const core = await createBffCore(
      { issuerUrl: 'https://idp.example.com', clientId: 'test', redirectUri: 'https://app.example.com/cb' },
      crypto,
    )

    expect(await core.getLogoutUrl(undefined, '/')).toBeNull()
  })

  it('resolveCrypto throws if neither provided', () => {
    expect(() => resolveCrypto({})).toThrow('Either crypto or encryptionKey must be provided')
  })
})
