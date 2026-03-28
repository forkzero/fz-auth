# KMS Envelope Encryption

Replace the static `SESSION_SECRET` with AWS KMS envelope encryption. The master key never leaves KMS hardware (FIPS 140-2 Level 3).

## How it works

1. At startup, `createKmsCrypto()` calls `KMS.GenerateDataKey()` → gets a data encryption key (DEK)
2. The plaintext DEK is cached in memory for fast AES-256-GCM operations
3. Each encrypted cookie includes the encrypted DEK so it can be recovered on cold start
4. No KMS call per request — only at startup and when encountering DEKs from other instances

## Steps

### 1. Create a KMS key

```bash
aws kms create-key --description "fz-auth session encryption"
aws kms create-alias --alias-name alias/fz-auth-sessions \
  --target-key-id <key-id-from-above>
```

### 2. Install

```bash
npm install fz-auth-aws
```

### 3. Use in your app

```ts
import { createBffRoutes } from 'fz-auth'
import { createKmsCrypto } from 'fz-auth-aws/kms'

const crypto = await createKmsCrypto({
  keyId: process.env.KMS_KEY_ID!,  // e.g. alias/fz-auth-sessions
})

app.route('/auth', await createBffRoutes({
  issuerUrl: process.env.ISSUER_URL!,
  clientId: process.env.CLIENT_ID!,
  crypto,  // replaces encryptionKey
}))

app.use('/api/*', requiresAuth({ crypto }))
```

### 4. IAM permissions

The app's execution role needs:

```json
{
  "Effect": "Allow",
  "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
  "Resource": "arn:aws:kms:us-east-1:123456789:key/<key-id>"
}
```

### 5. Key rotation

Enable automatic key rotation in KMS:

```bash
aws kms enable-key-rotation --key-id alias/fz-auth-sessions
```

KMS handles rotation transparently. Old DEKs are still decryptable (KMS retains previous key versions). No code changes needed.
