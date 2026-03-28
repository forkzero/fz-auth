# Add React Frontend

## Prerequisites

- fz-auth BFF routes mounted on your Hono backend (see `04-add-bff-to-app/`)
- A React app (Vite, Next.js, CRA, etc.)

## Steps

### 1. Install

```bash
npm install fz-auth-react
```

### 2. Wrap your app in AuthProvider

```tsx
import { AuthProvider } from 'fz-auth-react'

function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  )
}
```

Default URLs: `/auth/login`, `/auth/logout`, `/auth/session`, `/auth/refresh`. Override if your BFF routes are mounted elsewhere.

### 3. Use the auth hook

```tsx
import { useAuth } from 'fz-auth-react'

function Dashboard() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth()

  if (isLoading) return <div>Loading...</div>
  if (!isAuthenticated) return <button onClick={login}>Sign in</button>

  return (
    <div>
      <p>Welcome!</p>
      <button onClick={logout}>Sign out</button>
    </div>
  )
}
```

### 4. Vite proxy (development)

Your React dev server (port 5173) needs to proxy `/auth/*` to your Hono backend (port 3000):

```ts
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
})
```

### 5. Protected routes

```tsx
function ProtectedRoute({ children }) {
  const { isLoading, isAuthenticated, login } = useAuth()

  if (isLoading) return null
  if (!isAuthenticated) {
    login()
    return null
  }
  return children
}
```

## AuthProvider props

| Prop | Default | Purpose |
|------|---------|---------|
| `loginUrl` | `/auth/login` | BFF login endpoint |
| `logoutUrl` | `/auth/logout` | BFF logout endpoint |
| `sessionUrl` | `/auth/session` | BFF session check endpoint |
| `refreshUrl` | `/auth/refresh` | BFF token refresh endpoint |
| `onAuthError` | — | Error callback |
