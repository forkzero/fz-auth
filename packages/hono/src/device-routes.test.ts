import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { DeviceGrantService, InMemoryDeviceGrantStore, opaqueTokenMinter } from 'fz-auth-core'
import { createDeviceRoutes, type DeviceRoutesOptions } from './device-routes.js'

const CLIENT = 'my-cli'

function makeApp(options: DeviceRoutesOptions = {}) {
  const service = new DeviceGrantService(new InMemoryDeviceGrantStore(), {
    verificationUri: 'https://example.com/device',
    intervalSeconds: 0, // no slow_down in these tests
    mintCredential: opaqueTokenMinter(),
  })
  const app = new Hono()
  app.route('/device', createDeviceRoutes(service, options))
  return app
}

function post(app: Hono, path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  })
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function tokenGrant() {
  return { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: CLIENT }
}

describe('createDeviceRoutes (RFC 8628 wire format)', () => {
  it('POST /authorize returns snake_case device authorization fields', async () => {
    const app = makeApp()
    const res = await post(app, '/device/authorize', { client_id: CLIENT, scope: 'read' })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({
      device_code: expect.any(String),
      user_code: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
      verification_uri: expect.any(String),
      expires_in: expect.any(Number),
      interval: expect.any(Number),
    })
  })

  it('POST /authorize without client_id is invalid_request', async () => {
    const app = makeApp()
    const res = await post(app, '/device/authorize', { scope: 'read' })
    expect(res.status).toBe(400)
    expect((await json(res)).error).toBe('invalid_request')
  })

  it('POST /token before approval is authorization_pending', async () => {
    const app = makeApp()
    const { device_code } = await json<{ device_code: string }>(
      await post(app, '/device/authorize', { client_id: CLIENT, scope: 'read' }),
    )
    const res = await post(app, '/device/token', { ...tokenGrant(), device_code })
    expect(res.status).toBe(400)
    expect((await json(res)).error).toBe('authorization_pending')
  })

  it('POST /token with an unsupported grant_type is rejected', async () => {
    const app = makeApp()
    const res = await post(app, '/device/token', { grant_type: 'password', client_id: CLIENT, device_code: 'x' })
    expect(res.status).toBe(400)
    expect((await json(res)).error).toBe('unsupported_grant_type')
  })

  it('approval (via resolveUser) lets the device obtain a token', async () => {
    const app = makeApp({ resolveUser: (c) => c.req.header('x-test-user') ?? null })
    const authz = await json<{ device_code: string; user_code: string }>(
      await post(app, '/device/authorize', { client_id: CLIENT, scope: 'read' }),
    )
    const approve = await post(app, '/device/approve', { user_code: authz.user_code }, { 'x-test-user': 'user-7' })
    expect(approve.status).toBe(200)
    expect((await json(approve)).status).toBe('approved')

    const token = await post(app, '/device/token', { ...tokenGrant(), device_code: authz.device_code })
    expect(token.status).toBe(200)
    expect((await json(token)).token_type).toBe('Bearer')
  })

  it('POST /approve without a resolved user is login_required', async () => {
    const app = makeApp({ resolveUser: () => null })
    const res = await post(app, '/device/approve', { user_code: 'WDJB-MJHT' })
    expect(res.status).toBe(401)
    expect((await json(res)).error).toBe('login_required')
  })

  it('approval endpoints are absent unless resolveUser is provided', async () => {
    const app = makeApp() // no resolveUser
    const res = await post(app, '/device/approve', { user_code: 'WDJB-MJHT' })
    expect(res.status).toBe(404)
  })
})
