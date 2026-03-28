# Add CLI Auth via Device Flow

OAuth2 device flow (RFC 8628) lets CLI tools authenticate without a browser redirect. The user sees a code, opens a URL, and authorizes.

## How it works

```
CLI                         Browser                    IdP
 │                            │                         │
 ├─ POST /device/authorize ──►│                         │
 │◄── device_code + user_code │                         │
 │                            │                         │
 │  "Enter code ABC-123       │                         │
 │   at https://idp/device"   │                         │
 │                            ├── User opens URL ──────►│
 │                            │   enters code            │
 │                            │◄── authorized ──────────│
 │                            │                         │
 │  (polls every 5s)          │                         │
 ├─ POST /device/token ──────►│                         │
 │◄── access_token            │                         │
```

## Prerequisites

- An IdP that supports device flow (Ory Hydra, Auth0, Okta)
- An OAuth2 client registered with `urn:ietf:params:oauth:grant-type:device_code` grant type

## CLI implementation

```ts
// 1. Request device code
const res = await fetch('https://your-auth-api/api/v1/device/authorize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientId: 'my-cli' }),
})
const { deviceCode, userCode, verificationUri } = await res.json()

console.log(`Open ${verificationUri} and enter code: ${userCode}`)

// 2. Poll for token
while (true) {
  await new Promise(r => setTimeout(r, 5000))
  const tokenRes = await fetch('https://your-auth-api/api/v1/device/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'my-cli', deviceCode }),
  })
  const body = await tokenRes.json()
  if (tokenRes.ok) {
    console.log('Authenticated!')
    saveToken(body.accessToken)
    break
  }
  if (body.error !== 'authorization_pending') {
    throw new Error(body.error)
  }
}
```

## Registering a device flow client (Ory Hydra)

```bash
hydra create oauth2-client \
  --endpoint http://localhost:4445 \
  --name "My CLI" \
  --id my-cli \
  --grant-type urn:ietf:params:oauth:grant-type:device_code,refresh_token \
  --response-type code \
  --scope openid,email,profile,offline_access \
  --token-endpoint-auth-method none
```
