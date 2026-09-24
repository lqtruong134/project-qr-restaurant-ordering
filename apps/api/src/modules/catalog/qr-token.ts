import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(secret: string) {
  if (secret.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters.');
  return createHash('sha256').update(secret).digest();
}

export function encryptQrToken(token: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decryptQrToken(payload: string, secret: string) {
  const bytes = Buffer.from(payload, 'base64url');
  if (bytes.length < 28) throw new Error('Invalid QR token ciphertext.');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
