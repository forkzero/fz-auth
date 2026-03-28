import { describe, it, expect, vi, beforeEach } from 'vitest'
import { discoverOidcEndpoints } from './discovery.js'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('discoverOidcEndpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches endpoints from .well-known/openid-configuration', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/authorize',
        token_endpoint: 'https://idp.example.com/token',
        end_session_endpoint: 'https://idp.example.com/logout',
      }),
    })

    const endpoints = await discoverOidcEndpoints('https://idp.example.com')

    expect(mockFetch).toHaveBeenCalledWith('https://idp.example.com/.well-known/openid-configuration')
    expect(endpoints.authorizationUrl).toBe('https://idp.example.com/authorize')
    expect(endpoints.tokenUrl).toBe('https://idp.example.com/token')
    expect(endpoints.endSessionUrl).toBe('https://idp.example.com/logout')
  })

  it('strips trailing slash from issuer URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/authorize',
        token_endpoint: 'https://idp.example.com/token',
      }),
    })

    await discoverOidcEndpoints('https://idp.example.com/')

    expect(mockFetch).toHaveBeenCalledWith('https://idp.example.com/.well-known/openid-configuration')
  })

  it('handles missing end_session_endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/authorize',
        token_endpoint: 'https://idp.example.com/token',
      }),
    })

    const endpoints = await discoverOidcEndpoints('https://idp.example.com')

    expect(endpoints.endSessionUrl).toBeUndefined()
  })

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

    await expect(discoverOidcEndpoints('https://bad.example.com')).rejects.toThrow('OIDC discovery failed: 404')
  })

  it('throws on missing required endpoints', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issuer: 'https://idp.example.com' }),
    })

    await expect(discoverOidcEndpoints('https://idp.example.com')).rejects.toThrow(
      'missing authorization_endpoint or token_endpoint',
    )
  })

  it('works with Hydra endpoint paths', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://oauth.example.com/oauth2/auth',
        token_endpoint: 'https://oauth.example.com/oauth2/token',
        end_session_endpoint: 'https://oauth.example.com/oauth2/sessions/logout',
      }),
    })

    const endpoints = await discoverOidcEndpoints('https://oauth.example.com')

    expect(endpoints.authorizationUrl).toBe('https://oauth.example.com/oauth2/auth')
    expect(endpoints.tokenUrl).toBe('https://oauth.example.com/oauth2/token')
    expect(endpoints.endSessionUrl).toBe('https://oauth.example.com/oauth2/sessions/logout')
  })

  it('works with Auth0 endpoint paths', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://myapp.auth0.com/authorize',
        token_endpoint: 'https://myapp.auth0.com/oauth/token',
        end_session_endpoint: 'https://myapp.auth0.com/v2/logout',
      }),
    })

    const endpoints = await discoverOidcEndpoints('https://myapp.auth0.com')

    expect(endpoints.authorizationUrl).toBe('https://myapp.auth0.com/authorize')
    expect(endpoints.tokenUrl).toBe('https://myapp.auth0.com/oauth/token')
    expect(endpoints.endSessionUrl).toBe('https://myapp.auth0.com/v2/logout')
  })
})
