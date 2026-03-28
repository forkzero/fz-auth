import { describe, it, expect, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createKmsCrypto } from './index.js'

// Mock KMS client that simulates GenerateDataKey and Decrypt
function createMockKmsClient() {
  const dataKey = randomBytes(32)
  // Simulate "encrypted" DEK as the plaintext reversed (real KMS uses RSA envelope)
  const encryptedDataKey = Buffer.from([...dataKey].reverse())

  const send = vi.fn(async (command: { constructor: { name: string }; input?: Record<string, unknown> }) => {
    const name = command.constructor.name
    if (name === 'GenerateDataKeyCommand') {
      return {
        Plaintext: new Uint8Array(dataKey),
        CiphertextBlob: new Uint8Array(encryptedDataKey),
      }
    }
    if (name === 'DecryptCommand') {
      // Return the plaintext DEK for any encrypted DEK that matches
      const input = command.input as { CiphertextBlob: Uint8Array }
      const incoming = Buffer.from(input.CiphertextBlob)
      if (incoming.equals(encryptedDataKey)) {
        return { Plaintext: new Uint8Array(dataKey) }
      }
      throw new Error('InvalidCiphertextException')
    }
    throw new Error(`Unexpected command: ${name}`)
  })

  return { send, dataKey, encryptedDataKey }
}

describe('createKmsCrypto', () => {
  it('calls GenerateDataKey on creation', async () => {
    const mock = createMockKmsClient()
    await createKmsCrypto({
      keyId: 'alias/test-key',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      kmsClient: mock as any,
    })
    expect(mock.send).toHaveBeenCalledTimes(1)
    expect(mock.send.mock.calls[0][0].constructor.name).toBe('GenerateDataKeyCommand')
  })

  it('round-trips data through encrypt/decrypt', async () => {
    const mock = createMockKmsClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock as any })

    const data = { accessToken: 'test-token', expiresAt: Date.now() + 3600000 }
    const encrypted = await crypto.encrypt(data)
    const decrypted = await crypto.decrypt(encrypted)

    expect(decrypted).toEqual(data)
  })

  it('produces different ciphertext each time (random IV)', async () => {
    const mock = createMockKmsClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock as any })

    const data = { test: true }
    const a = await crypto.encrypt(data)
    const b = await crypto.encrypt(data)
    expect(a).not.toBe(b)
  })

  it('returns null for tampered ciphertext', async () => {
    const mock = createMockKmsClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock as any })

    const encrypted = await crypto.encrypt({ test: true })
    const tampered = encrypted.slice(0, -5) + 'XXXXX'
    expect(await crypto.decrypt(tampered)).toBeNull()
  })

  it('returns null for empty or short input', async () => {
    const mock = createMockKmsClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock as any })

    expect(await crypto.decrypt('')).toBeNull()
    expect(await crypto.decrypt('dG9v')).toBeNull() // "too" in base64
  })

  it('does not call KMS Decrypt for own DEK (cached)', async () => {
    const mock = createMockKmsClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock as any })

    const encrypted = await crypto.encrypt({ test: true })
    await crypto.decrypt(encrypted)

    // Only GenerateDataKey at startup — no Decrypt calls
    expect(mock.send).toHaveBeenCalledTimes(1)
  })

  it('ciphertext includes encrypted DEK for cold-start recovery', async () => {
    const mock = createMockKmsClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock as any })

    const encrypted = await crypto.encrypt({ test: true })
    const raw = Buffer.from(encrypted, 'base64')

    // First 2 bytes are DEK length, then the encrypted DEK
    const dekLen = raw.readUInt16BE(0)
    expect(dekLen).toBe(mock.encryptedDataKey.length)

    const embeddedDek = raw.subarray(2, 2 + dekLen)
    expect(embeddedDek.equals(mock.encryptedDataKey)).toBe(true)
  })

  it('deduplicates concurrent KMS Decrypt calls for the same DEK', async () => {
    // Create two crypto instances with different DEKs to simulate cold-start cross-decryption
    const mock1 = createMockKmsClient()
    const mock2 = createMockKmsClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto1 = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock1 as any })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto2 = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock2 as any })

    // Encrypt with crypto1, decrypt with crypto2 (simulates cold start)
    const encrypted = await crypto1.encrypt({ test: true })

    // Make mock2's Decrypt slow to trigger concurrent requests
    let decryptCallCount = 0
    mock2.send.mockImplementation(async (command: { constructor: { name: string }; input?: Record<string, unknown> }) => {
      if (command.constructor.name === 'DecryptCommand') {
        decryptCallCount++
        await new Promise((r) => setTimeout(r, 50))
        return { Plaintext: new Uint8Array(mock1.dataKey) }
      }
      return { Plaintext: new Uint8Array(mock2.dataKey), CiphertextBlob: new Uint8Array(mock2.encryptedDataKey) }
    })

    // Fire two concurrent decrypts
    const [result1, result2] = await Promise.all([
      crypto2.decrypt(encrypted),
      crypto2.decrypt(encrypted),
    ])

    expect(result1).toEqual({ test: true })
    expect(result2).toEqual({ test: true })
    // Only one KMS Decrypt call despite two concurrent requests
    expect(decryptCallCount).toBe(1)
  })

  it('propagates KMS errors instead of returning null', async () => {
    const mock1 = createMockKmsClient()
    const mock2 = createMockKmsClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto1 = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock1 as any })

    // Make mock2's Decrypt throw an access error
    mock2.send.mockImplementation(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'DecryptCommand') {
        throw new Error('AccessDeniedException: User is not authorized')
      }
      return { Plaintext: new Uint8Array(mock2.dataKey), CiphertextBlob: new Uint8Array(mock2.encryptedDataKey) }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crypto2 = await createKmsCrypto({ keyId: 'alias/test-key', kmsClient: mock2 as any })

    const encrypted = await crypto1.encrypt({ test: true })

    // KMS errors should propagate, not be swallowed as null
    await expect(crypto2.decrypt(encrypted)).rejects.toThrow('AccessDeniedException')
  })
})
