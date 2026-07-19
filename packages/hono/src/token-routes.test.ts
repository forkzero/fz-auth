import { describe, it, expect, beforeAll } from 'vitest'
import { createLocalSigner, createTokenMinter, type TokenMinter } from 'fz-auth-core'
import { createTokenRoutes } from './token-routes.js'

let minter: TokenMinter

beforeAll(async () => {
  const signer = await createLocalSigner({ kid: 'k1' })
  minter = await createTokenMinter({ signer, issuer: 'https://id.example.com', audience: 'api' })
})

function resolvePrincipal(key: string) {
  return Promise.resolve(key === 'good-key' ? { subject: 'key_1', claims: { org_id: 'org_1', tier: 'pro' } } : null)
}
function app() {
  return createTokenRoutes(minter, { resolvePrincipal })
}
function form(fields: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }
}

describe('token routes', () => {
  it('mints a token for a valid API key', async () => {
    const res = await app().request('/token', { method: 'POST', headers: { authorization: 'Bearer good-key' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { access_token: string; token_type: string; expires_in: number }
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(600)
    const claims = await minter.verify(body.access_token)
    expect(claims).toMatchObject({ sub: 'key_1', org_id: 'org_1', tier: 'pro' })
  })

  it('accepts the API key as a form field too', async () => {
    const res = await app().request('/token', form({ api_key: 'good-key' }))
    expect(res.status).toBe(200)
  })

  it('rejects an invalid API key with 401', async () => {
    const res = await app().request('/token', { method: 'POST', headers: { authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client')
  })

  it('returns 400 when no API key is presented', async () => {
    const res = await app().request('/token', { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('serves the JWKS', async () => {
    const res = await app().request('/.well-known/jwks.json')
    expect(res.status).toBe(200)
    const jwks = (await res.json()) as { keys: { kid?: string }[] }
    expect(jwks.keys[0].kid).toBe('k1')
  })

  it('introspects a minted token with claims parity', async () => {
    const { access_token } = await minter.mint({ subject: 'key_1', claims: { org_id: 'org_1' } })
    const res = await app().request('/introspect', form({ token: access_token }))
    const body = (await res.json()) as { active: boolean; sub?: string; org_id?: string }
    expect(body).toMatchObject({ active: true, sub: 'key_1', org_id: 'org_1' })
  })

  it('reports inactive for a bad token', async () => {
    const res = await app().request('/introspect', form({ token: 'garbage' }))
    expect(((await res.json()) as { active: boolean }).active).toBe(false)
  })

  it('supports a custom introspect backend for opaque tokens', async () => {
    const custom = createTokenRoutes(minter, {
      resolvePrincipal,
      introspect: async (t) => (t === 'opaque-1' ? { active: true, sub: 'key_9' } : { active: false }),
    })
    const res = await custom.request('/introspect', form({ token: 'opaque-1' }))
    expect((await res.json()) as { active: boolean; sub?: string }).toMatchObject({ active: true, sub: 'key_9' })
  })
})
