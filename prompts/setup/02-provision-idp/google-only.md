# Use Google Directly as IdP

The simplest option — no IdP to manage. Users sign in with their Google account.

## Steps

### 1. Create Google OAuth credentials

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Configure OAuth consent screen
4. Create credentials → OAuth 2.0 Client ID → Web application
5. Add redirect URI: `http://localhost:3000/auth/callback`

### 2. Configure fz-auth

```env
ISSUER_URL=https://accounts.google.com
CLIENT_ID=your-client-id.apps.googleusercontent.com
SESSION_SECRET=<openssl rand -hex 32>
```

That's it. Google supports OIDC discovery natively — fz-auth discovers all endpoints automatically.

### 3. Verify

```bash
curl -s https://accounts.google.com/.well-known/openid-configuration | jq .authorization_endpoint
```

## Limitations

- Google login only — no password auth, no other social providers
- No user management dashboard
- No device flow for CLI tools
- No multi-factor auth configuration (Google handles MFA on their side)

## When to upgrade

If you need multiple login methods, user management, or CLI auth → switch to Auth0 or Ory. fz-auth works the same — just change `ISSUER_URL` and `CLIENT_ID`.
