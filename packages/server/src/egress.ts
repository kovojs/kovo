import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Private-network egress policy for the app request shell (SPEC §9.5; secure-by-construction Phase 5).
 * Public destinations are unrestricted; private/special-use destinations require exact `host:port` entries.
 */
export interface AppEgressOptions {
  /**
   * Internal destinations the app intentionally exposes to server code.
   *
   * Entries are exact `host:port` pairs. Public/external destinations do not need
   * declarations; private, loopback, link-local, metadata, and other special-use
   * destinations fail closed unless this exact pair is listed.
   */
  allowInternal?: readonly string[];
}

/**
 * Normalized egress policy installed on a created app: printable `allowInternal` entries plus the guarded
 * lifecycle `fetch` function that enforces the private-network floor.
 */
export interface ResolvedAppEgressOptions {
  allowInternal: readonly string[];
  fetch: typeof fetch;
}

export interface EgressDecision {
  destination: string;
  host: string;
  ip: string;
  port: string;
  private: boolean;
}

export type EgressResolver = (hostname: string) => Promise<string>;

export interface EgressFetchOptions {
  fetch?: typeof fetch;
  resolver?: EgressResolver;
}

/** Error thrown when guarded lifecycle `fetch` blocks a private/special-use destination. */
export class EgressBlockedError extends Error {
  readonly destination: string;
  readonly host: string;
  readonly ip: string | undefined;
  readonly port: string;
  readonly status = 502;

  constructor(input: { destination: string; host: string; ip?: string; port: string }) {
    super(
      `Egress to ${input.destination} is blocked by Kovo's private-network deny floor. ` +
        'Add this exact host:port to `egress.allowInternal` if it is intended.',
    );
    this.name = 'EgressBlockedError';
    this.destination = input.destination;
    this.host = input.host;
    this.ip = input.ip;
    this.port = input.port;
  }
}

export function normalizeAppEgressOptions(
  options: AppEgressOptions | undefined,
  fetchOptions: EgressFetchOptions = {},
): ResolvedAppEgressOptions {
  const allowInternal = normalizeAllowInternal(options?.allowInternal ?? []);
  return {
    allowInternal,
    fetch: createEgressFetch({ allowInternal }, fetchOptions),
  };
}

export function createEgressFetch(
  options: Pick<ResolvedAppEgressOptions, 'allowInternal'>,
  fetchOptions: EgressFetchOptions = {},
): typeof fetch {
  const baseFetch = fetchOptions.fetch ?? globalThis.fetch.bind(globalThis);
  const resolver = fetchOptions.resolver ?? defaultResolver;

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const redirectMode = init?.redirect ?? 'follow';
    let request = new Request(input, { ...init, redirect: 'manual' });

    for (let hop = 0; hop <= 20; hop += 1) {
      await assertEgressAllowed(request.url, options.allowInternal, resolver);
      const response = await baseFetch(request);

      if (redirectMode === 'manual' || !isRedirectResponse(response)) return response;
      if (redirectMode === 'error') {
        throw new TypeError(`fetch failed: redirect from ${request.url} is not allowed`);
      }

      const location = response.headers.get('Location');
      if (location === null) return response;

      request = redirectedRequest(request, location, response.status);
    }

    throw new TypeError('fetch failed: redirect count exceeded');
  }) as typeof fetch;
}

export async function assertEgressAllowed(
  destination: string | URL,
  allowInternal: readonly string[],
  resolver: EgressResolver = defaultResolver,
): Promise<EgressDecision> {
  const url = new URL(destination);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      destination: url.href,
      host: url.hostname,
      ip: '',
      port: destinationPort(url),
      private: false,
    };
  }

  const host = normalizeHostname(url.hostname);
  const port = destinationPort(url);
  const destinationKey = `${host}:${port}`;
  const resolved = await resolveHostIp(host, resolver);
  const ip = normalizeIp(resolved);
  const privateDestination = isPrivateOrSpecialIp(ip);
  const decision = { destination: destinationKey, host, ip, port, private: privateDestination };

  if (!privateDestination) return decision;
  if (allowInternal.includes(destinationKey)) return decision;

  throw new EgressBlockedError({ destination: destinationKey, host, ip, port });
}

export function normalizeAllowInternal(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeAllowInternalEntry))].sort();
}

function normalizeAllowInternalEntry(value: string): string {
  const trimmed = value.trim();
  const match = /^(.*):(\d+)$/.exec(trimmed);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new TypeError(
      `Invalid egress.allowInternal entry "${value}". Use an exact host:port pair.`,
    );
  }

  return `${normalizeHostname(match[1])}:${match[2]}`;
}

async function defaultResolver(hostname: string): Promise<string> {
  if (isIP(hostname) !== 0) return hostname;
  const result = await lookup(hostname, { verbatim: true });
  return result.address;
}

async function resolveHostIp(host: string, resolver: EgressResolver): Promise<string> {
  const numericIp = parseIPv4Number(host);
  if (numericIp !== undefined) return numericIp;
  if (isIP(host) !== 0) return host;
  return resolver(host);
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

function destinationPort(url: URL): string {
  if (url.port !== '') return url.port;
  if (url.protocol === 'http:') return '80';
  if (url.protocol === 'https:') return '443';
  return '';
}

function normalizeIp(ip: string): string {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return mapped[1];

  const nat64 = lower.match(/^64:ff9b::([0-9a-f]+):([0-9a-f]+)$/);
  if (nat64?.[1] && nat64[2]) {
    const high = Number.parseInt(nat64[1], 16);
    const low = Number.parseInt(nat64[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }

  return lower;
}

function parseIPv4Number(host: string): string | undefined {
  const trimmed = host.toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return ipv4FromInteger(Number(trimmed));
  }

  const hexMatch = /^0x([0-9a-f]+)$/.exec(trimmed);
  if (hexMatch?.[1]) return ipv4FromInteger(Number.parseInt(hexMatch[1], 16));

  if (/^0[0-7]+$/.test(trimmed)) {
    return ipv4FromInteger(Number.parseInt(trimmed, 8));
  }

  return undefined;
}

function ipv4FromInteger(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return undefined;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
    '.',
  );
}

function isPrivateOrSpecialIp(ip: string): boolean {
  if (ip.includes('.')) return isPrivateOrSpecialIpv4(ip);
  return isPrivateOrSpecialIpv6(ip);
}

function isPrivateOrSpecialIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return a === 255 && b === 255 && c === 255 && d === 255;
}

function isPrivateOrSpecialIpv6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.startsWith('ff')) return true;
  if (ip.startsWith('2001:db8:')) return true;
  return false;
}

function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

function redirectedRequest(request: Request, location: string, status: number): Request {
  const url = new URL(location, request.url);
  const init: RequestInit = {
    headers: request.headers,
    method: request.method,
    redirect: 'manual',
  };

  if (status === 303 || ((status === 301 || status === 302) && request.method === 'POST')) {
    init.method = 'GET';
  }

  return new Request(url, init);
}
