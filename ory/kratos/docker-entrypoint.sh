#!/bin/sh
set -e

# Detect if this is a 'serve' invocation or a pass-through command (migrate, etc.)
# docker-compose passes: ["--dev", "--watch-courier"] (flags for serve)
# CDK migration passes: ["migrate", "sql", "-e", "--yes"]
# Dockerfile CMD (prod): no args → defaults to serve
case "${1:-serve}" in
  serve|--*)
    # Inject OIDC config when Google credentials are provided
    EXTRA_CONFIG=""
    if [ -n "$GOOGLE_OAUTH_CLIENT_ID" ]; then
      umask 077
      cat > /tmp/oidc-secrets.yml << EOF
selfservice:
  methods:
    oidc:
      enabled: true
      config:
        providers:
          - id: google
            provider: google
            client_id: $GOOGLE_OAUTH_CLIENT_ID
            client_secret: $GOOGLE_OAUTH_CLIENT_SECRET
            mapper_url: file:///etc/kratos/oidc.google.jsonnet
            scope:
              - email
              - profile
EOF
      EXTRA_CONFIG="--config /tmp/oidc-secrets.yml"
    fi
    exec kratos serve --config /etc/kratos/kratos.yml $EXTRA_CONFIG "$@"
    ;;
  *)
    # Pass through to kratos directly (e.g., migrate sql -e --yes)
    exec kratos "$@"
    ;;
esac
