import type { Context, Next } from 'hono'
import { getCookie, deleteCookie } from 'hono/cookie'
import { resolveCrypto } from 'fz-auth-core'
import { DEFAULT_SESSION_COOKIE, type BffSession, type BffSessionMiddlewareOptions } from 'fz-auth-core'

declare module 'hono' {
  interface ContextVariableMap {
    accessToken: string
  }
}

/**
 * Hono middleware that reads the BFF session cookie and sets `accessToken` on context.
 */
export function bffSessionMiddleware(options: BffSessionMiddlewareOptions) {
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
