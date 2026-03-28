# Deploy on AWS App Runner

The simplest AWS deployment. No load balancers, no capacity planning, auto-scales, HTTPS built-in.

## When to use

- Small team, low ops overhead
- < 10K requests/minute
- Don't need sidecars or multi-port services

## Prerequisites

- AWS account with CDK bootstrapped (`npx cdk bootstrap`)
- GitHub Actions OIDC configured (see `aws-oidc-setup.md`)
- ECR repository for your app image

## Steps

### 1. Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 2. Push to ECR

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t my-app .
docker tag my-app:latest $ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/my-app:latest
docker push $ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/my-app:latest
```

### 3. Create App Runner service

```bash
aws apprunner create-service \
  --service-name my-app \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "'$ACCOUNT_ID'.dkr.ecr.us-east-1.amazonaws.com/my-app:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "ISSUER_URL": "https://your-idp.com",
          "CLIENT_ID": "your-client-id"
        },
        "RuntimeEnvironmentSecrets": {
          "SESSION_SECRET": "arn:aws:secretsmanager:us-east-1:'$ACCOUNT_ID':secret:my-app/session-secret"
        }
      }
    },
    "AutoDeploymentsEnabled": false,
    "AuthenticationConfiguration": {
      "AccessRoleArn": "'$ECR_ACCESS_ROLE_ARN'"
    }
  }' \
  --instance-configuration '{"Cpu": "0.25 vCPU", "Memory": "0.5 GB"}' \
  --health-check-configuration '{"Protocol": "HTTP", "Path": "/auth/session"}'
```

### 4. Store session secret

```bash
# Generate a 32-byte key
SESSION_SECRET=$(openssl rand -hex 32)

# Store in Secrets Manager
aws secretsmanager create-secret \
  --name my-app/session-secret \
  --secret-string "$SESSION_SECRET"
```

### 5. Custom domain (optional)

```bash
aws apprunner associate-custom-domain \
  --service-arn $SERVICE_ARN \
  --domain-name app.yourdomain.com
```

App Runner provides CNAME records for DNS validation. Add them to your DNS provider, then HTTPS works automatically.

### 6. Deploy workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr

      - name: Build and push
        run: |
          docker build -t ${{ steps.ecr.outputs.registry }}/my-app:latest .
          docker push ${{ steps.ecr.outputs.registry }}/my-app:latest

      - name: Trigger deployment
        run: |
          SERVICE_ARN=$(aws apprunner list-services \
            --query "ServiceSummaryList[?ServiceName=='my-app'].ServiceArn" \
            --output text)
          aws apprunner start-deployment --service-arn "$SERVICE_ARN"

      - name: Wait for deployment
        run: |
          SERVICE_ARN=$(aws apprunner list-services \
            --query "ServiceSummaryList[?ServiceName=='my-app'].ServiceArn" \
            --output text)
          for i in $(seq 1 60); do
            STATUS=$(aws apprunner describe-service \
              --service-arn "$SERVICE_ARN" \
              --query "Service.Status" --output text)
            if [ "$STATUS" = "RUNNING" ]; then break; fi
            echo "Status: $STATUS ($i/60)"
            sleep 15
          done

      - name: Smoke test
        run: |
          curl -sf https://app.yourdomain.com/auth/session || exit 0  # 401 is OK
```

## Cost

| Component | Monthly |
|-----------|---------|
| App Runner (0.25 vCPU, low traffic) | ~$5-15 |
| ECR (image storage) | ~$1 |
| Secrets Manager | ~$0.50 |
| **Total** | **~$7-17** |

## Gotchas

- **One port per service.** If you need Ory (Kratos + Hydra), each needs its own App Runner service.
- **No exec into containers.** Debug via logs only. If you need shell access, use ECS Fargate.
- **Secrets via env vars only.** No sidecar or init container to fetch secrets — use `RuntimeEnvironmentSecrets` which pulls from Secrets Manager at startup.
- **`__Host-` cookies require HTTPS.** App Runner provides HTTPS by default, but in local dev you'll need to use non-prefixed cookies or a local HTTPS proxy.
