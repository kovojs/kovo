import { AsyncLocalStorage } from 'node:async_hooks';
import { lookup } from 'node:dns/promises';
import type { LookupOneOptions } from 'node:dns';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import type { DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as Http from 'node:http';
import type * as Https from 'node:https';
import type * as Net from 'node:net';
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import type { Dispatcher as UndiciDispatcher } from 'undici';

/**
 * Private-network egress policy for the app request shell (SPEC §9.5; secure-by-construction Phase 5).
 * Public destinations are unrestricted; private/special-use destinations require exact `host:port` entries.
 */
export interface AppEgressOptions {
  /**
   * Internal destinations the app intentionally exposes to server code.
   *
   * Entries are exact `host:port` pairs. Public/external destinations do not need
   * declarations; private, loopback, link-local, and other special-use
   * destinations fail closed unless this exact pair is listed. Metadata identity
   * endpoints are never enabled through this provenance-blind allowlist.
   */
  allowInternal?: readonly string[];
}

/**
 * Normalized egress policy installed on a created app: printable `allowInternal`
 * entries, non-blocking policy diagnostics, and the guarded lifecycle `fetch`
 * function that enforces the private-network floor.
 */
export interface ResolvedAppEgressOptions {
  allowInternal: readonly string[];
  diagnostics: readonly EgressDiagnostic[];
  fetch: typeof fetch;
}

/**
 * Non-blocking egress policy diagnostic surfaced on the app aggregate.
 *
 * SPEC §6.6 treats outbound egress as a runtime defense-in-depth floor, so broad
 * private-network openings remain visible even when they are permitted.
 */
export interface EgressDiagnostic {
  code: 'KV438';
  fileName: string;
  help?: string;
  message: string;
  severity?: DiagnosticSeverity;
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

export interface EgressNodeGuardOptions {
  allowInternal: readonly string[];
  resolver?: EgressResolver;
}

export interface EgressNodeGuard {
  uninstall(): void;
}

/** Provider callback wrapped by Kovo cloud credential helpers for metadata-capable runtimes. */
export type CloudMetadataCredentialProvider<T> = () => T | Promise<T>;

// SPEC §6.6: outbound egress is a fail-closed runtime floor; cloud identity metadata is privileged.
const metadataAllowed = new AsyncLocalStorage<{ on: true }>();
const nodeEgressGuardStateKey = Symbol.for('kovo.egress.nodeGuardState');
const egressBlockedGuidance = 'add this exact host:port to `egress.allowInternal` if intended';

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
  const diagnostics = egressAllowInternalDiagnostics(allowInternal);
  return {
    allowInternal,
    diagnostics,
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

export function installNodeEgressGuard(options: EgressNodeGuardOptions): EgressNodeGuard {
  const require = createRequire(import.meta.url);
  const http = require('node:http') as MutableHttpModule;
  const https = require('node:https') as MutableHttpsModule;
  const net = require('node:net') as MutableNetModule;
  const existing = currentNodeEgressGuardState();

  if (existing !== undefined) {
    if (!nodeEgressGuardStillInstalled(existing, http, https, net)) {
      throw new Error(
        'Kovo node egress guard was re-patched after install; refusing to stack another global patch.',
      );
    }
    return { uninstall() {} };
  }

  const resolver = options.resolver ?? defaultResolver;
  const originals = {
    httpGet: http.get,
    httpRequest: http.request,
    httpsGet: https.get,
    httpsRequest: https.request,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    socketConnect: Reflect.get(
      net.Socket.prototype,
      'connect',
    ) as typeof net.Socket.prototype.connect,
    undiciDispatcher: getGlobalDispatcher(),
  };

  const guardUrl = (protocol: 'http:' | 'https:', args: readonly unknown[]): readonly unknown[] => {
    const parsed = parseHttpRequestArgs(protocol, args);
    if (parsed === undefined) return args;
    assertEgressAllowedSync(parsed.url, options.allowInternal);

    const guardedOptions = {
      ...parsed.options,
      lookup: guardedLookup(
        parsed.url.hostname,
        destinationPort(parsed.url),
        options.allowInternal,
        resolver,
        parsed.options?.lookup,
      ),
    } as RequestOptions;

    if (parsed.options === undefined) {
      return [parsed.url, guardedOptions, parsed.callback].filter((value) => value !== undefined);
    }

    return parsed.rebuild(guardedOptions);
  };

  const guardConnect = (args: readonly unknown[]): readonly unknown[] => {
    const parsed = parseNetConnectArgs(args);
    if (parsed === undefined) return args;
    assertEgressAllowedForHost(parsed.host, String(parsed.port), options.allowInternal);
    const guardedOptions = {
      ...parsed.options,
      lookup: guardedLookup(
        parsed.host,
        String(parsed.port),
        options.allowInternal,
        resolver,
        parsed.options.lookup,
      ),
    } as ConnectOptions;
    return parsed.rebuild(guardedOptions);
  };

  http.request = function guardedHttpRequest(this: unknown, ...args: unknown[]) {
    return Reflect.apply(originals.httpRequest, this, guardUrl('http:', args));
  } as typeof http.request;
  http.get = function guardedHttpGet(this: unknown, ...args: unknown[]) {
    return Reflect.apply(originals.httpGet, this, guardUrl('http:', args));
  } as typeof http.get;
  https.request = function guardedHttpsRequest(this: unknown, ...args: unknown[]) {
    return Reflect.apply(originals.httpsRequest, this, guardUrl('https:', args));
  } as typeof https.request;
  https.get = function guardedHttpsGet(this: unknown, ...args: unknown[]) {
    return Reflect.apply(originals.httpsGet, this, guardUrl('https:', args));
  } as typeof https.get;
  net.connect = function guardedNetConnect(this: unknown, ...args: unknown[]) {
    return Reflect.apply(originals.netConnect, this, guardConnect(args));
  } as typeof net.connect;
  net.createConnection = function guardedNetCreateConnection(this: unknown, ...args: unknown[]) {
    return Reflect.apply(originals.netCreateConnection, this, guardConnect(args));
  } as typeof net.createConnection;
  net.Socket.prototype.connect = function guardedSocketConnect(
    this: Net.Socket,
    ...args: unknown[]
  ) {
    return Reflect.apply(originals.socketConnect, this, guardConnect(args));
  } as typeof net.Socket.prototype.connect;
  const dispatcher = createEgressDispatcher(originals.undiciDispatcher, options);
  setGlobalDispatcher(dispatcher);
  setNodeEgressGuardState({
    dispatcher,
    httpGet: http.get,
    httpRequest: http.request,
    httpsGet: https.get,
    httpsRequest: https.request,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    originals,
    socketConnect: Reflect.get(
      net.Socket.prototype,
      'connect',
    ) as typeof net.Socket.prototype.connect,
  });

  return {
    uninstall() {
      const state = currentNodeEgressGuardState();
      if (state !== undefined && !nodeEgressGuardStillInstalled(state, http, https, net)) {
        throw new Error(
          'Kovo node egress guard cannot safely uninstall because another patch replaced its hooks.',
        );
      }
      http.request = originals.httpRequest;
      http.get = originals.httpGet;
      https.request = originals.httpsRequest;
      https.get = originals.httpsGet;
      net.connect = originals.netConnect;
      net.createConnection = originals.netCreateConnection;
      net.Socket.prototype.connect = originals.socketConnect;
      setGlobalDispatcher(originals.undiciDispatcher);
      setNodeEgressGuardState(undefined);
    },
  };
}

export function createEgressDispatcher(
  dispatcher: UndiciDispatcher,
  options: EgressNodeGuardOptions,
): UndiciDispatcher {
  return new GuardedUndiciDispatcher(dispatcher, options);
}

export function createMetadataCredentialProvider<T>(
  provider: CloudMetadataCredentialProvider<T>,
): CloudMetadataCredentialProvider<T> {
  return () => metadataAllowed.run({ on: true }, provider);
}

/**
 * Wrap an AWS credential provider so lazy metadata refreshes run inside Kovo's
 * privileged metadata egress frame. Raw IMDS access remains blocked elsewhere.
 */
export function awsCredential<T>(
  provider: CloudMetadataCredentialProvider<T>,
): CloudMetadataCredentialProvider<T> {
  return createMetadataCredentialProvider(provider);
}

/**
 * Wrap a Google Cloud credential provider so metadata refreshes run inside
 * Kovo's privileged metadata egress frame.
 */
export function gcpCredential<T>(
  provider: CloudMetadataCredentialProvider<T>,
): CloudMetadataCredentialProvider<T> {
  return createMetadataCredentialProvider(provider);
}

/**
 * Wrap an Azure managed-identity credential provider so metadata refreshes run
 * inside Kovo's privileged metadata egress frame.
 */
export function azureCredential<T>(
  provider: CloudMetadataCredentialProvider<T>,
): CloudMetadataCredentialProvider<T> {
  return createMetadataCredentialProvider(provider);
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
  const resolved = await resolveHostIp(host, resolver);
  return assertEgressAllowedForHost(host, port, allowInternal, resolved);
}

export function normalizeAllowInternal(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeAllowInternalEntry))].sort();
}

export function egressAllowInternalDiagnostics(
  allowInternal: readonly string[],
): readonly EgressDiagnostic[] {
  return allowInternal.flatMap((entry, index) => {
    if (!isCidrAllowInternalEntry(entry)) return [];
    return [
      {
        code: 'KV438' as const,
        fileName: `egress.allowInternal[${index}]`,
        help: diagnosticDefinitions.KV438.help,
        message: `${diagnosticDefinitions.KV438.message} Entry "${entry}" is provenance-blind; prefer exact host:port entries.`,
        severity: diagnosticDefinitions.KV438.severity,
      },
    ];
  });
}

function normalizeAllowInternalEntry(value: string): string {
  const trimmed = value.trim();
  const match = /^(.*):(\d+)$/.exec(trimmed);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new TypeError(
      `Invalid egress.allowInternal entry "${value}". Use an exact host:port pair.`,
    );
  }

  const host = normalizeHostname(match[1]);
  if (host.includes('/')) {
    const cidr = parseIpv4Cidr(host);
    if (cidr === undefined) {
      throw new TypeError(
        `Invalid egress.allowInternal CIDR entry "${value}". Use an IPv4 CIDR plus port, for example 10.0.0.0/24:6379.`,
      );
    }
    return `${cidr.network}/${cidr.prefix}:${match[2]}`;
  }

  return `${host}:${match[2]}`;
}

async function defaultResolver(hostname: string): Promise<string> {
  if (isIP(hostname) !== 0) return hostname;
  const result = await lookup(hostname, { verbatim: true });
  return result.address;
}

type MutableHttpModule = typeof Http;
type MutableHttpsModule = typeof Https;
type MutableNetModule = typeof Net;
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;
type LookupFunction = (
  hostname: string,
  options: LookupOneOptions,
  callback: LookupCallback,
) => void;
type HttpRequestOptions = Http.RequestOptions & { lookup?: LookupFunction };
type HttpsRequestOptions = Https.RequestOptions & { lookup?: LookupFunction };
type RequestOptions = (Omit<HttpRequestOptions, 'lookup'> | Omit<HttpsRequestOptions, 'lookup'>) & {
  lookup?: LookupFunction;
};
type ConnectOptions = Omit<Net.TcpNetConnectOpts, 'lookup'> & {
  host?: string;
  lookup?: LookupFunction;
  port: number | string;
};

interface NodeEgressGuardState {
  dispatcher: UndiciDispatcher;
  httpGet: MutableHttpModule['get'];
  httpRequest: MutableHttpModule['request'];
  httpsGet: MutableHttpsModule['get'];
  httpsRequest: MutableHttpsModule['request'];
  netConnect: MutableNetModule['connect'];
  netCreateConnection: MutableNetModule['createConnection'];
  originals: {
    httpGet: MutableHttpModule['get'];
    httpRequest: MutableHttpModule['request'];
    httpsGet: MutableHttpsModule['get'];
    httpsRequest: MutableHttpsModule['request'];
    netConnect: MutableNetModule['connect'];
    netCreateConnection: MutableNetModule['createConnection'];
    socketConnect: typeof Net.Socket.prototype.connect;
    undiciDispatcher: UndiciDispatcher;
  };
  socketConnect: typeof Net.Socket.prototype.connect;
}

interface ParsedHttpRequestArgs {
  url: URL;
  options: RequestOptions | undefined;
  callback: unknown;
  rebuild(options: RequestOptions): readonly unknown[];
}

interface ParsedNetConnectArgs {
  host: string;
  port: number;
  options: ConnectOptions;
  rebuild(options: ConnectOptions): readonly unknown[];
}

function assertEgressAllowedForHost(
  hostInput: string,
  port: string,
  allowInternal: readonly string[],
  resolvedIp?: string,
): EgressDecision {
  const host = normalizeHostname(hostInput);
  const destinationKey = `${host}:${port}`;
  const ip = normalizeIp(resolvedIp ?? host);
  const privateDestination = isPrivateOrSpecialIp(ip);
  const metadataDestination = isMetadataDestination(host, port, ip);
  const decision = { destination: destinationKey, host, ip, port, private: privateDestination };

  if (metadataDestination && metadataAllowed.getStore()?.on === true) return decision;
  if (metadataDestination) throw blockEgress({ destination: destinationKey, host, ip, port });
  if (!privateDestination) return decision;
  if (allowInternalAllows(destinationKey, ip, port, allowInternal)) return decision;

  throw blockEgress({ destination: destinationKey, host, ip, port });
}

function assertEgressAllowedSync(destination: URL, allowInternal: readonly string[]): void {
  if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return;
  const host = normalizeHostname(destination.hostname);
  const numericIp = parseIPv4Number(host);
  if (numericIp !== undefined || isIP(host) !== 0) {
    assertEgressAllowedForHost(
      host,
      destinationPort(destination),
      allowInternal,
      numericIp ?? host,
    );
  }
}

function guardedLookup(
  host: string,
  port: string,
  allowInternal: readonly string[],
  resolver: EgressResolver,
  originalLookup: LookupFunction | undefined,
): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    const finish = (err: NodeJS.ErrnoException | null, address: string, family: number): void => {
      if (err !== null) {
        callback(err, address, family);
        return;
      }

      try {
        assertEgressAllowedForHost(host || hostname, port, allowInternal, address);
        callback(null, address, family);
      } catch (error) {
        callback(error as NodeJS.ErrnoException, address, family);
      }
    };

    if (originalLookup !== undefined) {
      originalLookup(hostname, lookupOptions, finish);
      return;
    }

    resolver(hostname).then(
      (address) => finish(null, address, isIP(address)),
      (error: NodeJS.ErrnoException) => finish(error, '', 0),
    );
  };
}

class GuardedUndiciDispatcher extends Dispatcher {
  private readonly dispatcher: UndiciDispatcher;
  private readonly allowInternal: readonly string[];
  private readonly resolver: EgressResolver;

  constructor(dispatcher: UndiciDispatcher, options: EgressNodeGuardOptions) {
    super();
    this.dispatcher = dispatcher;
    this.allowInternal = options.allowInternal;
    this.resolver = options.resolver ?? defaultResolver;
  }

  dispatch(
    options: UndiciDispatcher.DispatchOptions,
    handler: UndiciDispatcher.DispatchHandler,
  ): boolean {
    const destination = undiciDispatchDestination(options);
    if (destination === undefined) return this.dispatcher.dispatch(options, handler);

    void assertEgressAllowed(destination, this.allowInternal, this.resolver).then(
      () => {
        this.dispatcher.dispatch(options, handler);
      },
      (error: Error) => {
        handler.onResponseError?.(undefined as never, error);
      },
    );

    return true;
  }

  close(callback: () => void): void;
  close(): Promise<void>;
  close(callback?: () => void): Promise<void> | void {
    if (callback !== undefined) return this.dispatcher.close(callback);
    return this.dispatcher.close();
  }

  destroy(error: Error | null, callback: () => void): void;
  destroy(callback: () => void): void;
  destroy(error: Error | null): Promise<void>;
  destroy(): Promise<void>;
  destroy(
    errorOrCallback?: Error | null | (() => void),
    callback?: () => void,
  ): Promise<void> | void {
    if (typeof errorOrCallback === 'function') return this.dispatcher.destroy(errorOrCallback);
    if (callback !== undefined) return this.dispatcher.destroy(errorOrCallback ?? null, callback);
    if (errorOrCallback !== undefined) return this.dispatcher.destroy(errorOrCallback);
    return this.dispatcher.destroy();
  }
}

function undiciDispatchDestination(options: UndiciDispatcher.DispatchOptions): string | undefined {
  if (options.origin === undefined) {
    try {
      return new URL(options.path).href;
    } catch {
      return undefined;
    }
  }

  const origin = options.origin instanceof URL ? options.origin.href : options.origin;
  return new URL(options.path, origin).href;
}

function parseHttpRequestArgs(
  protocol: 'http:' | 'https:',
  args: readonly unknown[],
): ParsedHttpRequestArgs | undefined {
  const [first, second, third] = args;
  const callback = typeof args.at(-1) === 'function' ? args.at(-1) : undefined;

  if (first instanceof URL || typeof first === 'string') {
    const url = new URL(first.toString());
    const options = isRecord(second) ? (second as RequestOptions) : undefined;
    return {
      url,
      options,
      callback,
      rebuild(nextOptions) {
        if (options === undefined) return [url, nextOptions, callback].filter(isDefined);
        return [url, nextOptions, third].filter(isDefined);
      },
    };
  }

  if (isRecord(first)) {
    const options = first as RequestOptions;
    const url = urlFromRequestOptions(protocol, options);
    return {
      url,
      options,
      callback,
      rebuild(nextOptions) {
        return [nextOptions, second].filter(isDefined);
      },
    };
  }

  return undefined;
}

function urlFromRequestOptions(protocol: 'http:' | 'https:', options: RequestOptions): URL {
  const optionProtocol = typeof options.protocol === 'string' ? options.protocol : protocol;
  const host = String(options.hostname ?? options.host ?? 'localhost');
  const port = options.port === undefined ? '' : `:${String(options.port)}`;
  const path = typeof options.path === 'string' ? options.path : '/';
  return new URL(`${optionProtocol}//${host}${port}${path}`);
}

function parseNetConnectArgs(args: readonly unknown[]): ParsedNetConnectArgs | undefined {
  const [first, second, third] = args;
  const callback = typeof args.at(-1) === 'function' ? args.at(-1) : undefined;

  if (isRecord(first)) {
    const options = first as unknown as ConnectOptions & { path?: string };
    if (options.path !== undefined || options.port === undefined) return undefined;
    return {
      host: String(options.host ?? 'localhost'),
      port: Number(options.port),
      options,
      rebuild(nextOptions) {
        return [nextOptions, second].filter(isDefined);
      },
    };
  }

  if (typeof first === 'number') {
    const host = typeof second === 'string' ? second : 'localhost';
    return {
      host,
      port: first,
      options: { host, port: first },
      rebuild(nextOptions) {
        return [nextOptions, callback].filter(isDefined);
      },
    };
  }

  if (typeof first === 'string' && typeof second === 'number') {
    const host = typeof third === 'string' ? third : 'localhost';
    return {
      host,
      port: second,
      options: { host, port: second },
      rebuild(nextOptions) {
        return [nextOptions, callback].filter(isDefined);
      },
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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

function blockEgress(input: {
  destination: string;
  host: string;
  ip?: string;
  port: string;
}): never {
  const error = new EgressBlockedError(input);
  logBlockedEgress(error);
  throw error;
}

function logBlockedEgress(error: EgressBlockedError): void {
  console.warn(
    `[Kovo] blocked egress destination=${JSON.stringify(error.destination)} ip=${JSON.stringify(error.ip ?? '')}; ${egressBlockedGuidance}.`,
  );
}

function allowInternalAllows(
  destinationKey: string,
  ip: string,
  port: string,
  allowInternal: readonly string[],
): boolean {
  if (allowInternal.includes(destinationKey)) return true;
  for (const entry of allowInternal) {
    if (cidrAllowInternalMatches(entry, ip, port)) return true;
  }
  return false;
}

function cidrAllowInternalMatches(entry: string, ip: string, port: string): boolean {
  const parsed = parseAllowInternalEntry(entry);
  if (parsed === undefined || parsed.port !== port) return false;
  const cidr = parseIpv4Cidr(parsed.host);
  if (cidr === undefined) return false;
  const ipNumber = ipv4ToInteger(ip);
  if (ipNumber === undefined) return false;
  return (ipNumber & cidr.mask) === cidr.networkNumber;
}

function isCidrAllowInternalEntry(entry: string): boolean {
  return parseAllowInternalEntry(entry)?.host.includes('/') === true;
}

function parseAllowInternalEntry(entry: string): { host: string; port: string } | undefined {
  const match = /^(.*):(\d+)$/.exec(entry);
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  return { host: match[1], port: match[2] };
}

function parseIpv4Cidr(
  value: string,
): { mask: number; network: string; networkNumber: number; prefix: number } | undefined {
  const match = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const prefix = Number(match[2]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined;
  const ipNumber = ipv4ToInteger(match[1]);
  if (ipNumber === undefined) return undefined;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const networkNumber = (ipNumber & mask) >>> 0;
  const network = ipv4FromInteger(networkNumber);
  if (network === undefined) return undefined;
  return { mask, network, networkNumber, prefix };
}

function ipv4ToInteger(ip: string): number | undefined {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return undefined;
  }
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
}

function currentNodeEgressGuardState(): NodeEgressGuardState | undefined {
  return (
    globalThis as typeof globalThis & {
      [nodeEgressGuardStateKey]?: NodeEgressGuardState;
    }
  )[nodeEgressGuardStateKey];
}

function setNodeEgressGuardState(state: NodeEgressGuardState | undefined): void {
  const global = globalThis as typeof globalThis & {
    [nodeEgressGuardStateKey]?: NodeEgressGuardState;
  };
  if (state === undefined) delete global[nodeEgressGuardStateKey];
  else global[nodeEgressGuardStateKey] = state;
}

function nodeEgressGuardStillInstalled(
  state: NodeEgressGuardState,
  http: MutableHttpModule,
  https: MutableHttpsModule,
  net: MutableNetModule,
): boolean {
  return (
    http.request === state.httpRequest &&
    http.get === state.httpGet &&
    https.request === state.httpsRequest &&
    https.get === state.httpsGet &&
    net.connect === state.netConnect &&
    net.createConnection === state.netCreateConnection &&
    net.Socket.prototype.connect === state.socketConnect &&
    getGlobalDispatcher() === state.dispatcher
  );
}

function isPrivateOrSpecialIp(ip: string): boolean {
  if (ip.includes('.')) return isPrivateOrSpecialIpv4(ip);
  return isPrivateOrSpecialIpv6(ip);
}

function isMetadataIp(ip: string): boolean {
  return ip === '169.254.169.254' || ip === '169.254.170.2' || ip === '169.254.170.23';
}

function isMetadataDestination(host: string, port: string, ip: string): boolean {
  return isMetadataIp(ip) || isAzureIdentityEndpoint(host, port);
}

function isAzureIdentityEndpoint(host: string, port: string): boolean {
  const endpoint = process.env['IDENTITY_ENDPOINT'];
  if (endpoint === undefined || endpoint.trim() === '') return false;

  try {
    const url = new URL(endpoint);
    return normalizeHostname(url.hostname) === host && destinationPort(url) === port;
  } catch {
    return false;
  }
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
