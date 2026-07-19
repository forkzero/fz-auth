export { createBffRoutes } from './routes.js'
export { requiresAuth } from './guard.js'
export type { RequiresAuthOptions } from './guard.js'
export { createDeviceRoutes } from './device-routes.js'
export type { DeviceRoutesOptions } from './device-routes.js'
export { createTokenRoutes } from './token-routes.js'
export type { TokenRoutesOptions, Principal, IntrospectionResult } from './token-routes.js'

// Re-export everything from core
export * from 'fz-auth-core'
