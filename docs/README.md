# Design notes

The *why* behind `fz-auth` — a set of vendor-neutral guides for anyone implementing auth,
distilled from building and running an OIDC-based auth service. Each guide is structured the
same way: **the problem → the options → the tradeoffs → a recommendation.**

The through-line: **you rarely need to *be* an identity provider.** Delegate authentication
to an upstream IdP, hold the tokens server-side, and verify locally. That posture — the BFF
pattern — is cheaper, safer, and less to operate than running your own identity stack, and
it's the spine every guide here shares.

## Guides

1. **[The BFF pattern](./bff.md)** — server-side sessions over upstream OIDC. Why tokens
   should never reach the browser, and where identity actually comes from.
2. **[Device & CLI auth](./device-flow.md)** — the OAuth 2.0 Device Authorization Grant
   (RFC 8628): letting a CLI authenticate by delegating to the browser you already trust.
3. **[Machine-to-machine auth](./machine-clients.md)** — exchanging a long-lived API key for
   a short-TTL JWT that services verify locally against a JWKS, with no per-request round-trip.
4. **[Enterprise SSO without becoming an IdP](./enterprise-sso.md)** — how "sign in with your
   company's Okta" works when *you're the relying party*, not the identity provider.
5. **[Choosing an identity approach](./choosing-an-approach.md)** — a decision guide across
   roll-your-own, BFF-over-social, managed hub, hosted broker, and self-hosted IdP — and the
   narrow cases where self-hosting is actually right.

## A note on scope

These are design guides, not vendor pitches. Where a product is named (GitHub, Google, Okta,
Microsoft Entra, Amazon Cognito, Auth0, WorkOS, Keycloak, Ory, …) it's as a concrete example
of a *category*, not an endorsement — the whole point is to keep you un-locked-in behind
standard OIDC.
