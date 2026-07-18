import { Hono, type Context } from 'hono'
import type { DeviceGrantService } from 'fz-auth-core'

/**
 * Hono adapter for the RFC 8628 device grant. Maps a `DeviceGrantService` to the
 * standard wire format: form-encoded requests, snake_case JSON responses, and the
 * standard OAuth error codes (`authorization_pending`, `slow_down`, `expired_token`,
 * `access_denied`, `invalid_grant`).
 *
 * The public device endpoints are always mounted:
 *   - `POST /authorize` — the device starts the flow
 *   - `POST /token`     — the device polls for a credential
 *
 * The human approval endpoints are session-agnostic: they are mounted only when you
 * provide `resolveUser`, which returns the authenticated user id for a request (e.g.
 * from a `fz-auth` session via `requiresAuth`). This adapter makes no assumption about
 * how the user authenticated.
 *   - `POST /approve` — bind the pending grant to the resolved user
 *   - `POST /deny`    — decline the pending grant
 */
export interface DeviceRoutesOptions {
  /** Resolve the authenticated user id for a request, or null if unauthenticated. */
  resolveUser?: (c: Context) => Promise<string | null> | string | null
}

const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

export function createDeviceRoutes(service: DeviceGrantService, options: DeviceRoutesOptions = {}): Hono {
  const app = new Hono()

  // POST /authorize — public client starts the flow (RFC 8628 §3.1)
  app.post('/authorize', async (c) => {
    const form = await c.req.parseBody()
    const clientId = typeof form.client_id === 'string' ? form.client_id : ''
    const scope = typeof form.scope === 'string' ? form.scope : ''
    if (!clientId) {
      return c.json({ error: 'invalid_request', error_description: 'client_id is required' }, 400)
    }
    return c.json(await service.authorize({ clientId, scope }), 200)
  })

  // POST /token — the device polls here (RFC 8628 §3.4)
  app.post('/token', async (c) => {
    const form = await c.req.parseBody()
    const grantType = typeof form.grant_type === 'string' ? form.grant_type : ''
    const clientId = typeof form.client_id === 'string' ? form.client_id : ''
    const deviceCode = typeof form.device_code === 'string' ? form.device_code : ''
    if (grantType !== DEVICE_CODE_GRANT_TYPE) {
      return c.json({ error: 'unsupported_grant_type' }, 400)
    }
    const r = await service.poll({ deviceCode, clientId })
    switch (r.type) {
      case 'success':
        return c.json(r.credential, 200)
      case 'pending':
        return c.json({ error: 'authorization_pending' }, 400)
      case 'slow_down':
        return c.json({ error: 'slow_down' }, 400)
      case 'expired':
        return c.json({ error: 'expired_token' }, 400)
      case 'denied':
        return c.json({ error: 'access_denied' }, 400)
      case 'invalid_grant':
        return c.json({ error: 'invalid_grant' }, 400)
    }
  })

  const { resolveUser } = options
  if (resolveUser) {
    app.post('/approve', async (c) => {
      const userId = await resolveUser(c)
      if (!userId) return c.json({ error: 'login_required' }, 401)
      const form = await c.req.parseBody()
      const userCode = typeof form.user_code === 'string' ? form.user_code : ''
      const outcome = await service.approve(userCode, userId)
      if (outcome === 'not_found') return c.json({ error: 'invalid_user_code' }, 404)
      if (outcome === 'expired') return c.json({ error: 'expired_token' }, 410)
      return c.json({ status: 'approved' }, 200)
    })

    app.post('/deny', async (c) => {
      const userId = await resolveUser(c)
      if (!userId) return c.json({ error: 'login_required' }, 401)
      const form = await c.req.parseBody()
      const userCode = typeof form.user_code === 'string' ? form.user_code : ''
      const outcome = await service.deny(userCode)
      if (outcome === 'not_found') return c.json({ error: 'invalid_user_code' }, 404)
      if (outcome === 'expired') return c.json({ error: 'expired_token' }, 410)
      return c.json({ status: 'denied' }, 200)
    })
  }

  return app
}
