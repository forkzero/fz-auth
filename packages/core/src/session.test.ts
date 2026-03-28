import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, createAesCrypto } from './session.js'
import type { BffSession } from './types.js'

const testKey = randomBytes(32).toString('hex')

const testSession: BffSession = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.test-access-token',
  refreshToken: 'test-refresh-token',
  idToken: 'test-id-token',
  expiresAt: Date.now() + 3600000,
}

describe('BFF session encryption', () => {
  it('round-trips a session through encrypt/decrypt', () => {
    const encrypted = encrypt(testSession, testKey)
    const decrypted = decrypt(encrypted, testKey)
    expect(decrypted).toEqual(testSession)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const a = encrypt(testSession, testKey)
    const b = encrypt(testSession, testKey)
    expect(a).not.toBe(b)
  })

  it('returns null for tampered ciphertext', () => {
    const encrypted = encrypt(testSession, testKey)
    const tampered = encrypted.slice(0, -5) + 'XXXXX'
    expect(decrypt(tampered, testKey)).toBeNull()
  })

  it('returns null for wrong key', () => {
    const encrypted = encrypt(testSession, testKey)
    const wrongKey = randomBytes(32).toString('hex')
    expect(decrypt(encrypted, wrongKey)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(decrypt('', testKey)).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(decrypt('not-base64!!!', testKey)).toBeNull()
  })

  it('accepts base64-encoded 32-byte key', () => {
    const b64Key = randomBytes(32).toString('base64')
    const encrypted = encrypt(testSession, b64Key)
    const decrypted = decrypt(encrypted, b64Key)
    expect(decrypted).toEqual(testSession)
  })

  it('rejects invalid key length', () => {
    expect(() => encrypt(testSession, 'too-short')).toThrow('encryptionKey must be a 32-byte key')
  })

  it('createAesCrypto round-trips through SessionCrypto interface', async () => {
    const crypto = createAesCrypto(testKey)
    const encrypted = await crypto.encrypt(testSession)
    const decrypted = await crypto.decrypt(encrypted)
    expect(decrypted).toEqual(testSession)
  })

  it('createAesCrypto validates key at creation time', () => {
    expect(() => createAesCrypto('bad-key')).toThrow('encryptionKey must be a 32-byte key')
  })

  it('session with realistic JWTs fits in 4KB cookie limit', () => {
    // Hydra JWTs are typically ~800 bytes
    const largeSession: BffSession = {
      accessToken: 'a'.repeat(800),
      refreshToken: 'r'.repeat(200),
      idToken: 'i'.repeat(800),
      expiresAt: Date.now() + 86400000,
    }
    const encrypted = encrypt(largeSession, testKey)
    expect(encrypted.length).toBeLessThan(4096)
  })
})
