import dns from 'node:dns/promises';
import net from 'node:net';

export const ALLOWED_SAMPLE_PROFILES = [
  'compliant-ops',
  'hallucinator-bot',
  'tool-rogue',
  'loop-runner',
  'flaky-inconsistent',
  'timeout-prone',
] as const;

export type SampleProfile = (typeof ALLOWED_SAMPLE_PROFILES)[number];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  '0.0.0.0',
  '::1',
]);

export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
    if (lower.startsWith('fe80')) return true; // Link-local fe80::/10
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      if (net.isIPv4(mapped)) return isPrivateOrReservedIp(mapped);
    }
    return false;
  }

  return true;
}

export interface SsrfCheckResult {
  allowed: boolean;
  resolvedUrl?: string;
  reason?: string;
}

export async function validateTargetUrl(
  rawUrl: string,
  options: { isControlledSample?: boolean; sampleProfile?: string | null; serverPort?: number } = {}
): Promise<SsrfCheckResult> {
  const trimmed = rawUrl.trim();
  const port = options.serverPort ?? Number(process.env.PORT || 3000);

  if (options.isControlledSample) {
    const expectedPath = `/api/sample-agents/${options.sampleProfile || ''}`;
    if (
      options.sampleProfile &&
      (ALLOWED_SAMPLE_PROFILES as readonly string[]).includes(options.sampleProfile) &&
      (trimmed === expectedPath || trimmed.endsWith(expectedPath))
    ) {
      return {
        allowed: true,
        resolvedUrl: `http://127.0.0.1:${port}/api/sample-agents/${options.sampleProfile}`,
      };
    }
    return {
      allowed: false,
      reason: 'Controlled sample flag may only target registered built-in diagnostic agent profiles.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { allowed: false, reason: 'Invalid URL format. Provide an absolute http:// or https:// URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { allowed: false, reason: `Disallowed protocol "${parsed.protocol}". Only HTTP/HTTPS are permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    return {
      allowed: false,
      reason: `SSRF policy blocked restricted internal hostname "${hostname}".`,
    };
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return {
        allowed: false,
        reason: `SSRF policy blocked private or reserved IP address "${hostname}".`,
      };
    }
    return { allowed: true, resolvedUrl: parsed.toString() };
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) {
      return { allowed: false, reason: `DNS lookup returned no addresses for "${hostname}".` };
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        return {
          allowed: false,
          reason: `SSRF policy blocked "${hostname}" resolving to private/reserved IP ${rec.address}.`,
        };
      }
    }
  } catch (err) {
    return {
      allowed: false,
      reason: `DNS resolution failed for "${hostname}": ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }

  return { allowed: true, resolvedUrl: parsed.toString() };
}
