import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SessionCrypto } from 'fz-auth-core'

export interface KmsCryptoOptions {
  /** KMS key ID or alias ARN (e.g. alias/forkzero-session-key) */
  keyId: string
  /** AWS region (defaults to AWS_REGION env var) */
  region?: string
  /** Pre-configured KMS client (for testing or custom config) */
  kmsClient?: KMSClient
}

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

/**
 * Create a SessionCrypto backed by AWS KMS envelope encryption.
 *
 * Calls KMS.GenerateDataKey once at creation to obtain a data encryption key (DEK).
 * The plaintext DEK is cached in memory for fast AES-256-GCM operations.
 * Each ciphertext is prefixed with the encrypted DEK so it can be recovered
 * on a cold start via KMS.Decrypt.
 *
 * Master key never leaves KMS hardware (FIPS 140-2 Level 3).
 */
export async function createKmsCrypto(options: KmsCryptoOptions): Promise<SessionCrypto> {
  const { keyId, region } = options
  const kms = options.kmsClient ?? new KMSClient({ region })

  const { Plaintext, CiphertextBlob } = await kms.send(
    new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' }),
  )

  if (!Plaintext || !CiphertextBlob) {
    throw new Error('KMS GenerateDataKey returned empty key material')
  }

  const dek = Buffer.from(Plaintext)
  const encryptedDek = Buffer.from(CiphertextBlob)

  // Pre-compute the DEK length prefix (never changes)
  const dekLenPrefix = Buffer.alloc(2)
  dekLenPrefix.writeUInt16BE(encryptedDek.length)

  // Cache for DEKs from other instances (key rotation / cold start)
  const dekCache = new Map<string, Buffer>()
  // Deduplicates concurrent KMS.Decrypt calls for the same DEK
  const inflightDecrypts = new Map<string, Promise<Buffer>>()

  async function decryptDek(encrypted: Buffer): Promise<Buffer> {
    // Fast path: own DEK — no base64 encoding, no Map lookup
    if (encrypted.equals(encryptedDek)) return dek

    const cacheKey = encrypted.toString('base64')
    const cached = dekCache.get(cacheKey)
    if (cached) return cached

    // Deduplicate concurrent requests for the same unknown DEK
    const inflight = inflightDecrypts.get(cacheKey)
    if (inflight) return inflight

    const promise = kms
      .send(new DecryptCommand({ CiphertextBlob: encrypted }))
      .then(({ Plaintext: decrypted }) => {
        if (!decrypted) throw new Error('KMS Decrypt returned empty plaintext')
        const buf = Buffer.from(decrypted)
        dekCache.set(cacheKey, buf)
        return buf
      })
      .finally(() => {
        inflightDecrypts.delete(cacheKey)
      })

    inflightDecrypts.set(cacheKey, promise)
    return promise
  }

  return {
    async encrypt(data: unknown): Promise<string> {
      const iv = randomBytes(IV_LENGTH)
      const cipher = createCipheriv(ALGORITHM, dek, iv)
      const json = JSON.stringify(data)
      const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()

      // Format: [2-byte DEK length] [encrypted DEK] [IV] [auth tag] [ciphertext]
      return Buffer.concat([dekLenPrefix, encryptedDek, iv, tag, encrypted]).toString('base64')
    },

    async decrypt(encoded: string): Promise<unknown | null> {
      let raw: Buffer
      try {
        raw = Buffer.from(encoded, 'base64')
      } catch {
        return null
      }

      if (raw.length < 2) return null
      const dekLen = raw.readUInt16BE(0)
      const minLen = 2 + dekLen + IV_LENGTH + TAG_LENGTH + 1
      if (raw.length < minLen) return null

      const encDek = raw.subarray(2, 2 + dekLen)

      // KMS errors (permissions, network) propagate — only crypto/parse failures return null
      const plaintextDek = await decryptDek(encDek)

      try {
        const iv = raw.subarray(2 + dekLen, 2 + dekLen + IV_LENGTH)
        const tag = raw.subarray(2 + dekLen + IV_LENGTH, 2 + dekLen + IV_LENGTH + TAG_LENGTH)
        const ciphertext = raw.subarray(2 + dekLen + IV_LENGTH + TAG_LENGTH)

        const decipher = createDecipheriv(ALGORITHM, plaintextDek, iv)
        decipher.setAuthTag(tag)
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        return JSON.parse(decrypted.toString('utf8'))
      } catch {
        return null
      }
    },
  }
}
