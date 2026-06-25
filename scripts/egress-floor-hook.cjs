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

function patchConnect(moduleName, targetFromArgs, source, keys) {
  for (const key of keys) {
    const original = source[key];
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

module.exports = {
  MODE,
  assertAllowed,
  blockedError,
  describeAllowlist,
  isAllowedHost,
  isLoopbackHost,
  normalizeHost,
  parseAllowlist,
  targetFromHttpArgs,
  targetFromNetArgs,
};
