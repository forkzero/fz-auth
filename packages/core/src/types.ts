export const DEFAULT_SESSION_COOKIE = '__Host-fz_session'
export const DEFAULT_PKCE_COOKIE = '__Host-fz_pkce'

export const SECURE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  path: '/',
}

/** Pluggable encryption interface for BFF session cookies. */
export interface SessionCrypto {
  encrypt(data: unknown): Promise<string>
  decrypt(encoded: string): Promise<unknown | null>
}

export interface BffRoutesOptions {
  /** OIDC issuer URL — endpoints are discovered automatically via .well-known/openid-configuration */
  issuerUrl: string
  /** OAuth2 client ID */
  clientId: string
  /** Redirect URI for the callback. If omitted, derived from the first request as {origin}/auth/callback */
  redirectUri?: string
  /** AES-256 key for encrypting session cookies (32-byte hex or base64 string). Ignored if `crypto` is provided. */
  encryptionKey?: string
  /** Pluggable crypto backend. When omitted, uses built-in AES-256-GCM with encryptionKey. */
  crypto?: SessionCrypto
  /** Where to redirect after successful login (default: /) */
  postLoginRedirect?: string
  /** Where to redirect after logout (default: /) */
  postLogoutRedirect?: string
  /** OAuth2 scopes (default: openid email profile) */
  scopes?: string[]
  /** OAuth2 audience */
  audience?: string
  /** Cookie name (default: __Host-fz_session) */
  cookieName?: string
  /** Cookie max age in seconds (default: 86400 = 24h) */
  cookieMaxAge?: number
  /** Rolling session duration in seconds. When set, session expiry resets on each authenticated request. */
  rollingDuration?: number
}

/**
 * Verified identity claims projected from the OIDC id_token — the authentication assertion
 * (who signed in), stable for the session. This is deliberately NOT a mutable user profile:
 * an editable display name / avatar is a separate, app-owned concern the app fetches itself.
 */
export interface AuthIdentity {
  /** OIDC subject — the stable, unique user identifier (id_token `sub`). */
  sub: string
  email?: string
  emailVerified?: boolean
  name?: string
}

export interface BffSession {
  /** OAuth2 access token */
  accessToken: string
  /** OAuth2 refresh token (if granted) */
  refreshToken?: string
  /** Token expiry timestamp (ms since epoch) */
  expiresAt: number
  /** ID token (for logout hint) */
  idToken?: string
  /** Verified identity claims projected from the id_token at callback (see {@link AuthIdentity}). */
  identity?: AuthIdentity
}

export interface PkceState {
  verifier: string
  state: string
}

export interface OAuthTokenResponse {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
}

export interface BffSessionMiddlewareOptions {
  /** AES-256 key for decrypting session cookies. Ignored if `crypto` is provided. */
  encryptionKey?: string
  /** Pluggable crypto backend. When omitted, uses built-in AES-256-GCM with encryptionKey. */
  crypto?: SessionCrypto
  /** Cookie name (default: __Host-fz_session) */
  cookieName?: string
}
