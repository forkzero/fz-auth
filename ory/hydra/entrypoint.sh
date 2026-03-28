#!/bin/sh
set -e

# Ensure an OAuth2 client exists with the desired config.
# Deletes first if it already exists, then creates fresh.
# This guarantees clients always match the entrypoint config
# (audience, scopes, redirect URIs, etc.) on every deploy.
ensure_client() {
  local endpoint="http://127.0.0.1:4445"
  local client_id="$1"
  shift
  hydra delete oauth2-client --endpoint "$endpoint" "$client_id" 2>/dev/null || true
  hydra create oauth2-client --endpoint "$endpoint" "$@"
}

register_clients() {
  # Wait for admin API
  until wget -q -O /dev/null http://127.0.0.1:4445/health/ready 2>/dev/null; do
    sleep 1
  done

  echo "[entrypoint] Hydra admin ready — registering OAuth2 clients"

  # Only include localhost redirect URIs and audiences in local dev
  local local_redirect=""
  local local_audience=""
  if [ "${ENVIRONMENT:-dev}" = "dev" ] || [ -z "$ENVIRONMENT" ]; then
    local_redirect="--redirect-uri http://localhost:5173/auth/callback"
    local_audience="--audience http://localhost:3100"
  fi

  # lattice-app: Web app (Authorization Code + PKCE)
  ensure_client lattice-app \
    --name "Lattice Web App" \
    --id lattice-app \
    --grant-type authorization_code,refresh_token,urn:ietf:params:oauth:grant-type:device_code \
    --response-type code \
    --scope openid,email,profile,offline_access \
    $local_redirect \
    --redirect-uri https://lattice-dev.forkzero.com/auth/callback \
    --redirect-uri https://lattice.forkzero.com/auth/callback \
    $local_audience \
    --audience https://auth-dev.forkzero.com \
    --audience https://auth.forkzero.com \
    --token-endpoint-auth-method none

  # lattice-cli: CLI tool (Device Flow)
  ensure_client lattice-cli \
    --name "Lattice CLI" \
    --id lattice-cli \
    --grant-type urn:ietf:params:oauth:grant-type:device_code,refresh_token \
    --response-type code \
    --scope openid,email,profile,offline_access \
    $local_audience \
    --audience https://auth-dev.forkzero.com \
    --audience https://auth.forkzero.com \
    --token-endpoint-auth-method none

  # forkzero-app: Admin app (Authorization Code + PKCE)
  ensure_client forkzero-app \
    --name "ForkZero Admin" \
    --id forkzero-app \
    --grant-type authorization_code,refresh_token \
    --response-type code \
    --scope openid,email,profile,offline_access \
    $local_redirect \
    --redirect-uri https://admin-dev.forkzero.com/auth/callback \
    --redirect-uri https://admin.forkzero.com/auth/callback \
    $local_audience \
    --audience https://auth-dev.forkzero.com \
    --audience https://auth.forkzero.com \
    --token-endpoint-auth-method none

  # auth-service: Service-to-service auth (client credentials)
  ensure_client auth-service \
    --name "Auth Service (S2S)" \
    --id auth-service \
    --secret "${AUTH_SERVICE_CLIENT_SECRET:-dev-service-secret}" \
    --grant-type client_credentials \
    --scope service \
    $local_audience \
    --audience https://auth-dev.forkzero.com \
    --audience https://auth.forkzero.com \
    --token-endpoint-auth-method client_secret_post

  echo "[entrypoint] OAuth2 client registration complete"
}

# Generate CORS origins config from env vars (avoids Viper array override issues)
EXTRA_CONFIG=""
if [ -n "$CORS_ALLOWED_ORIGINS" ]; then
  # Build YAML list from comma-separated env var
  ORIGINS_YAML=""
  OLD_IFS="$IFS"; IFS=","
  for origin in $CORS_ALLOWED_ORIGINS; do
    ORIGINS_YAML="${ORIGINS_YAML}
        - $origin"
  done
  IFS="$OLD_IFS"
  cat > /tmp/hydra-cors.yml << EOF
serve:
  public:
    cors:
      allowed_origins:$ORIGINS_YAML
EOF
  EXTRA_CONFIG="--config /tmp/hydra-cors.yml"
fi

# Run registration in background
register_clients &

# Start Hydra in foreground (pass through any extra args, e.g. --dev)
exec hydra serve all --config /etc/hydra/hydra.yml $EXTRA_CONFIG "$@"
