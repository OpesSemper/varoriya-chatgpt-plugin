import { isIP } from "node:net";

import type { UrlPolicyConfig } from "../config.js";
import { AppError } from "../errors.js";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Resolver injection keeps network I/O out of module initialization. */
export interface HostResolver {
  resolveAll(hostname: string): Promise<readonly ResolvedAddress[]>;
}

export interface ValidatedRemoteTarget {
  readonly url: URL;
  readonly resolvedAddresses: readonly ResolvedAddress[];
}

/**
 * SSRF guard for user-supplied remote media. The outbound client MUST connect
 * only to a returned IP and revalidate every redirect to prevent DNS rebinding.
 */
export class SsrfGuard {
  readonly #config: UrlPolicyConfig;
  readonly #resolver: HostResolver;

  public constructor(config: UrlPolicyConfig, resolver: HostResolver) {
    if (!resolver || typeof resolver.resolveAll !== "function") {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "A remote-host resolver is required for SSRF protection.",
      });
    }
    this.#config = config;
    this.#resolver = resolver;
  }

  public async validate(rawUrl: string): Promise<ValidatedRemoteTarget> {
    const url = parseRemoteUrl(rawUrl, this.#config);
    const hostname = normalizeHostname(url.hostname);
    const literalFamily = ipFamily(hostname);
    if (literalFamily !== undefined) {
      if (
        !this.#config.allowPublicIpLiterals ||
        isBlockedIpAddress(hostname, literalFamily)
      ) {
        throw unsafeUrl();
      }
      return Object.freeze({
        url,
        resolvedAddresses: Object.freeze([
          Object.freeze({ address: hostname, family: literalFamily }),
        ]),
      });
    }

    let resolved: readonly ResolvedAddress[];
    try {
      resolved = await this.#resolver.resolveAll(hostname);
    } catch (cause) {
      throw new AppError("UNSAFE_URL", {
        status: 400,
        message: "The remote media host could not be validated.",
        cause,
      });
    }
    if (resolved.length < 1 || resolved.length > 16) throw unsafeUrl();
    const deduplicated = new Map<string, ResolvedAddress>();
    for (const entry of resolved) {
      const address = normalizeHostname(entry.address);
      if (
        (entry.family !== 4 && entry.family !== 6) ||
        ipFamily(address) !== entry.family ||
        isBlockedIpAddress(address, entry.family)
      ) {
        throw unsafeUrl();
      }
      deduplicated.set(
        `${entry.family}:${address}`,
        Object.freeze({ address, family: entry.family }),
      );
    }
    return Object.freeze({
      url,
      resolvedAddresses: Object.freeze(Array.from(deduplicated.values())),
    });
  }
}

export function parseRemoteUrl(rawUrl: string, config: UrlPolicyConfig): URL {
  if (!config.enabled) throw unsafeUrl();
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length < 1 ||
    rawUrl.length > config.maxUrlLength ||
    /[\u0000-\u001f\u007f\\]/.test(rawUrl)
  ) {
    throw unsafeUrl();
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw unsafeUrl();
  }
  const allowedProtocol =
    url.protocol === "https:" ||
    (config.allowHttp && url.protocol === "http:");
  if (
    !allowedProtocol ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw unsafeUrl();
  }
  const hostname = normalizeHostname(url.hostname);
  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    localHostname(hostname) ||
    !isAllowedHost(hostname, config.allowedHosts)
  ) {
    throw unsafeUrl();
  }
  const effectivePort = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!config.allowedPorts.includes(effectivePort)) throw unsafeUrl();
  return url;
}

export function isAllowedHost(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const normalized = normalizeHostname(hostname);
  return allowedHosts.some((pattern) => {
    const allowed = normalizeHostname(pattern);
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(2);
      return (
        suffix.length > 0 &&
        normalized.endsWith(`.${suffix}`) &&
        normalized !== suffix
      );
    }
    return normalized === allowed;
  });
}

export function isBlockedIpAddress(address: string, family?: 4 | 6): boolean {
  const detectedFamily = family ?? ipFamily(address);
  if (detectedFamily === 4) return blockedIpv4(address);
  if (detectedFamily === 6) return blockedIpv6(address);
  return true;
}

function ipFamily(address: string): 4 | 6 | undefined {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  return family === 4 || family === 6 ? family : undefined;
}

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
    return true;
  }
  const a = octets[0]!;
  const b = octets[1]!;
  const c = octets[2]!;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:") ||
    /^(?:fc|fd)/.test(normalized) ||
    /^fe[89ab]/.test(normalized) ||
    /^ff/.test(normalized) ||
    /^2001:(?:0|2|1[0-9a-f]|2[0-9a-f])(?:[:]|$)/.test(normalized) ||
    /^2001:db8(?:[:]|$)/.test(normalized) ||
    /^2002(?:[:]|$)/.test(normalized)
  ) {
    return true;
  }
  // Conservatively accept only global-unicast 2000::/3.
  return !/^[23][0-9a-f]{0,3}:/.test(normalized);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function localHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /\.(?:local|internal|home|lan|test|invalid|example|onion)$/.test(hostname)
  );
}

function unsafeUrl(): AppError {
  return new AppError("UNSAFE_URL", {
    status: 400,
    message: "The remote media URL is not permitted.",
  });
}
