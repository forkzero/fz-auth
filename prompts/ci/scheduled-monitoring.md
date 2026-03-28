# Scheduled Monitoring (DIY Synthetics)

Run your smoke tests and security checks on a schedule. Get Slack alerts on failure. Replaces Datadog Synthetics for $0/month.

## What you get

- Smoke tests + security checks running every 5 minutes
- Slack notification on failure (with which test failed and why)
- Test history in GitHub Actions logs
- Works with the same vitest tests you already have

## Setup

### 1. Create the workflow

```yaml
# .github/workflows/monitor.yml
name: Monitor

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:         # Manual trigger for testing

jobs:
  smoke-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run smoke tests
        id: smoke
        working-directory: test
        continue-on-error: true
        run: |
          npm install --ignore-scripts
          npx vitest run smoke-test 2>&1 | tee smoke-output.txt
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
        env:
          APP_URL: ${{ vars.APP_URL }}
          ISSUER_URL: ${{ vars.ISSUER_URL }}

      - name: Run security checks
        id: security
        working-directory: test
        continue-on-error: true
        run: |
          npx vitest run security-check 2>&1 | tee security-output.txt
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
        env:
          APP_URL: ${{ vars.APP_URL }}
          ISSUER_URL: ${{ vars.ISSUER_URL }}

      - name: Notify Slack on failure
        if: steps.smoke.outcome == 'failure' || steps.security.outcome == 'failure'
        run: |
          FAILED_TESTS=""
          if [ "${{ steps.smoke.outcome }}" = "failure" ]; then
            FAILED_TESTS="Smoke tests failed\n$(tail -20 test/smoke-output.txt)"
          fi
          if [ "${{ steps.security.outcome }}" = "failure" ]; then
            FAILED_TESTS="${FAILED_TESTS}\nSecurity checks failed\n$(tail -20 test/security-output.txt)"
          fi

          curl -X POST "${{ secrets.SLACK_WEBHOOK_URL }}" \
            -H 'Content-Type: application/json' \
            -d "{
              \"text\": \":rotating_light: Auth monitoring alert\",
              \"blocks\": [
                {
                  \"type\": \"section\",
                  \"text\": {
                    \"type\": \"mrkdwn\",
                    \"text\": \":rotating_light: *Auth monitoring failed*\n\`\`\`${FAILED_TESTS}\`\`\`\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View logs>\"
                  }
                }
              ]
            }"

      - name: Fail the workflow if any test failed
        if: steps.smoke.outcome == 'failure' || steps.security.outcome == 'failure'
        run: exit 1
```

### 2. Set up Slack webhook

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From Scratch
2. Add feature → Incoming Webhooks → Activate → Add New Webhook to Workspace
3. Pick a channel (e.g., `#alerts`)
4. Copy the webhook URL
5. Add as repository secret: `SLACK_WEBHOOK_URL`

### 3. Set up environment variables

Add these as repository variables (Settings → Variables):

```
APP_URL=https://your-app.com
ISSUER_URL=https://your-idp.com
```

### 4. Test it

```bash
gh workflow run monitor.yml
```

Check the Actions tab — you should see the tests run and (if everything passes) no Slack notification.

## What this covers

| Check | Frequency | Alert |
|-------|-----------|-------|
| App health (reachable, responds) | 5 min | Slack |
| OIDC discovery (IdP endpoints available) | 5 min | Slack |
| Login flow (redirects correctly with PKCE) | 5 min | Slack |
| CORS policy (rejects evil origins) | 5 min | Slack |
| Auth enforcement (401 without token) | 5 min | Slack |
| Security headers (HSTS, CSP, X-Frame) | 5 min | Slack |
| Cookie attributes (HttpOnly, Secure, SameSite) | 5 min | Slack |
| Error handling (no stack traces leaked) | 5 min | Slack |

## Cost

$0. GitHub Actions free tier includes 2,000 minutes/month. At ~1 minute per run, 5-minute intervals = ~8,640 minutes/month. You'll need a paid plan ($4/month for 3,000 minutes) or reduce frequency to every 15 minutes (2,880 minutes/month — fits in free tier).

Compare: Datadog Synthetics starts at $5/test/month. For 8 tests at 5-minute intervals = $40/month.

## Multi-location (optional)

To run from multiple regions, create a matrix:

```yaml
strategy:
  matrix:
    region: [us-east-1, eu-west-1, ap-southeast-1]
runs-on: ubuntu-latest
# Each region runs the same tests — if any fail, you get alerted
```

GitHub Actions runners are US-based, so this only changes the runner, not the test origin. For true multi-region, deploy the test suite as a Lambda in each region and trigger via EventBridge:

```bash
# Deploy test runner to multiple regions
aws lambda create-function --region us-east-1 ...
aws lambda create-function --region eu-west-1 ...
aws events put-rule --schedule-expression "rate(5 minutes)" --region us-east-1
aws events put-rule --schedule-expression "rate(5 minutes)" --region eu-west-1
```

## Adding new checks

Add tests to `smoke-test.test.ts` or `security-check.test.ts`. They automatically run on the next schedule. No dashboard config, no UI clicks — just code.
