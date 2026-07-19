# Device & CLI auth (RFC 8628)

## The problem

A CLI, a TUI, an agent, or a TV app needs to authenticate a user — but it has no browser to
redirect, and you should never ask it to collect a password. How does a device with no
(or a bad) browser get an access token for the right human?

## The options

- **Paste an API key into the CLI.** Works, but the user has to generate and copy a
  long-lived secret by hand, and it never expires unless they remember to revoke it.
- **Embed a web server + open a browser to `localhost`.** Fine for desktop, fails for
  headless/SSH/containers, and the loopback redirect is fiddly.
- **The OAuth 2.0 Device Authorization Grant** ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)).
  The device shows a short code; the human approves it in *any* browser (even on their phone);
  the device polls for a token. This is the pattern `gh`, `aws sso`, Docker, and every
  streaming stick use.

## How the device grant works

```
── CLI ─────────────────────────────────────────────────────────────
 1. POST /device/authorize  { client_id, scope }
      ← { device_code, user_code: "WDJB-MJHT",
          verification_uri, interval, expires_in }
 2. Print: "Go to <verification_uri> and enter WDJB-MJHT"
 3. Poll: POST /device/token { device_code, grant_type: device_code }
      ← 400 { error: "authorization_pending" }   (repeat; honor slow_down)
      ← 200 { access_token }                      (once approved)

── Human, in a browser ─────────────────────────────────────────────
 4. Opens the verification URI, authenticates, enters the user_code,
    approves — the grant is bound to their identity.
```

The device never sees a credential until the human has approved, out-of-band, in a context
that *can* authenticate properly.

## Serve the grant, delegate the identity

The key design move: **run the `/device/*` endpoints yourself, but don't authenticate the
human yourself.** The approval page is just another authenticated page in your app — gate it
with your existing [BFF session](./bff.md). So:

- the **grant** (codes, polling, binding) is first-party and branded as yours;
- the **identity** is delegated to your upstream OIDC provider via the same social/enterprise
  login your web app already uses — no passwords, no new credential store.

The grant is a small state machine worth getting right:

- `pending` → the human hasn't approved yet (`authorization_pending`)
- **interval enforcement** → polling faster than `interval` returns `slow_down`
- `approved` → the next poll mints a credential
- **one-time** → a `device_code` can be redeemed once, then it's dead
- `expired` / `denied` → `expired_token` / `access_denied`

Keeping the request/response shapes RFC-8628-standard (form-encoded in, snake_case out,
standard error codes) means any existing device-flow client library works against your
endpoints unchanged.

## What credential to mint

Two clean options — the same choice as [machine clients](./machine-clients.md):

- **Opaque token + introspection** — simplest; the resource server validates by calling your
  introspection endpoint. Instant revocation.
- **Self-signed JWT + JWKS** — the resource server verifies locally, no per-request call. Use
  a short TTL as the revocation bound.

## Recommendation

For any CLI/headless client, **implement the device grant and delegate identity to your
upstream IdP through your BFF session.** You get first-party, branded, password-free device
login for the cost of a ~small endpoint set and a `device_grants` table.

In `fz-auth` this is `createDeviceRoutes(service, { resolveUser })`: the public `/authorize`
and `/token` endpoints plus a session-gated approval step you wire to `requiresAuth`.
