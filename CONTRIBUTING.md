# Contributing

## Setup

```bash
git clone https://github.com/forkzero/fz-auth.git
cd fz-auth
pnpm install
pnpm build
pnpm test
```

## Structure

- `packages/core` — Framework-agnostic BFF logic (no Hono/Express dependency)
- `packages/hono` — Hono adapter (the main `fz-auth` package)
- `packages/react` — React AuthProvider + useAuth
- `packages/aws` — AWS KMS envelope encryption
- `ory/` — Self-hosted Ory Kratos + Hydra starter kit
- `prompts/` — AI-native setup guides
- `examples/` — Runnable example apps

## Guidelines

- Keep the core framework-agnostic — no Hono imports in `packages/core`
- Keep the Hono adapter thin — delegate all logic to core
- Tests must pass: `pnpm test`
- Format with Prettier: `pnpm format`
- One feature = one PR

## Adding a new framework adapter

1. Create `packages/{framework}/`
2. Import `createBffCore` from `fz-auth-core`
3. Write ~160 lines of cookie/redirect/response glue
4. Add tests that mirror `packages/hono/src/routes.test.ts`

## Adding a new prompt

Prompts are executable instructions, not documentation. Each prompt should:
- List prerequisites
- Provide exact code blocks (copy-pasteable)
- Include verification steps
- Work with Claude Code or any LLM assistant
