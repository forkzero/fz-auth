# Add GitHub Login

## Prerequisites

- An OIDC identity provider that supports GitHub as a social connection (Auth0, Ory, Keycloak)
- OR using GitHub directly as the IdP

## Steps

### 1. Create GitHub OAuth App

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
2. New OAuth App
3. Set the callback URL:
   - Local: `http://localhost:3000/auth/callback`
   - Production: `https://your-app.com/auth/callback`
4. Save the **Client ID** and **Client Secret**

### 2. Important: GitHub OIDC quirks

GitHub does NOT support standard OIDC discovery (no `/.well-known/openid-configuration`). You have two options:

**Option A: Use GitHub through an IdP (recommended)**

Configure GitHub as a social connection in Auth0, Ory, or Keycloak. The IdP handles the non-standard parts. fz-auth talks to the IdP via standard OIDC.

**Option B: Use GitHub directly**

You'll need to provide explicit endpoint URLs instead of relying on OIDC discovery:

```ts
// GitHub doesn't support OIDC discovery, so you can't use issuerUrl alone.
// Instead, use an IdP (Auth0, Ory, Keycloak) that wraps GitHub in standard OIDC.
```

### 3. If using Ory Kratos

Add a GitHub OIDC provider to your Kratos config. Create `oidc.github.jsonnet`:

```jsonnet
local claims = std.extVar('claims');
{
  identity: {
    traits: {
      [if 'email' in claims then 'email']: claims.email,
      name: {
        [if 'name' in claims then 'first']: claims.name,
      },
    },
  },
}
```

Add GitHub credentials to the Kratos entrypoint environment variables.

### 4. If using Auth0

Enable GitHub in the Auth0 dashboard → Authentication → Social → GitHub. Paste the Client ID and Client Secret.

No fz-auth code changes needed — Auth0 handles the GitHub OAuth flow and presents it as standard OIDC to fz-auth.
