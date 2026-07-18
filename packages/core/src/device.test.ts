import { describe, it, expect } from 'vitest'
import {
  DeviceGrantService,
  InMemoryDeviceGrantStore,
  opaqueTokenMinter,
  normalizeUserCode,
  type MintCredential,
} from './device.js'

const CLIENT = 'my-cli'
const SCOPE = 'read write'

function harness(opts: { mint?: MintCredential } = {}) {
  let now = 1_700_000_000_000
  const clock = {
    advanceSeconds(s: number) {
      now += s * 1000
    },
  }
  const service = new DeviceGrantService(new InMemoryDeviceGrantStore(), {
    verificationUri: 'https://example.com/device',
    userCodeTtlSeconds: 900,
    intervalSeconds: 5,
    now: () => now,
    mintCredential: opts.mint ?? opaqueTokenMinter(),
  })
  return { service, clock }
}

describe('DeviceGrantService', () => {
  it('authorize returns the RFC 8628 device authorization fields', async () => {
    const { service } = harness()
    const res = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    expect(res).toMatchObject({
      device_code: expect.any(String),
      user_code: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
      verification_uri: 'https://example.com/device',
      verification_uri_complete: expect.stringContaining('user_code='),
      expires_in: 900,
      interval: 5,
    })
  })

  it('polling before approval is pending', async () => {
    const { service } = harness()
    const { device_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    expect(await service.poll({ deviceCode: device_code, clientId: CLIENT })).toEqual({ type: 'pending' })
  })

  it('polling faster than the interval is slow_down', async () => {
    const { service } = harness()
    const { device_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    await service.poll({ deviceCode: device_code, clientId: CLIENT }) // accepted
    expect(await service.poll({ deviceCode: device_code, clientId: CLIENT })).toEqual({ type: 'slow_down' })
  })

  it('approval then poll mints a credential', async () => {
    const { service } = harness()
    const { device_code, user_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    expect(await service.approve(user_code, 'user-1')).toBe('ok')
    const res = await service.poll({ deviceCode: device_code, clientId: CLIENT })
    expect(res.type).toBe('success')
    if (res.type === 'success') {
      expect(res.credential.token_type).toBe('Bearer')
      expect(res.credential.scope).toBe(SCOPE)
      expect(res.credential.access_token).toBeTruthy()
    }
  })

  it('the device_code is one-time use', async () => {
    const { service, clock } = harness()
    const { device_code, user_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    await service.approve(user_code, 'user-1')
    expect((await service.poll({ deviceCode: device_code, clientId: CLIENT })).type).toBe('success')
    clock.advanceSeconds(6) // clear the slow_down window
    expect(await service.poll({ deviceCode: device_code, clientId: CLIENT })).toEqual({ type: 'invalid_grant' })
  })

  it('matches the user_code case- and separator-insensitively', async () => {
    const { service } = harness()
    const { device_code, user_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    expect(await service.approve(user_code.toLowerCase().replace('-', ''), 'user-1')).toBe('ok')
    expect((await service.poll({ deviceCode: device_code, clientId: CLIENT })).type).toBe('success')
  })

  it('expires a grant after its TTL', async () => {
    const { service, clock } = harness()
    const { device_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    clock.advanceSeconds(901)
    expect(await service.poll({ deviceCode: device_code, clientId: CLIENT })).toEqual({ type: 'expired' })
  })

  it('reports denial to the poller', async () => {
    const { service } = harness()
    const { device_code, user_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    expect(await service.deny(user_code)).toBe('ok')
    expect(await service.poll({ deviceCode: device_code, clientId: CLIENT })).toEqual({ type: 'denied' })
  })

  it('rejects unknown device codes and client mismatches', async () => {
    const { service } = harness()
    const { device_code } = await service.authorize({ clientId: CLIENT, scope: SCOPE })
    expect(await service.poll({ deviceCode: 'nope', clientId: CLIENT })).toEqual({ type: 'invalid_grant' })
    expect(await service.poll({ deviceCode: device_code, clientId: 'other' })).toEqual({ type: 'invalid_grant' })
  })

  it('approve/deny report not_found for unknown user codes', async () => {
    const { service } = harness()
    expect(await service.approve('ZZZZ-ZZZZ', 'user-1')).toBe('not_found')
    expect(await service.deny('ZZZZ-ZZZZ')).toBe('not_found')
  })
})

describe('normalizeUserCode', () => {
  it('uppercases and strips separators', () => {
    expect(normalizeUserCode('wdjb-mjht')).toBe('WDJBMJHT')
    expect(normalizeUserCode('WDJB MJHT')).toBe('WDJBMJHT')
  })
})

describe('opaqueTokenMinter', () => {
  it('honors prefix and expiry options', async () => {
    const mint = opaqueTokenMinter({ prefix: 'tok_', expiresIn: 120 })
    const cred = await mint({
      deviceCode: 'd',
      userCode: 'u',
      clientId: CLIENT,
      scope: SCOPE,
      status: 'approved',
      createdAt: 0,
      expiresAt: 0,
      interval: 5,
    })
    expect(cred.access_token.startsWith('tok_')).toBe(true)
    expect(cred.expires_in).toBe(120)
  })
})
