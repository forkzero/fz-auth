# Choosing an identity approach

There's a spectrum of ways to do auth, from "own nothing" to "own everything." Most teams
over-shoot toward owning more than they need. This guide is a decision aid — the factors that
actually decide it, and the narrow cases where the heavy options are right.

## The spectrum

| Approach | You run | You own | Typical fit |
|---|---|---|---|
| **Roll your own passwords** | everything, badly | the breach headline | ❌ almost never |
| **BFF over social / upstream OIDC** | a thin session layer | sessions + your data | developer/consumer apps; social login is fine |
| **Managed identity hub** (e.g. Cognito) | config | your data | you want SSO + a hub inside one cloud you already use |
| **Hosted IdP / SSO broker** (e.g. Auth0, WorkOS) | config + a bill | your data | you want turnkey enterprise SSO, SCIM, admin portal |
| **Self-hosted IdP** (e.g. Keycloak, Ory) | the whole identity stack | everything | you must be an IdP, or run air-gapped, or escape per-user pricing at huge scale |

## The factors that decide it

**Who are your users?**
- Developers / consumers who'll happily "Sign in with GitHub/Google" → **BFF over social OIDC**
  is the sweet spot.
- Businesses who mandate their own IdP → you need **enterprise SSO** (still as a relying party;
  see [that guide](./enterprise-sso.md)) — a hub or broker behind your BFF.
- Consumers who expect email/password sign-up → that's the one case that pushes you toward a
  hosted IdP or (reluctantly) owning credentials.

**Machine clients?** Independent of the above — solve it with
[short-TTL JWTs + JWKS](./machine-clients.md), not by adopting a heavier IdP.

**Cost model.** Hosted IdPs charge **per monthly active user**; enterprise-SSO brokers often
charge **per connection**; self-hosting is **flat infra + ops time**. Per-MAU is cheap early
and expensive at scale; per-connection is cheap for a few big customers and adds up with many;
self-hosting is "free" software but real operational cost. Match the curve to your growth.

**Ops appetite.** A self-hosted IdP is not just a container — it's upgrades, migrations,
availability, and security patching for the single most attack-prone service you run. Budget
that honestly.

## When self-hosting an IdP is actually right

Three cases genuinely justify it; most teams have none of them:

1. **You need to *be* an identity provider** — "Sign in with *us*" for third-party apps you
   don't own, with a consent screen. This is the one capability the BFF/hub/broker options
   don't give you.
2. **Deployment sovereignty** — air-gapped, on-prem, or strict data-residency requirements
   that a SaaS IdP structurally can't meet. (Even here, a turnkey self-hosted IdP is usually a
   better call than assembling one from parts.)
3. **Scale economics** — at millions of MAU or hundreds of enterprise connections, flat
   self-hosted cost can beat per-MAU / per-connection pricing.

"We might need to self-host someday" is not one of these. Reach for it when a *signed
requirement* forces it, not on spec.

## If you do run your own identity service: the datastore

One infra note, because it's where the surprise costs hide. A stateful auth service needs a
database, and *how you reach it* drives both cost and risk:

- **Public managed endpoint** (a managed Postgres reached over TLS) — your app connects
  directly, so it needs no private-network plumbing. On most clouds that **removes a NAT
  gateway**, which is often the single largest fixed line item in a small deployment.
- **Private VPC database** — no public surface, but you pay for the private-networking
  plumbing (NAT/egress) and lose scale-to-zero on many managed options.

A public endpoint is defensible **when the data is guarded**: with an upstream-OIDC design
you're not storing passwords (the IdP holds credentials) — just external subject IDs, org
rows, and hashed keys. Lock it down regardless — TLS required, credentials in a secrets
manager (never in env literals), a tight security posture — and keep a documented escape hatch
to private networking if a compliance requirement ever demands it. Choose the endpoint on the
data's sensitivity and your compliance needs, not by reflex.

## Where fz-auth fits

`fz-auth` lives in the **BFF-over-upstream-OIDC** lane, with first-party
[device](./device-flow.md) and [machine-token](./machine-clients.md) primitives on top. It
deliberately does *not* try to be an IdP — for enterprise SSO it federates to a hub or broker
as [just another upstream](./enterprise-sso.md). That's the lane most applications should be
in; climb toward a self-hosted IdP only when one of the three cases above is a hard
requirement.
