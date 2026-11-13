import crypto from 'node:crypto';

let ephemeralDevKey: Buffer | null = null;
let warnedEphemeralKey = false;

function getEncryptionKey(): Buffer {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (configured) {
    return crypto.createHash('sha256').update(configured).digest();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY must be set in production to encrypt or decrypt agent credentials.'
    );
  }

  if (!ephemeralDevKey) {
    ephemeralDevKey = crypto.randomBytes(32);
  }
  if (!warnedEphemeralKey) {
    warnedEphemeralKey = true;
    console.warn(
      '[security] CREDENTIAL_ENCRYPTION_KEY not set; using an ephemeral per-process AES-256 key for development.'
    );
  }
  return ephemeralDevKey;
}

export function encryptCredential(plaintext: string): {
  encrypted: string;
  hint: string;
} {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
  const trimmed = plaintext.trim();
  const suffix = trimmed.length >= 4 ? trimmed.slice(-4) : '••••';
  return {
    encrypted: payload,
    hint: `••••${suffix}`,
  };
}

export function decryptCredential(payload: string): string {
  const key = getEncryptionKey();
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
