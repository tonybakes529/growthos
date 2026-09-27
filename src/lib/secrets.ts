import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';

/** What goes in the database: ciphertext and the bits needed to open it, never the plaintext. */
export type Sealed = { ct: string; iv: string; tag: string };

function key(): Buffer {
  const raw = getEnv().ZAPIER_TOKEN_KEY;
  if (!raw) throw new Error('ZAPIER_TOKEN_KEY is not set, so tokens cannot be stored safely');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ZAPIER_TOKEN_KEY must be 32 bytes, base64 encoded');
  return buf;
}

/** AES-256-GCM. The tag is what makes this tamper-evident rather than merely unreadable. */
export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ct: ct.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function open(sealed: Sealed): string {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]).toString('utf8');
}

/** True when tokens can be sealed at all. The UI uses this to decide between "connect" and "setup required". */
export function canSealSecrets(): boolean {
  try { key(); return true; } catch { return false; }
}
