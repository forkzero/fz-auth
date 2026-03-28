# Choose an Identity Provider

fz-auth works with any OIDC-compliant identity provider. Pick based on your constraints:

## Decision matrix

| | Google-only | Auth0 | Ory (self-hosted) | Keycloak |
|---|---|---|---|---|
| **Setup time** | 5 min | 10 min | 30 min | 20 min |
| **Cost** | Free | $23/1K MAU | $0 + ~$40/mo infra | $0 + ~$40/mo infra |
| **Social login** | Google only | 30+ providers | Manual OIDC config | 20+ providers |
| **Self-hostable** | No | No | Yes | Yes |
| **MFA** | Google handles it | Dashboard toggle | Kratos config | Admin UI toggle |
| **User management** | None (Google is the source) | Full dashboard | API only | Full admin UI |
| **Device flow (CLI)** | No | Yes | Yes (Hydra) | Yes |
| **Best for** | MVPs, internal tools | SaaS products | Full control, compliance | Enterprise, on-prem |

## Recommendations

- **"I just want login to work"** → Google-only. No IdP to manage.
- **"I'm building a SaaS"** → Auth0. Best DX, social providers, user management.
- **"I need full control"** → Ory. Self-hosted, OIDC-compliant, $0 software cost.
- **"Enterprise with existing LDAP/AD"** → Keycloak. SAML + LDAP + OIDC in one.

## Next step

Pick your IdP and follow the corresponding guide in `02-provision-idp/`.
