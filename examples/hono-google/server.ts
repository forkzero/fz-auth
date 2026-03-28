import { Hono } from 'hono'
import { createBffRoutes, requiresAuth } from 'fz-auth'

const app = new Hono()

// Mount BFF auth routes: /auth/login, /auth/callback, /auth/session, /auth/refresh, /auth/logout
app.route('/auth', await createBffRoutes({
  issuerUrl: process.env.ISSUER_URL!,         // e.g. https://accounts.google.com
  clientId: process.env.CLIENT_ID!,            // Google OAuth client ID
  encryptionKey: process.env.SESSION_SECRET!,  // openssl rand -hex 32
}))

// Protected route — only accessible with a valid session
app.get('/api/me', requiresAuth({ encryptionKey: process.env.SESSION_SECRET! }), (c) => {
  // Access token is available server-side for calling upstream APIs
  // Never return it to the browser — that defeats the BFF pattern
  return c.json({ message: 'Authenticated!' })
})

// Public route
app.get('/', (c) => c.html('<a href="/auth/login">Sign in with Google</a>'))

export default app
