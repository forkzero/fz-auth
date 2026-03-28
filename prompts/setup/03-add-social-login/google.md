# Add Google Login

## Prerequisites

- An OIDC identity provider already configured (Auth0, Ory, Keycloak, or Google directly)
- The fz-auth BFF routes mounted on your Hono app

## Steps

### 1. Create Google OAuth credentials

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Configure the OAuth consent screen (app name, support email, authorized domains)
4. Create credentials → OAuth 2.0 Client ID → Web application
5. Add authorized redirect URIs:
   - Local: `http://localhost:3000/auth/callback`
   - Production: `https://your-app.com/auth/callback`
6. Save the **Client ID** and **Client Secret**

### 2. Configure your IdP

**If using Google directly as IdP:**

```env
ISSUER_URL=https://accounts.google.com
CLIENT_ID=your-client-id.apps.googleusercontent.com
```

No client secret needed — fz-auth uses PKCE (public client).

**If using Ory Kratos:**

Set the Google credentials as environment variables and restart Kratos. See `02-provision-idp/ory.md`.

**If using Auth0:**

Enable Google as a social connection in the Auth0 dashboard → Authentication → Social.

### 3. Test

```bash
# Start your app
npm start

# Open browser
open http://localhost:3000/auth/login
```

You should see Google's consent screen. After authenticating, you'll be redirected to your app with a session cookie set.

### 4. Verify

```bash
# Check the session is valid
curl -s http://localhost:3000/auth/session -b cookies.txt | jq .
# Should return: { "authenticated": true, "user": { ... } }
```
