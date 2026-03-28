# Security Validation Tests

Verify your auth deployment is hardened. Run against staging and production.

## Test file

```ts
// test/security.test.ts
import { describe, test, expect } from 'vitest'

const APP_URL = process.env.APP_URL!

describe('CORS', () => {
  test('rejects unauthorized origins', async () => {
    const res = await fetch(`${APP_URL}/api/me`, {
      headers: { Origin: 'https://evil.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('Auth Enforcement', () => {
  test('protected routes return 401 without auth', async () => {
    const res = await fetch(`${APP_URL}/api/me`)
    expect(res.status).toBe(401)
  })
})

describe('Security Headers', () => {
  let headers: Headers

  beforeAll(async () => {
    const res = await fetch(`${APP_URL}/auth/session`)
    headers = res.headers
  })

  test('Strict-Transport-Security', () => {
    expect(headers.get('strict-transport-security')).toContain('max-age=')
  })

  test('X-Frame-Options', () => {
    expect(headers.get('x-frame-options')).toBe('DENY')
  })

  test('X-Content-Type-Options', () => {
    expect(headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('Error Handling', () => {
  test('no stack traces in error responses', async () => {
    const res = await fetch(`${APP_URL}/api/nonexistent`)
    const body = await res.text()
    expect(body).not.toContain('at ')
    expect(body).not.toContain('.ts')
  })
})

describe('Session Cookie', () => {
  test('/auth/login sets PKCE cookie with correct attributes', async () => {
    const res = await fetch(`${APP_URL}/auth/login`, { redirect: 'manual' })
    const cookies = res.headers.getSetCookie()
    const pkce = cookies.find(c => c.includes('fz_pkce'))
    expect(pkce).toBeDefined()
    expect(pkce).toContain('HttpOnly')
    expect(pkce).toContain('Secure')
    expect(pkce).toContain('SameSite=Lax')
  })
})
```

## Run

```bash
APP_URL=https://my-app.com npx vitest run security
```
