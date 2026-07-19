# The BFF pattern: server-side sessions over upstream OIDC

## The problem

A browser app needs to authenticate users against an OAuth2/OIDC provider. The unavoidable
question is: **where do the tokens live?**

The tempting answer — have the SPA run the OAuth flow and keep the access/refresh tokens in
`localStorage` or memory — puts long-lived bearer tokens inside reach of any script on the
page. One XSS bug, one compromised npm dependency, and those tokens walk out the door. Access
tokens are hard to revoke mid-life; refresh tokens are worse. "Store the JWT in the browser"
is the default a lot of tutorials teach, and it's the thing you most want to avoid.

## The options

| Approach | Where tokens live | XSS exposure |
|---|---|---|
| SPA holds tokens (`localStorage`/memory) | in the browser | **high** — any script can read them |
| SPA holds tokens in a non-`httpOnly` cookie | in the browser | high — readable by JS |
| **BFF: server holds tokens, browser gets an encrypted `httpOnly` session cookie** | on the server | **none** — JS can't read the cookie or the tokens |

## The BFF answer

**Backend-for-Frontend**: a thin server-side layer runs the OAuth2 Authorization Code flow
(with PKCE), receives the tokens, and stores them **server-side** — encrypted into an
`httpOnly`, `Secure`, `SameSite` cookie. The browser gets an opaque session cookie it can't
read; the tokens never touch JavaScript. This is the
[IETF-recommended pattern](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
for browser-based OAuth.

```
Browser → GET /auth/login → redirect to the IdP (Google, Okta, Cognito, …)
User authenticates at the IdP
IdP → GET /auth/callback?code=… → server exchanges code for tokens (PKCE)
Server encrypts tokens into an httpOnly cookie → redirects to the app
Browser → GET /api/me (cookie sent automatically) → server decrypts, authorizes
```

Tokens never reach the browser; the cookie is useless to injected script.

## Where identity comes from

A subtle but important point: **the user's identity is the ID token, not a profile API.**
In OIDC the ID token is a signed set of claims asserting *who authenticated* (`sub`, `email`,
`name`). So a `/session` endpoint should project the user from the **ID token's claims** — not
call some separate profile service, and not conflate "who authenticated" (a stable
authentication assertion) with "profile" (mutable app data the app owns).

Two things follow:

- **Verify the ID token's signature** against the provider's JWKS (`jwks_uri` from OIDC
  discovery), and check `iss`/`aud`/`exp`. Received directly from the token endpoint over TLS
  it's trusted-by-transport, but a library should verify anyway — cheap defense in depth.
- **Real access tokens are often opaque** (Google's are), so don't try to read identity out of
  the access token. The ID token is the identity artifact.

## When the BFF beats the alternatives

- **vs. SPA-holds-tokens:** strictly safer (no token in the browser) at the cost of a small
  server-side session layer. Almost always the right trade for a first-party web app.
- **vs. a full hosted IdP owning your whole login:** the BFF keeps you on standard OIDC and
  provider-neutral — you can swap Google for Okta for Cognito by changing an issuer URL, with
  no SDK rewrite. You own the session; the IdP just authenticates.
- **vs. rolling your own password auth:** don't. Delegating to an upstream OIDC provider
  inherits its MFA, recovery, and brute-force protection for free.

## Recommendation

For a first-party browser app, **use a BFF over an upstream OIDC provider.** Keep the session
layer thin and standards-based: OIDC discovery + PKCE + an encrypted `httpOnly` cookie, with
the ID token as the identity source and its signature verified against the JWKS.

In `fz-auth` this is `createBffRoutes({ issuerUrl, clientId, encryptionKey })` for the
`/auth/*` routes and `requiresAuth()` to gate your API. See also
[choosing an approach](./choosing-an-approach.md) for when a BFF *isn't* enough on its own
(enterprise SSO, machine clients).
