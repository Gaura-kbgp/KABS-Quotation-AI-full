import 'server-only';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// scrypt, per OWASP guidance (N=2^15, r=8, p=1)
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const OPTS = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, OPTS);
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do the same work, so "no such user" and "wrong password" take equal time.
  const parts = (stored || '').split('$');
  const valid = parts.length === 4 && parts[0] === 'scrypt';
  const salt = valid ? Buffer.from(parts[2], 'base64') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(parts[3], 'base64') : Buffer.alloc(KEYLEN);
  const key = await scrypt(password, salt, KEYLEN, OPTS);
  return valid && key.length === expected.length && timingSafeEqual(key, expected);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use letters and at least one number.';
  return null;
}
