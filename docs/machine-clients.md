# Machine-to-machine auth: short-TTL JWTs + JWKS

## The problem

A service or a CI job authenticates with a long-lived API key. On the hot path — every
request it makes to your other services — how do those services *authorize* it? If each
request triggers a call back to the auth service to validate the key, you've coupled every
service's latency and availability to the auth service. When the auth service is down or slow,
everything is.

## The options

| Model | How a resource server validates | Revocation | Cost per request |
|---|---|---|---|
| **Opaque token + introspection** (RFC 7662) | calls the auth service's `/introspect` | **instant** (server-side lookup) | a network round-trip |
| **Self-signed JWT + JWKS** | verifies the signature locally against a cached JWKS | via **short TTL** (token expires) | ~zero (local crypto) |

Neither is strictly better — they trade revocation immediacy for hot-path independence.

## The pattern: exchange the key, verify locally

Give the machine client a cheap exchange: it presents its **long-lived API key** once and gets
back a **short-TTL signed JWT**. Downstream services verify that JWT **locally** against a
published JWKS — no per-request call to the auth service.

```
client → POST /token   (Authorization: Bearer <api-key>)
  → auth service validates the key → mints a SHORT-TTL JWT
      { iss, sub, exp, ...claims }   signed with the service's key
  → published at GET /.well-known/jwks.json
resource server → verifies the JWT against the cached JWKS on every request
  — no round-trip, no availability coupling
```

The **API key is the long-lived, revocable credential**; the **JWT is the short-lived
bearer**. Revoke the key and the next exchange fails — existing JWTs simply expire (keep the
TTL short, e.g. 5–15 minutes, and that window *is* your revocation bound).

## Design points that matter

- **Keep both modes first-class.** Use JWT+JWKS for hot-path data access; keep an
  introspection endpoint for control-plane calls that need instant revocation. A good
  introspection endpoint returns the *same* claims the JWT carries (**claims parity**), so a
  caller sees the same thing whether it verified locally or remotely.
- **Carry claims opaquely.** The minter shouldn't interpret application claims — an org id, a
  plan/tier label, entitlements. It signs what it's given; the *resource server* enforces.
  Keep tokens small: inline claims while they're small, and switch to a reference
  (`something_ref` + a version) the caller resolves from its own store when they grow.
- **Make the signer pluggable.** In-process keys are fine for dev; production should sign with
  a KMS/HSM so the private key never leaves the boundary. Publish the public key(s) at
  `jwks.json` and rotate by `kid` (keep retired keys in the JWKS during the rotation window).
- **Registered claims win.** When you merge caller-supplied claims with `iss`/`sub`/`exp`, let
  the registered ones override, so a caller can't spoof them.

## Why this closes the "run my own IdP" temptation

Teams sometimes reach for a heavyweight identity server *just* to get machine tokens. You
don't need one: a short-TTL JWT minter + a JWKS endpoint gives downstream services **local,
introspection-free verification** — which is strictly *better* than a per-request round-trip,
not a downgrade.

## Recommendation

For service/API-key clients, **mint short-TTL JWTs and publish a JWKS for local verification**,
and keep an introspection endpoint alongside for instant-revocation cases. Short TTL + a
revocable API key gives you both speed and control.

In `fz-auth`: `createTokenMinter({ signer, issuer })` (`mint` / `jwks` / `verify`) plus
`createTokenRoutes` for `POST /token`, `GET /.well-known/jwks.json`, and `POST /introspect`.
