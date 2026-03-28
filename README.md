# fz-auth

Auth for apps and agents. Server-side sessions, OIDC discovery, encrypted cookies. Any OIDC provider. No vendor lock-in.

```ts
import { Hono } from 'hono'
import { createBffRoutes, requiresAuth } from 'fz-auth'

const app = new Hono()

app.route('/auth', await createBffRoutes({
  issuerUrl: process.env.ISSUER_URL!,
  clientId: process.env.CLIENT_ID!,
  authApiUrl: process.env.AUTH_API_URL!,
  encryptionKey: process.env.SESSION_SECRET!,
}))

app.get('/api/me', requiresAuth({ encryptionKey: process.env.SESSION_SECRET! }), (c) => {
  return c.json({ token: c.get('accessToken') })
})

export default app
```

That's a working auth server. `SESSION_SECRET` is a 32-byte hex key (`openssl rand -hex 32`). The `issuerUrl` is any OIDC provider — Google, Auth0, Keycloak, Ory, Cognito.

## How it works

```
Browser → GET /auth/login → redirect to IdP (Google, Auth0, etc.)
User authenticates at the IdP
IdP → GET /auth/callback?code=X → server exchanges code for tokens
Server sets encrypted httpOnly cookie → redirect to app
Browser → GET /api/me (cookie sent automatically) → server decrypts, returns data
```

Tokens never reach the browser. This is the [BFF pattern](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps) — the IETF-recommended approach for browser-based OAuth2.

## Packages

| Package | What |
|---------|------|
| `fz-auth` | Hono routes + middleware (the main install) |
| `fz-auth-core` | Framework-agnostic core (for building Express/Fastify adapters) |
| `fz-auth-react` | `<AuthProvider>` + `useAuth()` for React SPAs |
| `fz-auth-aws` | AWS KMS envelope encryption for session cookies |

## Features

- **Any OIDC provider** — endpoints discovered automatically via `.well-known/openid-configuration`
- **No tokens in browser** — httpOnly, Secure, SameSite=Lax, `__Host-` prefix cookies
- **No database required** — sessions stored in AES-256-GCM encrypted cookies
- **Pluggable crypto** — swap in AWS KMS, Vault, or any custom backend via `SessionCrypto` interface
- **Rolling sessions** — `rollingDuration` resets session expiry on activity
- **Agent identity** — API keys with `agentId` for non-human audit trails
- **OIDC discovery** — one `issuerUrl`, works with Google, Auth0, Keycloak, Ory, Cognito
- **Silent refresh** — server-side refresh token rotation, no user interaction

## Quick start

```bash
# Generate a session encryption key
openssl rand -hex 32

# Install
npm install fz-auth

# For React apps
npm install fz-auth-react

# For AWS KMS encryption (production)
npm install fz-auth-aws
```

## Guides

### Setup — build your auth ecosystem

| Guide | What |
|-------|------|
| [Choose an IdP](prompts/setup/01-choose-idp.md) | Auth0 vs Ory vs Keycloak vs Google-only |
| [Provision an IdP](prompts/setup/02-provision-idp/) | Set up your identity provider |
| [Add social login](prompts/setup/03-add-social-login/) | Google, GitHub, Microsoft, Apple |
| [Add BFF to your app](prompts/setup/04-add-bff-to-app/) | Mount auth routes on Hono |
| [Add React frontend](prompts/setup/05-add-frontend/) | AuthProvider + protected routes |
| [Add agent auth](prompts/setup/06-add-agent-auth/) | API keys, device flow, CI/CD tokens |
| [Add organizations](prompts/setup/07-add-organizations/) | Multi-tenant teams with roles |
| [Production hardening](prompts/setup/08-production-hardening/) | KMS, rate limits, security headers |

### Deploy

| Guide | What |
|-------|------|
| [AWS App Runner](prompts/deploy/aws-apprunner.md) | Deploy BFF + Ory on App Runner |
| [AWS OIDC setup](prompts/deploy/aws-oidc-setup.md) | GitHub Actions → AWS without long-lived keys |
| [Secrets management](prompts/deploy/secrets-pattern.md) | Env var injection at runtime |

### Testing

| Guide | What |
|-------|------|
| [Unit tests](prompts/testing/unit-tests.md) | Test BFF routes with mocked OIDC |
| [Smoke tests](prompts/testing/smoke-tests.md) | Post-deploy health + OIDC validation |
| [Security checks](prompts/testing/security-checks.md) | CORS, auth enforcement, headers, rate limits |
| [E2E login flow](prompts/testing/e2e-login-flow.md) | Playwright browser tests |
| [Mock auth server](prompts/testing/mock-auth-server.md) | Test JWT middleware without a real IdP |
| [Session security](prompts/testing/session-security.md) | Encryption validation, tamper detection |

### Local development

| Guide | What |
|-------|------|
| [Local stack](prompts/dev/local-stack.md) | Docker Compose with Ory + PG + your app |
| [Process manager](prompts/dev/process-manager.md) | Run everything in one terminal |
| [Social login on localhost](prompts/dev/social-login-local.md) | Google OAuth on localhost |

### CI/CD

| Guide | What |
|-------|------|
| [Renovate](prompts/ci/renovate-setup.md) | Auto-update dependencies |
| [Release pipeline](prompts/ci/release-pipeline.md) | Changesets → auto-publish |
| [Secret scanning](prompts/ci/secret-scanning.md) | Pre-commit detect-secrets |

## Self-hosted Ory starter kit

The `ory/` directory contains a production-ready Ory Kratos + Hydra configuration:

```bash
cd ory && docker compose up -d
```

This gives you a full identity provider on localhost with password login, email verification, and OAuth2 — ready for `fz-auth` to connect to.

## Architecture

```
fz-auth-core          ← OIDC discovery, PKCE, session crypto (no framework dependency)
fz-auth               ← Hono adapter: routes + middleware (~160 lines of glue)
fz-auth-react         ← React AuthProvider + useAuth (~100 lines)
fz-auth-aws           ← AWS KMS envelope encryption (~110 lines)
```

The core is framework-agnostic. The Hono adapter is thin. Building an Express or Fastify adapter means writing ~160 lines of cookie/redirect glue over `createBffCore()`.

## Security

- Per [IETF draft-ietf-oauth-browser-based-apps-26 §6.1](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps) (BFF pattern)
- Per [RFC 9700](https://datatracker.ietf.org/doc/rfc9700/) (OAuth 2.0 Security BCP)
- AES-256-GCM with random IV per encryption
- `__Host-` cookie prefix (Secure, no Domain, Path=/)
- Pluggable `SessionCrypto` for KMS/Vault/HSM backends
- PKCE (S256) on all authorization flows
- No tokens in `localStorage` or `sessionStorage`

## License

[Apache 2.0](LICENSE)
