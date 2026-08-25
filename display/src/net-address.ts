/**
 * Address classification for the two very different legs the bridge speaks on.
 *
 * Qtech confirmed (2026-08-20) that the new TCP protocol carries no TLS and no
 * authentication, on the grounds that the bridge and the Qtech equipment are
 * both on the office premises. That is a reasonable position for a link that
 * never leaves the building — and an unacceptable one for a link that does.
 *
 * So the rule is not "plaintext is fine now". It is: plaintext is permitted
 * only to a private address. Point the bridge at a public host with no TLS and
 * it refuses to start, because at that point the traffic is crossing networks
 * we do not control and the on-premises justification no longer holds.
 */

/** RFC 1918 / loopback / link-local / unique-local, plus LAN-style names. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (host === 'localhost') return true;

  // IPv6
  if (host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique-local
  if (host.startsWith('fe80:')) return true; // link-local

  // IPv4
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1, 5).map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
    const [a, b] = octets as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  // LAN-style names: mDNS, common private suffixes, and single-label hostnames
  // (a bare name with no dot cannot be a public FQDN).
  if (/\.(local|lan|internal|intranet|home\.arpa)$/.test(host)) return true;
  if (!host.includes('.')) return true;

  return false;
}

/**
 * A URL is acceptable when it is TLS, or when it is plaintext to a private
 * address. Used for the Qtech leg, which is now plaintext by design.
 */
export function isSecureOrPrivate(raw: string): boolean {
  const url = parse(raw);
  if (!url) return false;
  if (url.protocol === 'https:' || url.protocol === 'wss:') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'ws:') return false;
  return isPrivateHost(url.hostname);
}

/**
 * A URL must be TLS. Used for the Supabase leg, which carries the service
 * key and crosses the internet — the one place on this bridge where a
 * downgrade actually costs something. Loopback is exempt so the tests can run
 * against a local stub.
 */
export function isTlsOrLoopback(raw: string): boolean {
  const url = parse(raw);
  if (!url) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
