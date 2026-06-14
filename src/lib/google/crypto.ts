// ============================================================================
// Encryption for Google refresh tokens at rest. Google refresh tokens are
// long-lived credentials that let us mint calendar access without the studio
// owner present, so we never store them in plaintext. We use AES-256-GCM
// (authenticated encryption) keyed by TOKEN_ENCRYPTION_KEY.
//
// Stored format is a single string: base64(iv).base64(authTag).base64(cipher).
// The dotted layout keeps the three parts together in one DB column while
// staying trivially splittable on read.
// ============================================================================
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce is the standard size for GCM.

// Derive a 32-byte key from TOKEN_ENCRYPTION_KEY. The env value is expected to
// be a base64 secret from `openssl rand -base64 32`, but we tolerate a raw
// string too: if base64 decoding doesn't yield 32 bytes we fall back to the
// UTF-8 bytes, padded/truncated to 32 so the cipher always gets a valid key.
function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  }

  const fromB64 = Buffer.from(raw, "base64");
  if (fromB64.length === 32) return fromB64;

  const fromUtf8 = Buffer.from(raw, "utf8");
  if (fromUtf8.length === 32) return fromUtf8;

  // Normalize anything else to exactly 32 bytes so we never throw at runtime
  // on a slightly-off secret — but the operator should use a real 32-byte key.
  const key = Buffer.alloc(32);
  fromUtf8.copy(key);
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token");
  }
  const decipher = createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
