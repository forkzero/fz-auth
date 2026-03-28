# Local Development Stack

Run Ory + your app + frontend in one terminal.

## Prerequisites

- Docker and Docker Compose
- Node.js 20+

## Directory structure

```
my-project/
├── server/           # Your Hono backend
├── frontend/         # Your React app
├── ory/              # Copy from fz-auth/ory/
├── docker-compose.yml
├── Procfile
└── .env
```

## Docker Compose for Ory

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  kratos-migrate:
    image: oryd/kratos:v26.2.0
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      DSN: postgres://kratos:kratos@postgres:5432/kratos?sslmode=disable
    volumes:
      - ./ory/kratos:/etc/kratos
    command: migrate sql -e --yes

  kratos:
    image: oryd/kratos:v26.2.0
    depends_on:
      kratos-migrate: { condition: service_completed_successfully }
    env_file:
      - path: .env
        required: false
    environment:
      DSN: postgres://kratos:kratos@postgres:5432/kratos?sslmode=disable
    volumes:
      - ./ory/kratos:/etc/kratos
    entrypoint: ["/etc/kratos/docker-entrypoint.sh"]
    command: ["--dev", "--watch-courier"]
    ports:
      - "127.0.0.1:4433:4433"
      - "127.0.0.1:4434:4434"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:4433/health/ready"]
      interval: 10s
      timeout: 5s
      retries: 5

  hydra-migrate:
    image: oryd/hydra:v26.2.0
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      DSN: postgres://hydra:hydra@postgres:5432/hydra?sslmode=disable
    command: migrate sql -e --yes

  hydra:
    image: oryd/hydra:v26.2.0
    depends_on:
      hydra-migrate: { condition: service_completed_successfully }
    environment:
      DSN: postgres://hydra:hydra@postgres:5432/hydra?sslmode=disable
      URLS_SELF_ISSUER: http://localhost:4444
      SECRETS_SYSTEM: dev-secret-change-in-production
      STRATEGIES_ACCESS_TOKEN: jwt
    command: serve all --config /etc/hydra/hydra.yml --dev
    volumes:
      - ./ory/hydra:/etc/hydra
    ports:
      - "127.0.0.1:4444:4444"
      - "127.0.0.1:4445:4445"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:4444/health/ready"]
      interval: 10s
      timeout: 5s
      retries: 5
```

## Process manager (Honcho)

```bash
pip install honcho
```

```ini
# Procfile
infra:    docker compose up
server:   cd server && npm run dev
frontend: cd frontend && npm run dev
```

```bash
honcho start
```

All three processes run in one terminal with labeled output.

## Port allocation

| Service | Port |
|---------|------|
| PostgreSQL | 5432 |
| Kratos Public | 4433 |
| Kratos Admin | 4434 |
| Hydra Public | 4444 |
| Hydra Admin | 4445 |
| Your backend | 3000 |
| Your frontend | 5173 |

## Common issues

**Port already in use**: Run `docker compose down` to clean up stale containers before restarting.

**Containers with different project names**: Docker Compose uses the directory name as the project name. If you run from different directories, you get duplicate containers. Use `docker compose down --remove-orphans`.

**Kratos validation errors**: If Kratos fails with "missing properties: client_id", ensure your `.env` has `GOOGLE_OAUTH_CLIENT_ID` set (or remove the OIDC provider from `kratos.yml`).
