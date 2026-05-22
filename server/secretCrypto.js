import crypto from "node:crypto";

const ENCRYPTION_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export function encryptSecret(value) {
  if (!value || isEncryptedSecret(value)) {
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    return value;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value) {
  if (!value || !isEncryptedSecret(value)) {
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to decrypt stored OAuth tokens");
  }

  const [, , ivText, authTagText, encryptedText] = String(value).split(":");
  if (!ivText || !authTagText || !encryptedText) {
    throw new Error("Invalid encrypted secret format");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagText, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedSecret(value) {
  return String(value || "").startsWith(ENCRYPTION_PREFIX);
}

function getEncryptionKey() {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    return null;
  }

  const trimmedKey = rawKey.trim();
  const candidates = [
    Buffer.from(trimmedKey, "base64"),
    /^[a-f0-9]{64}$/i.test(trimmedKey) ? Buffer.from(trimmedKey, "hex") : null,
    Buffer.from(trimmedKey, "utf8"),
  ].filter(Boolean);

  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }

  return key;
}
