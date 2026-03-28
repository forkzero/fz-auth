import type { Context, Next } from 'hono'
import { getCookie, deleteCookie } from 'hono/cookie'
import { resolveCrypto } from 'fz-auth-core'
import { DEFAULT_SESSION_COOKIE, type SessionCrypto, type BffSession } from 'fz-auth-core'

export interface RequiresAuthOptions {
  /** AES-256 key for decrypting session cookies. Ignored if `crypto` is provided. */
  encryptionKey?: string
  /** Pluggable crypto backend. */
  crypto?: SessionCrypto
  /** Cookie name (default: __Host-fz_session) */
  cookieName?: string
}

/**
 * Auth guard — returns 401 if no valid session, sets `accessToken` on context.
 */
export function requiresAuth(options: RequiresAuthOptions) {
  const { cookieName = DEFAULT_SESSION_COOKIE } = options
  const crypto = resolveCrypto(options)

  return async (c: Context, next: Next) => {
    const raw = getCookie(c, cookieName)
    if (!raw) return c.json({ error: 'Not authenticated' }, 401)

    const session = (await crypto.decrypt(raw)) as BffSession | null
    if (!session || Date.now() >= session.expiresAt) {
      deleteCookie(c, cookieName, { path: '/', secure: true })
      return c.json({ error: 'Session expired' }, 401)
    }

    c.set('accessToken', session.accessToken)
    await next()
  }
}
