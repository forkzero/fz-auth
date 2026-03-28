# Security Policy

## Reporting a vulnerability

Email security@forkzero.com with a description of the vulnerability. We will respond within 48 hours.

Do not open a public GitHub issue for security vulnerabilities.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Security design

- [IETF BFF pattern (draft-ietf-oauth-browser-based-apps-26 §6.1)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
- AES-256-GCM session encryption with random IV per encryption
- `__Host-` cookie prefix (httpOnly, Secure, SameSite=Lax, Path=/, no Domain)
- PKCE (S256) on all authorization code flows
- No tokens in browser-accessible storage
- Pluggable `SessionCrypto` for KMS/Vault/HSM backends
