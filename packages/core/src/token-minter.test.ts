import { describe, it, expect } from 'vitest'
import { jwtVerify, createLocalJWKSet } from 'jose'
import { createLocalSigner, createTokenMinter, type TokenMinterOptions } from './token-minter.js'

async function makeMinter(overrides: Partial<TokenMinterOptions> = {}) {
  const signer = await createLocalSigner({ kid: 'k1' })
  return createTokenMinter({ signer, issuer: 'https://id.example.com', audience: 'api', ...overrides })
}

describe('token minter', () => {
  it('mints a JWT carrying the caller claims plus registered claims', async () => {
    const minter = await makeMinter()
    const { access_token, token_type, expires_in } = await minter.mint({
      subject: 'key_123',
      claims: { org_id: 'org_1', tier: 'pro', entitlements: [{ prefix: 'a/', actions: ['read'] }] },
    })
    expect(token_type).toBe('Bearer')
    expect(expires_in).toBe(600)
    const claims = await minter.verify(access_token)
    expect(claims).toMatchObject({ iss: 'https://id.example.com', aud: 'api', sub: 'key_123', org_id: 'org_1', tier: 'pro' })
    expect(claims.entitlements).toEqual([{ prefix: 'a/', actions: ['read'] }])
  })

  it('minted tokens verify against the published JWKS (local hot-path verification)', async () => {
    const minter = await makeMinter()
    const { access_token } = await minter.mint({ subject: 'key_1' })
    const jwks = createLocalJWKSet(minter.jwks())
    const { payload } = await jwtVerify(access_token, jwks, { issuer: 'https://id.example.com', audience: 'api' })
    expect(payload.sub).toBe('key_1')
  })

  it('honors a per-token TTL override', async () => {
    const minter = await makeMinter()
    const { access_token, expires_in } = await minter.mint({ subject: 's', ttlSeconds: 60 })
    expect(expires_in).toBe(60)
    const { exp, iat } = await minter.verify(access_token)
    expect(exp! - iat!).toBe(60)
  })

  it('registered claims cannot be spoofed by caller claims', async () => {
    const minter = await makeMinter()
    const { access_token } = await minter.mint({ subject: 'real', claims: { sub: 'attacker', iss: 'evil' } })
    const claims = await minter.verify(access_token)
    expect(claims.sub).toBe('real')
    expect(claims.iss).toBe('https://id.example.com')
  })

  it('rejects a token signed by a foreign key', async () => {
    const minter = await makeMinter()
    const other = await makeMinter()
    const { access_token } = await other.mint({ subject: 's' })
    await expect(minter.verify(access_token)).rejects.toThrow()
  })

  it('keeps retired keys in the JWKS for rotation', async () => {
    const retired = await createLocalSigner({ kid: 'old' })
    const active = await createLocalSigner({ kid: 'new' })
    const minter = await createTokenMinter({
      signer: active,
      retiredSigners: [retired],
      issuer: 'https://id.example.com',
      audience: 'api',
    })
    expect(minter.jwks().keys.map((k) => k.kid)).toEqual(['new', 'old'])
  })
})
