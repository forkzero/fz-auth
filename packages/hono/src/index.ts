export { createBffRoutes } from './routes.js'
export { bffSessionMiddleware } from './middleware.js'
export { requiresAuth } from './guard.js'
export type { RequiresAuthOptions } from './guard.js'

// Re-export everything from core
export * from 'fz-auth-core'
