# Enterprise SSO without becoming an IdP

## The problem

You sell to businesses, and they want their employees to "sign in with our Okta / Microsoft
Entra / Google Workspace." Enterprise SSO looks intimidating — SAML, metadata, per-customer
configuration — and it's easy to assume you now have to *become* an identity provider.

## The reframe that makes it tractable

**For B2B SSO you are the relying party consuming the customer's IdP — you do not need to be
an IdP.** The customer already has an identity provider; your job is to *federate* to it and
accept the identity it asserts. Being an IdP (issuing "Sign in with *us*" to third parties) is
the opposite direction, and almost never what enterprise SSO requires.

Once you see it that way, enterprise SSO is "the [BFF pattern](./bff.md), but the upstream
issuer is chosen per customer" — the same discovery + code-exchange + session machinery,
pointed at a different issuer depending on who's logging in.

## Home-realm discovery

The one new mechanism is deciding *which* IdP to send a given user to:

```
user enters their work email  →  domain lookup (acme.com → org "Acme" → connection)
   • no connection  →  default login (social / your own)
   • connection     →  federate to that org's configured issuer
                       → callback → JIT-provision the user + membership → session
```

Each enterprise customer gets a **connection** record — `(email domain, issuer, client id,
secret, protocol)` — and **home-realm discovery** routes by email domain. On first login you
**JIT-provision** a shadow user and org membership. Keep the simple path simple: users without
a connection fall through to your normal login.

## Build vs. buy

| Path | Covers | You operate | Good when |
|---|---|---|---|
| **OIDC federation yourself** | OIDC IdPs (Entra, Okta-OIDC, Google Workspace) | connection store + per-issuer discovery | your customers are OIDC-capable and you want zero added vendors |
| **A brokered SSO service** | SAML **and** OIDC, plus SCIM + an admin portal | one integration; the broker fans out | you need SAML, self-serve customer setup, or directory sync fast |
| **A managed identity hub** | SAML/OIDC federation behind one upstream | one OIDC upstream that federates onward | you want it all inside one cloud/vendor you already use |

The important thing: **all three sit behind the same BFF** as "just another upstream issuer."
You're never rebuilding your login — you're adding a federation source.

## Two things that trip people up

- **SAML is not OIDC.** A discovery-based OIDC client can't talk to a SAML-only IdP; SAML
  needs an SP implementation (or a broker that speaks it for you). Many enterprises are still
  SAML-first, so "we support OIDC federation" doesn't automatically mean "we support Okta."
- **Not every "social" provider is OIDC either.** Some popular login providers are OAuth2-only
  (no OIDC discovery, no ID token) and need a small adapter rather than the generic OIDC path.

## Recommendation

**Don't become an IdP.** Model enterprise SSO as per-org federation behind your BFF, routed by
home-realm discovery, with JIT provisioning. Build OIDC federation yourself if your customers
are OIDC-capable and you want no new vendors; reach for a broker when you need SAML, SCIM, or
a self-serve admin portal on day one — and reserve a self-hosted IdP for the rare case in
[choosing an approach](./choosing-an-approach.md).
