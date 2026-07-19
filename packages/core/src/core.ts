import { randomBytes, createHash } from 'node:crypto'
import { discoverOidcEndpoints, type OidcEndpoints } from './discovery.js'
import type { SessionCrypto, BffSession, PkceState, OAuthTokenResponse, AuthIdentity } from './types.js'
import { createAesCrypto } from './session.js'

export interface BffCoreOptions {
  issuerUrl: string
  clientId: string
  /** If omitted, must be passed to startLogin() per-request */
  redirectUri?: string
  scopes?: string[]
  audience?: string
}

export interface BffCore {
  endpoints: OidcEndpoints
  /** Generate PKCE verifier + challenge + state, encrypt into a cookie value. Pass redirectUri if not set in options. */
  startLogin(redirectUri?: string): Promise<{ cookieValue: string; redirectUrl: string }>
  /** Validate callback params, exchange code for tokens, return encrypted session. Pass redirectUri if not set in options. */
  handleCallback(code: string, state: string, pkceCookieValue: string, redirectUri?: string): Promise<
    | { ok: true; sessionValue: string; session: BffSession }
    | { ok: false; error: string }
  >
  /** Decrypt and validate a session cookie */
  getSession(cookieValue: string): Promise<BffSession | null>
  /** Refresh tokens using a stored refresh token, return new encrypted session */
  refreshSession(cookieValue: string): Promise<
    | { ok: true; sessionValue: string; session: BffSession }
    | { ok: false; error: string }
  >
  /** Build the logout redirect URL (or null if IdP has no end_session_endpoint) */
  getLogoutUrl(cookieValue: string | undefined, postLogoutRedirect: string): Promise<string | null>
}

export function resolveCrypto(options: { crypto?: SessionCrypto; encryptionKey?: string }): SessionCrypto {
  if (options.crypto) return options.crypto
  if (options.encryptionKey) return createAesCrypto(options.encryptionKey)
  throw new Error('Either crypto or encryptionKey must be provided')
}

/** Validate that a redirect URL is relative (starts with /) and not a protocol-relative URL (//) */
function validateRedirect(url: string): string {
  if (url.startsWith('/') && !url.startsWith('//')) return url
  throw new Error(`Unsafe redirect URL: ${url}. Must be a relative path starting with /`)
}

function generateCodeVerifier(length = 128): string {
  return randomBytes(Math.ceil((length * 3) / 4)).toString('base64url').slice(0, length)
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function sessionFromTokens(tokens: OAuthTokenResponse): BffSession {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  }
}

interface IdTokenClaims {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  iss?: string
  aud?: string | string[]
  exp?: number
}

/** Decode a JWT payload without verifying its signature (see {@link validateAndProjectIdToken}). */
function decodeJwtPayload(jwt: string): IdTokenClaims | null {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as IdTokenClaims
  } catch {
    return null
  }
}

/**
 * Validate the id_token's claims (iss, aud, exp) and project a minimal, deliberate identity
 * subset. The id_token is received directly from the token endpoint over a TLS-protected
 * channel during the code exchange, so per OIDC Core §3.1.3.7 signature validation is
 * OPTIONAL here — we validate claims and rely on TLS. (Adding JWKS signature verification is
 * a deliberate future step; it would introduce a JWKS fetch + a crypto dependency in core.)
 */
function validateAndProjectIdToken(
  idToken: string,
  issuerUrl: string,
  clientId: string,
  nowMs: number,
): { ok: true; identity: AuthIdentity } | { ok: false; error: string } {
  const claims = decodeJwtPayload(idToken)
  if (!claims) return { ok: false, error: 'malformed id_token' }
  if (!claims.sub) return { ok: false, error: 'id_token missing sub' }
  const strip = (u?: string) => (u ?? '').replace(/\/+$/, '')
  if (strip(claims.iss) !== strip(issuerUrl)) return { ok: false, error: 'id_token issuer mismatch' }
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (!aud.includes(clientId)) return { ok: false, error: 'id_token audience mismatch' }
  if (typeof claims.exp === 'number' && nowMs >= claims.exp * 1000) {
    return { ok: false, error: 'id_token expired' }
  }
  return {
    ok: true,
    identity: {
      sub: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified,
      name: claims.name,
    },
  }
}

/**
 * Create the framework-agnostic BFF core. Handles OIDC discovery, PKCE,
 * token exchange, session encryption, and refresh. No HTTP framework dependency.
 */
export async function createBffCore(
  options: BffCoreOptions,
  crypto: SessionCrypto,
): Promise<BffCore> {
  const { clientId, redirectUri: defaultRedirectUri, scopes = ['openid', 'email', 'profile'], audience } = options
  const endpoints = await discoverOidcEndpoints(options.issuerUrl)

  function resolveRedirectUri(override?: string): string {
    const uri = override ?? defaultRedirectUri
    if (!uri) throw new Error('redirectUri must be provided either in options or per-call')
    return uri
  }

  return {
    endpoints,

    async startLogin(redirectUriOverride?: string) {
      const uri = resolveRedirectUri(redirectUriOverride)
      const verifier = generateCodeVerifier()
      const challenge = generateCodeChallenge(verifier)
      const state = globalThis.crypto.randomUUID()

      const cookieValue = await crypto.encrypt({ verifier, state } satisfies PkceState)

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: uri,
        scope: scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      if (audience) params.set('audience', audience)

      return {
        cookieValue,
        redirectUrl: `${endpoints.authorizationUrl}?${params}`,
      }
    },

    async handleCallback(code, state, pkceCookieValue, redirectUriOverride?: string) {
      const uri = resolveRedirectUri(redirectUriOverride)
      const pkce = (await crypto.decrypt(pkceCookieValue)) as PkceState | null
      if (!pkce?.verifier || !pkce?.state) {
        return { ok: false, error: 'Invalid PKCE cookie' }
      }
      if (state !== pkce.state) {
        return { ok: false, error: 'OAuth state mismatch' }
      }

      const tokenRes = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          redirect_uri: uri,
          code_verifier: pkce.verifier,
        }),
      })

      if (!tokenRes.ok) {
        console.error(`BFF token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`)
        return { ok: false, error: 'Login failed — please try again' }
      }

      const tokens = (await tokenRes.json()) as OAuthTokenResponse
      const session = sessionFromTokens(tokens)

      // If the IdP returned an id_token, validate it and project the verified identity onto
      // the session. A present-but-invalid id_token fails the login.
      if (session.idToken) {
        const projected = validateAndProjectIdToken(session.idToken, options.issuerUrl, clientId, Date.now())
        if (!projected.ok) return { ok: false, error: `id_token validation failed: ${projected.error}` }
        session.identity = projected.identity
      }

      return {
        ok: true,
        sessionValue: await crypto.encrypt(session),
        session,
      }
    },

    async getSession(cookieValue) {
      const session = (await crypto.decrypt(cookieValue)) as BffSession | null
      if (!session || Date.now() >= session.expiresAt) return null
      return session
    },

    async refreshSession(cookieValue) {
      const session = (await crypto.decrypt(cookieValue)) as BffSession | null
      if (!session?.refreshToken) {
        return { ok: false, error: 'No refresh token' }
      }

      const tokenRes = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refreshToken,
          client_id: clientId,
        }),
      })

      if (!tokenRes.ok) {
        return { ok: false, error: 'Refresh failed' }
      }

      const tokens = (await tokenRes.json()) as OAuthTokenResponse
      const newSession: BffSession = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? session.refreshToken,
        idToken: tokens.id_token ?? session.idToken,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        identity: session.identity,
      }
      // Re-project identity if the refresh returned a fresh, valid id_token; otherwise keep
      // the prior identity.
      if (tokens.id_token) {
        const projected = validateAndProjectIdToken(tokens.id_token, options.issuerUrl, clientId, Date.now())
        if (projected.ok) newSession.identity = projected.identity
      }

      return {
        ok: true,
        sessionValue: await crypto.encrypt(newSession),
        session: newSession,
      }
    },

    async getLogoutUrl(cookieValue, postLogoutRedirect) {
      validateRedirect(postLogoutRedirect)
      if (!endpoints.endSessionUrl) return null

      let idToken: string | undefined
      if (cookieValue) {
        const session = (await crypto.decrypt(cookieValue)) as BffSession | null
        idToken = session?.idToken
      }

      const params = new URLSearchParams({ post_logout_redirect_uri: postLogoutRedirect })
      if (idToken) params.set('id_token_hint', idToken)
      return `${endpoints.endSessionUrl}?${params}`
    },
  }
}
