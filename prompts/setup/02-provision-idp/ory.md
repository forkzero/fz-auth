# Provision Ory (Self-Hosted)

## What you get

A full OIDC-compliant identity provider running on your infrastructure:
- Kratos: user registration, login, password reset, email verification
- Hydra: OAuth2 authorization code flow, device flow, JWT tokens, JWKS

## Steps

### 1. Start the local stack

```bash
cd ory
docker compose up -d
```

This starts: PostgreSQL, Kratos, Hydra, and Mailslurper (email catch-all).

| Service | Port | URL |
|---------|------|-----|
| Kratos Public | 4433 | http://localhost:4433 |
| Kratos Admin | 4434 | http://localhost:4434 |
| Hydra Public | 4444 | http://localhost:4444 |
| Hydra Admin | 4445 | http://localhost:4445 |
| Mailslurper | 4436 | http://localhost:4436 |

### 2. Create an OAuth2 client

```bash
docker compose exec hydra hydra create oauth2-client \
  --endpoint http://localhost:4445 \
  --name "My App" \
  --id my-app \
  --grant-type authorization_code,refresh_token \
  --response-type code \
  --scope openid,email,profile,offline_access \
  --redirect-uri http://localhost:3000/auth/callback \
  --token-endpoint-auth-method none
```

### 3. Configure fz-auth

```env
ISSUER_URL=http://localhost:4444
CLIENT_ID=my-app
SESSION_SECRET=<openssl rand -hex 32>
```

### 4. Verify

```bash
# OIDC discovery should return endpoints
curl -s http://localhost:4444/.well-known/openid-configuration | jq .authorization_endpoint

# Kratos health
curl -s http://localhost:4433/health/ready | jq .
```

## Production deployment

See `prompts/deploy/aws-apprunner.md` for deploying Ory on AWS.
