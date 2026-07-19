// Hono adapter for the machine-client token minter (fz-auth#5):
//   POST /token                     API key -> short-TTL JWT
//   GET  /.well-known/jwks.json     public keys for local verification
//   POST /introspect                token -> claims (RFC 7662-ish); pluggable for opaque tokens
//
// The consumer supplies `resolvePrincipal` (verify the API key, return its subject + claims).
// Nothing about the key format or store is assumed here.

import { Hono, type Context } from 'hono'
import type { MintInput, TokenMinter } from 'fz-auth-core'

/** What `resolvePrincipal` returns for a valid API key — the shape the minter mints. */
export type Principal = MintInput

export interface IntrospectionResult {
  active: boolean
  [claim: string]: unknown
}

export interface TokenRoutesOptions {
  /** Verify a presented API key; return the principal to mint for, or null if invalid. */
  resolvePrincipal(apiKey: string): Promise<Principal | null>
  /**
   * Introspection backend. Defaults to verifying a minted JWT (so the introspection response
   * carries the same claims the JWT does). Override to introspect opaque tokens from a store.
   */
  introspect?(token: string): Promise<IntrospectionResult>
}

function bearer(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null
  return match ? match[1] : null
}

async function formField(c: Context, name: string): Promise<string> {
  try {
    const body = await c.req.parseBody()
    return typeof body[name] === 'string' ? body[name] : ''
  } catch {
    return ''
  }
}

export function createTokenRoutes(minter: TokenMinter, opts: TokenRoutesOptions): Hono {
  const introspect =
    opts.introspect ??
    (async (token: string): Promise<IntrospectionResult> => {
      try {
        return { active: true, ...(await minter.verify(token)) }
      } catch {
        return { active: false }
      }
    })
  const app = new Hono()

  app.post('/token', async (c) => {
    const apiKey = bearer(c.req.header('authorization')) || (await formField(c, 'api_key'))
    if (!apiKey) return c.json({ error: 'invalid_request', error_description: 'missing API key' }, 400)
    const principal = await opts.resolvePrincipal(apiKey)
    if (!principal) return c.json({ error: 'invalid_client' }, 401)
    return c.json(await minter.mint(principal))
  })

  app.get('/.well-known/jwks.json', (c) => c.json(minter.jwks()))

  app.post('/introspect', async (c) => {
    return c.json(await introspect(await formField(c, 'token')))
  })

  return app
}
