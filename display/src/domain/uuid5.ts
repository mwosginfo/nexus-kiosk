import { createHash } from 'node:crypto';

/**
 * RFC 4122 name-based UUID (version 5, SHA-1). Implemented here rather than
 * pulled from a dependency — it is 20 lines and the bridge runs unattended on
 * a Raspberry Pi, where every dependency is a thing that can break at 3am.
 *
 * Used to derive `eventId` deterministically from the call it represents, so
 * the same call always produces the same key: retries (and retries across a
 * process restart) reuse it and Qtech suppresses the duplicate, while a
 * genuinely new call or a deliberate recall produces a different one.
 */
export function uuidV5(name: string, namespace: string): string {
  const nsBytes = parseUuid(namespace);
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1')
    .update(Buffer.concat([nsBytes, nameBytes]))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  // Version 5
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // RFC 4122 variant
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function parseUuid(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID namespace: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}
