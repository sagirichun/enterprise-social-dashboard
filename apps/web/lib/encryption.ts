// AES-256-GCM encryption for secrets at rest (OAuth access/refresh tokens,
// AI provider API keys, RTMP stream keys).
//
// Wire format (base64):  iv (12 bytes) || authTag (16 bytes) || ciphertext.
// The key is derived from ENCRYPTION_KEY via scrypt. Generate it with:
//   openssl rand -base64 32

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT = 'dashboard-token-encryption-v1';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required (min 16 chars)',
    );
  }
  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

/** Encrypt a UTF-8 string; returns base64. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a payload produced by encrypt(). Throws on tampering / bad key. */
export function decrypt(payload: string): string {
  const data = Buffer.from(payload, 'base64');
  if (data.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Encrypted payload is too short');
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
