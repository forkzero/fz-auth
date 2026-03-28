# Add BFF Auth to a Hono App

## Prerequisites

- An OIDC identity provider configured (see `02-provision-idp/`)
- `ISSUER_URL`, `CLIENT_ID`, and `SESSION_SECRET` in your `.env`

## Steps

### 1. Install

```bash
npm install fz-auth hono @hono/node-server
```

### 2. Mount BFF routes

```ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createBffRoutes, requiresAuth } from 'fz-auth'

const app = new Hono()

// Auth routes: /auth/login, /auth/callback, /auth/session, /auth/refresh, /auth/logout
app.route('/auth', await createBffRoutes({
  issuerUrl: process.env.ISSUER_URL!,
  clientId: process.env.CLIENT_ID!,
  encryptionKey: process.env.SESSION_SECRET!,
}))

// Protected API routes
app.use('/api/*', requiresAuth({ encryptionKey: process.env.SESSION_SECRET! }))

app.get('/api/me', (c) => {
  return c.json({ token: c.get('accessToken') })
})

// Public routes
app.get('/', (c) => c.html('<a href="/auth/login">Sign in</a>'))

serve({ fetch: app.fetch, port: 3000 })
console.log('Server running on http://localhost:3000')
```

### 3. Test

```bash
# Start the app
npm start

# Open browser — click "Sign in"
open http://localhost:3000

# After login, check the session
curl -s http://localhost:3000/auth/session -b cookies.txt | jq .

# Access a protected route
curl -s http://localhost:3000/api/me -b cookies.txt | jq .
```

## What each route does

| Route | Method | Purpose |
|-------|--------|---------|
| `/auth/login` | GET | Redirects to IdP with PKCE challenge |
| `/auth/callback` | GET | Exchanges code for tokens, sets encrypted session cookie |
| `/auth/session` | GET | Returns `{ authenticated: true/false }` |
| `/auth/refresh` | POST | Refreshes tokens using stored refresh token |
| `/auth/logout` | GET | Clears session, redirects to IdP logout |

## Options

```ts
createBffRoutes({
  issuerUrl: '...',              // Required — OIDC provider
  clientId: '...',               // Required — OAuth2 client ID
  encryptionKey: '...',          // Required (or use crypto)
  crypto: myKmsCrypto,           // Optional — pluggable encryption backend
  redirectUri: '...',            // Optional — derived from request URL
  postLoginRedirect: '/dashboard', // Optional — default: /
  postLogoutRedirect: '/',       // Optional — default: /
  scopes: ['openid', 'email'],  // Optional — default: openid email profile
  audience: '...',               // Optional — included in auth request
  cookieMaxAge: 86400,           // Optional — session duration in seconds
  rollingDuration: 3600,         // Optional — reset session on activity
})
```
