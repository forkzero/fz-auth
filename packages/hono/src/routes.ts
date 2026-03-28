import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import {
  createBffCore,
  resolveCrypto,
  DEFAULT_SESSION_COOKIE,
  DEFAULT_PKCE_COOKIE,
  SECURE_COOKIE_OPTIONS,
  type BffRoutesOptions,
} from 'fz-auth-core'

function deriveRedirectUri(requestUrl: string): string {
  const url = new URL(requestUrl)
  return `${url.origin}/auth/callback`
}

export async function createBffRoutes(options: BffRoutesOptions) {
  const {
    postLoginRedirect = '/',
    postLogoutRedirect = '/',
    cookieName = DEFAULT_SESSION_COOKIE,
    cookieMaxAge = 86400,
    rollingDuration,
  } = options

  const crypto = resolveCrypto(options)
  const core = await createBffCore(options, crypto)

  const app = new Hono()

  app.get('/login', async (c) => {
    const redirectUri = options.redirectUri ?? deriveRedirectUri(c.req.url)
    const { cookieValue, redirectUrl } = await core.startLogin(redirectUri)
    setCookie(c, DEFAULT_PKCE_COOKIE, cookieValue, { ...SECURE_COOKIE_OPTIONS, maxAge: 300 })
    return c.redirect(redirectUrl)
  })

  app.get('/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    if (!code || !state) return c.text('Missing code or state', 400)

    const pkceCookie = getCookie(c, DEFAULT_PKCE_COOKIE)
    if (!pkceCookie) return c.text('Missing PKCE cookie — try logging in again', 400)
    deleteCookie(c, DEFAULT_PKCE_COOKIE, { path: '/', secure: true })

    const redirectUri = options.redirectUri ?? deriveRedirectUri(c.req.url)
    const result = await core.handleCallback(code, state, pkceCookie, redirectUri)
    if (!result.ok) return c.text(result.error, 502)

    setCookie(c, cookieName, result.sessionValue, { ...SECURE_COOKIE_OPTIONS, maxAge: cookieMaxAge })
    return c.redirect(postLoginRedirect)
  })

  app.get('/session', async (c) => {
    const raw = getCookie(c, cookieName)
    if (!raw) return c.json({ authenticated: false }, 401)

    const session = await core.getSession(raw)
    if (!session) {
      deleteCookie(c, cookieName, { path: '/', secure: true })
      return c.json({ authenticated: false }, 401)
    }

    if (rollingDuration) {
      setCookie(c, cookieName, raw, { ...SECURE_COOKIE_OPTIONS, maxAge: rollingDuration })
    }

    return c.json({ authenticated: true, accessToken: session.accessToken, expiresAt: session.expiresAt })
  })

  app.post('/refresh', async (c) => {
    const raw = getCookie(c, cookieName)
    if (!raw) return c.json({ error: 'No session' }, 401)

    const result = await core.refreshSession(raw)
    if (!result.ok) {
      deleteCookie(c, cookieName, { path: '/', secure: true })
      return c.json({ error: result.error }, 401)
    }

    setCookie(c, cookieName, result.sessionValue, {
      ...SECURE_COOKIE_OPTIONS,
      maxAge: rollingDuration ?? cookieMaxAge,
    })

    return c.json({ ok: true })
  })

  app.get('/logout', async (c) => {
    const raw = getCookie(c, cookieName)
    if (raw) deleteCookie(c, cookieName, { path: '/', secure: true })

    const logoutRedirect = await core.getLogoutUrl(raw, postLogoutRedirect)
    return c.redirect(logoutRedirect ?? postLogoutRedirect)
  })

  return app
}
