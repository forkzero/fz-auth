# Provision Auth0

## Steps

### 1. Create an Auth0 account and tenant

Go to [auth0.com](https://auth0.com) and create a free account. The tenant URL becomes your `ISSUER_URL`.

### 2. Create an application

1. Dashboard → Applications → Create Application
2. Choose "Regular Web Application"
3. Note the **Domain**, **Client ID** (you won't need the Client Secret — fz-auth uses PKCE)

### 3. Configure callback URLs

In the application settings, add:
- **Allowed Callback URLs**: `http://localhost:3000/auth/callback`
- **Allowed Logout URLs**: `http://localhost:3000`
- **Allowed Web Origins**: `http://localhost:3000`

### 4. Configure fz-auth

```env
ISSUER_URL=https://your-tenant.auth0.com
CLIENT_ID=your-auth0-client-id
SESSION_SECRET=<openssl rand -hex 32>
```

### 5. Verify

```bash
curl -s https://your-tenant.auth0.com/.well-known/openid-configuration | jq .authorization_endpoint
```

## Notes

- Auth0 free tier: 25,000 MAU
- Social login providers are configured in the Auth0 dashboard, not in fz-auth
- fz-auth uses PKCE (public client) — no client secret needed
