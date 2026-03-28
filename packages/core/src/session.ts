import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SessionCrypto } from './types.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function deriveKey(secret: string): Buffer {
  // Accept hex (64 chars) or base64 (44 chars) encoded 32-byte keys
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, 'hex')
  const buf = Buffer.from(secret, 'base64')
  if (buf.length === 32) return buf
  throw new Error('encryptionKey must be a 32-byte key encoded as hex (64 chars) or base64 (44 chars)')
}

export function encrypt<T>(data: T, secret: string): string {
  const key = deriveKey(secret)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const json = JSON.stringify(data)
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decrypt<T>(encoded: string, secret: string): T | null {
  try {
    const key = deriveKey(secret)
    const raw = Buffer.from(encoded, 'base64')
    if (raw.length < IV_LENGTH + TAG_LENGTH + 1) return null
    const iv = raw.subarray(0, IV_LENGTH)
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(decrypted.toString('utf8')) as T
  } catch {
    return null
  }
}

/**
 * Create a SessionCrypto implementation using built-in AES-256-GCM.
 * This is the default when `encryptionKey` is passed to BFF options.
 */
export function createAesCrypto(secret: string): SessionCrypto {
  // Validate key eagerly so misconfiguration fails at startup, not at first request
  deriveKey(secret)
  return {
    async encrypt(data: unknown): Promise<string> {
      return encrypt(data, secret)
    },
    async decrypt(encoded: string): Promise<unknown | null> {
      return decrypt(encoded, secret)
    },
  }
}
