/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) — framework-agnostic core.
 *
 * A `DeviceGrantService` runs the device-flow state machine over a pluggable
 * `DeviceGrantStore` and a `MintCredential` callback, with no dependency on any HTTP
 * framework, datastore, or token format. See `createDeviceRoutes` in `fz-auth` for a
 * Hono adapter that exposes the RFC 8628 wire format.
 */

import { randomBytes } from 'node:crypto'

export type DeviceGrantStatus = 'pending' | 'approved' | 'denied' | 'redeemed'

export interface DeviceGrant {
  deviceCode: string
  userCode: string
  clientId: string
  scope: string
  status: DeviceGrantStatus
  userId?: string
  createdAt: number
  expiresAt: number
  /** timestamp of the last *accepted* poll (used to enforce `slow_down`) */
  lastPolledAt?: number
  interval: number
}

// ── Store port ────────────────────────────────────────────────────────────────────────

/**
 * Persistence port for device grants. Implement over your datastore (SQL, Redis, ...).
 * `InMemoryDeviceGrantStore` is provided for tests and single-process use.
 */
export interface DeviceGrantStore {
  create(grant: DeviceGrant): Promise<void>
  findByDeviceCode(deviceCode: string): Promise<DeviceGrant | undefined>
  findByUserCode(userCode: string): Promise<DeviceGrant | undefined>
  update(grant: DeviceGrant): Promise<void>
}

/** User codes are compared case-insensitively and ignoring separators (e.g. the dash). */
export function normalizeUserCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export class InMemoryDeviceGrantStore implements DeviceGrantStore {
  private byDevice = new Map<string, DeviceGrant>()
  private byUser = new Map<string, DeviceGrant>()

  async create(grant: DeviceGrant): Promise<void> {
    this.byDevice.set(grant.deviceCode, grant)
    this.byUser.set(normalizeUserCode(grant.userCode), grant)
  }
  async findByDeviceCode(deviceCode: string): Promise<DeviceGrant | undefined> {
    return this.byDevice.get(deviceCode)
  }
  async findByUserCode(userCode: string): Promise<DeviceGrant | undefined> {
    return this.byUser.get(normalizeUserCode(userCode))
  }
  async update(grant: DeviceGrant): Promise<void> {
    this.byDevice.set(grant.deviceCode, grant)
    this.byUser.set(normalizeUserCode(grant.userCode), grant)
  }
}

// ── Credential minting ──────────────────────────────────────────────────────────────

/** A minted token response (RFC 6749 §5.1 shape). */
export interface MintedCredential {
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
  refresh_token?: string
  id_token?: string
}

/**
 * Called once a grant is approved and first successfully polled. You decide the token
 * format — an opaque token validated by introspection, or a self-signed JWT verified
 * against a JWKS. `opaqueTokenMinter` is a batteries-included reference implementation.
 */
export type MintCredential = (grant: DeviceGrant) => Promise<MintedCredential> | MintedCredential

export interface OpaqueTokenMinterOptions {
  /** token lifetime in seconds (default: 3600) */
  expiresIn?: number
  /** entropy in bytes (default: 32) */
  tokenBytes?: number
  /** optional token prefix, e.g. a vendor tag */
  prefix?: string
}

/** Reference `MintCredential` that issues a random opaque bearer token. */
export function opaqueTokenMinter(options: OpaqueTokenMinterOptions = {}): MintCredential {
  const { expiresIn = 3600, tokenBytes = 32, prefix = '' } = options
  return (grant: DeviceGrant) => ({
    access_token: `${prefix}${randomBytes(tokenBytes).toString('base64url')}`,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: grant.scope,
  })
}

// ── Service (the RFC 8628 state machine) ──────────────────────────────────────────────

export interface DeviceGrantConfig {
  /** absolute URL where the user enters the user_code (your verification page) */
  verificationUri: string
  /** how long a grant is valid before it expires, in seconds (default: 900) */
  userCodeTtlSeconds?: number
  /** minimum client polling interval, in seconds (default: 5) */
  intervalSeconds?: number
  /** injectable clock so expiry / slow_down are testable without real sleeps */
  now?: () => number
  generateDeviceCode?: () => string
  generateUserCode?: () => string
  mintCredential: MintCredential
}

/** RFC 8628 §3.2 device authorization response (snake_case wire shape). */
export interface DeviceAuthResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export type PollResult =
  | { type: 'pending' }
  | { type: 'slow_down' }
  | { type: 'expired' }
  | { type: 'denied' }
  | { type: 'invalid_grant' }
  | { type: 'success'; credential: MintedCredential }

/** Outcome of an approve/deny action. */
export type GrantActionOutcome = 'ok' | 'not_found' | 'expired'

const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ' // no vowels / ambiguous chars

function defaultDeviceCode(): string {
  return randomBytes(32).toString('base64url')
}

function defaultUserCode(): string {
  const pick = () => USER_CODE_ALPHABET[randomBytes(1)[0] % USER_CODE_ALPHABET.length]
  const block = () => Array.from({ length: 4 }, pick).join('')
  return `${block()}-${block()}`
}

export class DeviceGrantService {
  private readonly ttl: number
  private readonly interval: number

  constructor(
    private readonly store: DeviceGrantStore,
    private readonly cfg: DeviceGrantConfig,
  ) {
    this.ttl = cfg.userCodeTtlSeconds ?? 900
    this.interval = cfg.intervalSeconds ?? 5
  }

  private now(): number {
    return (this.cfg.now ?? Date.now)()
  }

  private isExpired(g: DeviceGrant): boolean {
    return this.now() >= g.expiresAt
  }

  /** RFC 8628 §3.1–3.2 — start a grant. */
  async authorize({ clientId, scope }: { clientId: string; scope: string }): Promise<DeviceAuthResponse> {
    const now = this.now()
    const grant: DeviceGrant = {
      deviceCode: (this.cfg.generateDeviceCode ?? defaultDeviceCode)(),
      userCode: (this.cfg.generateUserCode ?? defaultUserCode)(),
      clientId,
      scope,
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.ttl * 1000,
      interval: this.interval,
    }
    await this.store.create(grant)
    return {
      device_code: grant.deviceCode,
      user_code: grant.userCode,
      verification_uri: this.cfg.verificationUri,
      verification_uri_complete: `${this.cfg.verificationUri}?user_code=${encodeURIComponent(grant.userCode)}`,
      expires_in: this.ttl,
      interval: this.interval,
    }
  }

  /** The user approved the grant on your verification page; bind it to their identity. */
  async approve(userCode: string, userId: string): Promise<GrantActionOutcome> {
    const g = await this.store.findByUserCode(userCode)
    if (!g) return 'not_found'
    if (this.isExpired(g)) return 'expired'
    if (g.status === 'pending') {
      g.status = 'approved'
      g.userId = userId
      await this.store.update(g)
    }
    return 'ok'
  }

  /** The user declined the grant. */
  async deny(userCode: string): Promise<GrantActionOutcome> {
    const g = await this.store.findByUserCode(userCode)
    if (!g) return 'not_found'
    if (this.isExpired(g)) return 'expired'
    if (g.status === 'pending') {
      g.status = 'denied'
      await this.store.update(g)
    }
    return 'ok'
  }

  /** RFC 8628 §3.4–3.5 — the device polls this. */
  async poll({ deviceCode, clientId }: { deviceCode: string; clientId: string }): Promise<PollResult> {
    const g = await this.store.findByDeviceCode(deviceCode)
    if (!g || g.clientId !== clientId) return { type: 'invalid_grant' }
    if (this.isExpired(g)) return { type: 'expired' }

    // Enforce the minimum polling interval; slow_down does NOT advance the window,
    // so a client that waits `interval` and retries will be accepted.
    const now = this.now()
    if (g.lastPolledAt !== undefined && now - g.lastPolledAt < g.interval * 1000) {
      return { type: 'slow_down' }
    }
    g.lastPolledAt = now
    await this.store.update(g)

    switch (g.status) {
      case 'denied':
        return { type: 'denied' }
      case 'pending':
        return { type: 'pending' }
      case 'redeemed':
        return { type: 'invalid_grant' } // device_code is one-time use
      case 'approved': {
        const credential = await this.cfg.mintCredential(g)
        g.status = 'redeemed'
        await this.store.update(g)
        return { type: 'success', credential }
      }
    }
  }
}
