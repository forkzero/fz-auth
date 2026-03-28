import { Hono } from 'hono'
import { createBffRoutes, requiresAuth } from 'fz-auth'

const app = new Hono()

// Mount BFF auth routes: /auth/login, /auth/callback, /auth/session, /auth/refresh, /auth/logout
app.route('/auth', await createBffRoutes({
  issuerUrl: process.env.ISSUER_URL!,         // e.g. https://accounts.google.com
  clientId: process.env.CLIENT_ID!,            // Google OAuth client ID
  authApiUrl: process.env.AUTH_API_URL!,       // Your API for profile enrichment
  encryptionKey: process.env.SESSION_SECRET!,  // openssl rand -hex 32
}))

// Protected route — only accessible with a valid session
app.get('/api/me', requiresAuth({ encryptionKey: process.env.SESSION_SECRET! }), (c) => {
  return c.json({ message: 'Authenticated!', token: c.get('accessToken') })
})

// Public route
app.get('/', (c) => c.html('<a href="/auth/login">Sign in with Google</a>'))

export default app
