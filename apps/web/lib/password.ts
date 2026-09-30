// Password hashing for the Credentials provider using Node's scrypt
// (memory-hard, NIST-recommended). Stored format:
//   scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, salt, hashHex] = parts;
    if (!nStr || !rStr || !pStr || !salt || !hashHex) return false;
    const derived = scryptSync(password, salt, KEY_LENGTH, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    });
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}
