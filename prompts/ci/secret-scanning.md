# Pre-commit Secret Scanning with detect-secrets

Block accidental commits of API keys, tokens, and private keys before they hit the repo. A baseline file holds known-good strings so existing fixtures don't trip the scanner.

## What you get

- Pre-commit hook that scans staged files for high-entropy strings and known credential patterns
- Baseline file recording any pre-existing matches that are confirmed safe
- One Makefile target that runs the same check locally and in CI

## Setup

### 1. Install detect-secrets

`detect-secrets` is a Python tool, so install it via pip (or pipx if you don't want it in your global Python env):

```bash
pip install detect-secrets
```

Document it as a prerequisite alongside Node, pnpm, and Docker in your README so contributors don't hit a missing-binary error on first commit.

### 2. Generate the baseline

Run once at the repo root. This scans the whole tree and records every hit it finds:

```bash
detect-secrets scan > .secrets.baseline
```

Open `.secrets.baseline`, review each `results` entry, and confirm the matches are non-secrets (fixtures, example values, public keys). Anything that turns out to be a real secret needs to be rotated — `detect-secrets` finding it on disk means git history found it too.

Commit the baseline. From here on, anything *new* the scanner flags is a build break; anything in the baseline is silently allowed.

### 3. Add a Makefile target

```makefile
detect-secrets:
	@git diff --staged --name-only -z | xargs -0 detect-secrets-hook --baseline .secrets.baseline

pre-commit: format-check detect-secrets
	@echo "Pre-commit checks passed."
```

The `-z` / `-0` pair is important — it handles filenames with spaces or shell metacharacters safely.

### 4. Wire into husky

`.husky/pre-commit`:

```sh
make pre-commit
```

Now `git commit` runs format checks and the secret scanner against staged files before the commit lands.

### 5. Triage workflow

When detect-secrets blocks a commit:

```bash
# Audit interactively — mark each match as a real secret or a false positive
detect-secrets audit .secrets.baseline

# Or regenerate the baseline from scratch (only if you've reviewed every match)
detect-secrets scan --baseline .secrets.baseline
```

If a real secret slipped through history, **rotate it first**, then purge from history (`git filter-repo`), then update the baseline.

### 6. CI guard

Add the same target to your CI workflow so PRs touching files outside a contributor's pre-commit hook still get scanned:

```yaml
- name: Detect secrets
  run: |
    pip install detect-secrets
    git diff --name-only origin/main...HEAD -z | xargs -0 detect-secrets-hook --baseline .secrets.baseline
```

## Gotchas

- **Baseline rot.** New high-entropy fixtures will trip the scanner. Audit and update the baseline in the same PR that introduces them — don't merge with the scanner disabled.
- **Plugin coverage.** `detect-secrets` ships with plugins for AWS keys, JWTs, Slack tokens, private keys, etc. — but custom token formats (e.g. `fz_live_*`) need a regex plugin or a baseline entry.
- **Pre-commit only sees staged files.** A file that was committed unscanned in the past won't be re-checked. The baseline + a one-time `detect-secrets scan` of the full tree covers the historical surface.
