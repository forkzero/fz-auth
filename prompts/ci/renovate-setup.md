# Renovate for Dependency Updates

Auto-open PRs when dependencies have new versions. CI runs against the PR — merge when green.

## Steps

### 1. Install the Renovate GitHub App

Go to [github.com/apps/renovate](https://github.com/apps/renovate) → Install → select your repo.

### 2. Add config

```json
// renovate.json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "labels": ["dependencies"],
  "packageRules": [
    {
      "description": "Group patch/minor updates weekly",
      "matchUpdateTypes": ["patch", "minor"],
      "groupName": "dependencies (patch/minor)",
      "schedule": ["before 9am on monday"]
    }
  ]
}
```

### 3. For Docker image updates

Add custom managers to detect versions in Dockerfiles and config files:

```json
{
  "customManagers": [
    {
      "customType": "regex",
      "fileMatch": ["Dockerfile$"],
      "matchStrings": ["ARG ORY_VERSION=(?<currentValue>[^\\s]+)"],
      "depNameTemplate": "oryd/kratos",
      "datasourceTemplate": "docker",
      "versioningTemplate": "docker"
    }
  ]
}
```

### 4. What happens

- Renovate scans your repo on schedule
- Opens PRs with version bumps (grouped by severity)
- CI runs against the PR
- You review and merge
- Done

No manual dependency tracking. No "npm outdated" sprints.
