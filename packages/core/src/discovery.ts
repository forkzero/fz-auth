export interface OidcEndpoints {
  authorizationUrl: string
  tokenUrl: string
  endSessionUrl?: string
}

/**
 * Fetch OIDC endpoints from the issuer's .well-known/openid-configuration.
 * Called once at BFF route creation time — not per-request.
 */
export async function discoverOidcEndpoints(issuerUrl: string): Promise<OidcEndpoints> {
  const base = issuerUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/.well-known/openid-configuration`)

  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} from ${base}/.well-known/openid-configuration`)
  }

  const config = (await res.json()) as {
    authorization_endpoint?: string
    token_endpoint?: string
    end_session_endpoint?: string
  }

  if (!config.authorization_endpoint || !config.token_endpoint) {
    throw new Error('OIDC discovery response missing authorization_endpoint or token_endpoint')
  }

  return {
    authorizationUrl: config.authorization_endpoint,
    tokenUrl: config.token_endpoint,
    endSessionUrl: config.end_session_endpoint,
  }
}
