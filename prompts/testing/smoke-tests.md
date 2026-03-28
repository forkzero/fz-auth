# Post-Deploy Smoke Tests

Validate your auth deployment works end-to-end. Run these after every deploy.

## Setup

```bash
npm install -D vitest
```

## Test file

```ts
// test/smoke.test.ts
import { describe, test, expect, beforeAll } from 'vitest'

const APP_URL = process.env.APP_URL!        // e.g. https://my-app.com
const ISSUER_URL = process.env.ISSUER_URL!  // e.g. https://accounts.google.com

describe('Health', () => {
  test('app is reachable', async () => {
    const res = await fetch(`${APP_URL}/auth/session`)
    // 401 is expected (no cookie) — the point is the server responds
    expect([200, 401]).toContain(res.status)
  })
})

describe('OIDC Discovery', () => {
  let config: Record<string, unknown>

  beforeAll(async () => {
    const res = await fetch(`${ISSUER_URL}/.well-known/openid-configuration`)
    config = await res.json()
  })

  test('authorization_endpoint exists', () => {
    expect(config.authorization_endpoint).toBeDefined()
  })

  test('token_endpoint exists', () => {
    expect(config.token_endpoint).toBeDefined()
  })

  test('issuer matches', () => {
    expect(config.issuer).toContain(new URL(ISSUER_URL).hostname)
  })
})

describe('Auth Flow', () => {
  test('/auth/login redirects to IdP', async () => {
    const res = await fetch(`${APP_URL}/auth/login`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('response_type=code')
    expect(location).toContain('code_challenge')
  })

  test('/auth/session returns 401 without cookie', async () => {
    const res = await fetch(`${APP_URL}/auth/session`)
    expect(res.status).toBe(401)
  })

  test('/auth/logout redirects', async () => {
    const res = await fetch(`${APP_URL}/auth/logout`, { redirect: 'manual' })
    expect(res.status).toBe(302)
  })
})
```

## Run

```bash
APP_URL=https://my-app.com ISSUER_URL=https://accounts.google.com npx vitest run smoke
```
