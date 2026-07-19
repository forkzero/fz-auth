// Machine-client token minter (fz-auth#5): exchange a long-lived API key for a short-TTL,
// signed JWT that downstream services verify LOCALLY against a published JWKS — no
// per-request introspection round-trip. The opaque + introspect mode is supported too (via
// the Hono adapter's pluggable `introspect`), so both verification models are first-class.
//
// Everything policy-shaped is pluggable: the SIGNER (an in-memory dev key here; bring a
// KMS/HSM signer in prod), the API-key verification, and the CLAIMS (carried opaquely — the
// minter never interprets `org_id`, tier labels, entitlements, or an `entitlements_ref`).

import { randomBytes } from 'node:crypto'
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  createLocalJWKSet,
  type JWK,
  type JWTPayload,
  type JSONWebKeySet,
} from 'jose'
import type { MintedCredential } from './device.js'

/**
 * Signs claim sets into compact JWTs and exposes its public key for the JWKS. The default
 * {@link createLocalSigner} holds an in-process key. A custom signer (e.g. KMS-backed)
 * implements `sign` — assembling and signing the JWT — and `publicJwk`; the minter is
 * agnostic to how signing happens.
 */
export interface Signer {
  /** Assemble + sign a claim set into a compact JWT. */
  sign(claims: JWTPayload): Promise<string>
  /** The public JWK to publish (carrying `kid`, `alg`, `use: 'sig'`). */
  publicJwk(): Promise<JWK>
}

/** An in-process signer for dev/tests. Prod deployments supply a KMS-backed {@link Signer}. */
export async function createLocalSigner(opts: { kid?: string; alg?: 'ES256' | 'ES384' } = {}): Promise<Signer> {
  const alg = opts.alg ?? 'ES256'
  const kid = opts.kid ?? randomBytes(8).toString('hex')
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true })
  return {
    async sign(claims: JWTPayload): Promise<string> {
      return new SignJWT(claims).setProtectedHeader({ alg, kid, typ: 'JWT' }).sign(privateKey)
    },
    async publicJwk(): Promise<JWK> {
      return { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' }
    },
  }
}

export interface MintInput {
  /** The `sub` claim — the principal the token represents. */
  subject: string
  /** Opaque, caller-owned claims (e.g. org_id, tier, entitlements, entitlements_ref). */
  claims?: Record<string, unknown>
  /** Override the default audience for this token. */
  audience?: string
  /** Override the default TTL for this token. */
  ttlSeconds?: number
}

export interface TokenMinterOptions {
  /** The active signing key. */
  signer: Signer
  /**
   * Retired signers whose public keys must stay in the JWKS so tokens they signed still
   * verify during a rotation window. New tokens always use {@link TokenMinterOptions.signer}.
   */
  retiredSigners?: Signer[]
  issuer: string
  audience?: string
  /** Default token lifetime; keep it SHORT — it is the local-revocation bound. Default 600s. */
  defaultTtlSeconds?: number
}

export interface TokenMinter {
  /** Mint a short-TTL JWT carrying the caller's claims (RFC 6749 §5.1 token response). */
  mint(input: MintInput): Promise<MintedCredential>
  /** The current public JWKS (all active + retired keys), for `/.well-known/jwks.json`. */
  jwks(): JSONWebKeySet
  /** Verify a token this minter issued and return its claims (the introspection/parity path). */
  verify(token: string, opts?: { audience?: string }): Promise<JWTPayload>
}

export async function createTokenMinter(options: TokenMinterOptions): Promise<TokenMinter> {
  const ttlDefault = options.defaultTtlSeconds ?? 600
  const signers = [options.signer, ...(options.retiredSigners ?? [])]
  const jwksDoc: JSONWebKeySet = { keys: await Promise.all(signers.map((s) => s.publicJwk())) }
  const localJwks = createLocalJWKSet(jwksDoc)

  return {
    async mint({ subject, claims = {}, audience, ttlSeconds }: MintInput): Promise<MintedCredential> {
      const ttl = ttlSeconds ?? ttlDefault
      const now = Math.floor(Date.now() / 1000)
      // Registered claims win over caller claims so `iss`/`sub`/`exp` can't be spoofed.
      const access_token = await options.signer.sign({
        ...claims,
        iss: options.issuer,
        aud: audience ?? options.audience,
        sub: subject,
        iat: now,
        exp: now + ttl,
      })
      return { access_token, token_type: 'Bearer', expires_in: ttl }
    },

    jwks(): JSONWebKeySet {
      return jwksDoc
    },

    async verify(token: string, opts: { audience?: string } = {}): Promise<JWTPayload> {
      const { payload } = await jwtVerify(token, localJwks, {
        issuer: options.issuer,
        audience: opts.audience ?? options.audience,
      })
      return payload
    },
  }
}
