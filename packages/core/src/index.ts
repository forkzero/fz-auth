export { createBffCore, resolveCrypto } from './core.js'
export type { BffCore, BffCoreOptions } from './core.js'
export { discoverOidcEndpoints } from './discovery.js'
export type { OidcEndpoints } from './discovery.js'
export { encrypt, decrypt, createAesCrypto } from './session.js'
export type {
  SessionCrypto,
  BffRoutesOptions,
  BffSession,
  AuthIdentity,
  BffSessionMiddlewareOptions,
  PkceState,
  OAuthTokenResponse,
} from './types.js'
export { DEFAULT_SESSION_COOKIE, DEFAULT_PKCE_COOKIE, SECURE_COOKIE_OPTIONS } from './types.js'

// Device Authorization Grant (RFC 8628)
export {
  DeviceGrantService,
  InMemoryDeviceGrantStore,
  normalizeUserCode,
  opaqueTokenMinter,
} from './device.js'
export type {
  DeviceGrant,
  DeviceGrantStatus,
  DeviceGrantStore,
  DeviceGrantConfig,
  DeviceAuthResponse,
  PollResult,
  GrantActionOutcome,
  MintedCredential,
  MintCredential,
  OpaqueTokenMinterOptions,
} from './device.js'
