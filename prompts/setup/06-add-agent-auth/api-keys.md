# Add API Key Auth for Agents

Give non-human actors (CLI tools, CI pipelines, AI agents) their own identity via API keys with agent metadata.

## How it works

1. A human creates an API key and assigns it to an agent: `agentId: "claude-code"`
2. The agent uses the API key as a Bearer token
3. Your backend introspects the key to get the user, org, scopes, and agent identity
4. Audit logs show: "user X via agent Y performed action Z"

## Backend setup

```ts
app.use('/api/*', requiresAuth({ encryptionKey: process.env.SESSION_SECRET! }))

app.post('/api/work', async (c) => {
  const token = c.get('accessToken')

  // For API key requests, introspect to get agent context
  const introspection = await fetch(`${AUTH_API_URL}/api/v1/token/introspect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceToken}`,
    },
    body: JSON.stringify({ token }),
  }).then(r => r.json())

  console.log(`Action by ${introspection.user.email} via ${introspection.agentId ?? 'browser'}`)
})
```

## Creating agent API keys

```bash
curl -X POST https://your-auth-api/api/v1/api-keys \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Claude Code - Lattice",
    "organizationId": "org-123",
    "scopes": ["projects:write"],
    "agentId": "claude-code"
  }'
```

The response includes the raw key (shown once):
```json
{
  "id": "key-abc",
  "name": "Claude Code - Lattice",
  "prefix": "fz_live_abc1",
  "rawKey": "fz_live_abc123...",
  "agentId": "claude-code",
  "scopes": ["projects:write"]
}
```

## Agent usage

The agent uses the key as a Bearer token:

```bash
curl https://your-app/api/work \
  -H "Authorization: Bearer fz_live_abc123..."
```

## Introspection response

```json
{
  "active": true,
  "tokenType": "api_key",
  "user": { "id": "user-1", "email": "george@forkzero.com" },
  "scopes": ["projects:write"],
  "agentId": "claude-code"
}
```

The `agentId` field tells you which agent performed the action — essential for audit trails in agentic systems.
