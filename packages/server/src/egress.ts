import { AsyncLocalStorage } from 'node:async_hooks';
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import type { LookupAddress } from 'node:dns';
import { runtimeEnvironmentValue } from '@kovojs/server/internal/runtime-environment';
import { activeUndiciFloorDispatcher } from './egress-undici.js';

import {
  egressApply,
  egressArrayEvery,
  egressArrayFilter,
  egressArrayIsArray,
  egressArrayJoin,
  egressArrayMap,
  egressArrayPush,
  egressArraySlice,
  egressArraySome,
  egressArraySplice,
  egressCreateSet,
  egressDecodeURIComponent,
  egressNetIsIp,
  egressNumber,
  egressNumberIsInteger,
  egressNumberToString,
  egressObjectDefineProperty,
  egressObjectIs,
  egressParseInt,
  egressReflectGet,
  egressRegExpTest,
  egressRequest,
  egressRequestWithDispatcher,
  egressRequestUrl,
  egressSetAdd,
  egressSetDelete,
  egressSetHas,
  egressString,
  egressStringEndsWith,
  egressStringIncludes,
  egressStringIndexOf,
  egressStringLastIndexOf,
  egressStringSlice,
  egressStringSplit,
  egressStringStartsWith,
  egressStringToLowerCase,
  egressStringTrim,
  egressUrl,
  egressUrlHash,
  egressUrlHostname,
  egressUrlPassword,
  egressUrlPathname,
  egressUrlPort,
  egressUrlProtocol,
  egressUrlSearch,
  egressUrlToString,
  egressUrlUsername,
} from './egress-intrinsics.js';
import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

// Supported runners evaluate this module only after the request-safe runtime bootstrap. Keep the
// exact boot-pinned transport sink instead of redispatching through caller-mutable globalThis at
// request time (SPEC §6.6 rule 6). A preload that replaces fetch before bootstrap is privileged
// host compromise; a late app/package replacement cannot redirect this governed sink.
const frameworkEgressNativeFetch = globalThis.fetch;

/**
 * Outbound-egress private-network deny floor (SPEC §6.6 "Outbound egress"; SPEC §6.6
 * soundness boundary rule 3; `plans/secure-framework.md` Phase 5 / Tier 3).
 *
 * THREAT (precise). An SSRF *network position*: a reflected or forged inbound request
 * coaxes the server into making an *outbound* request to an address it should never
 * reach — cloud instance-metadata (`169.254.169.254`, `fd00:ec2::254`, GCP
 * `metadata.google.internal`/`169.254.169.254`, Azure IMDS `169.254.169.254` and the
 * loopback `IDENTITY_ENDPOINT`), localhost sidecars (a `:11434` Ollama, a `:6379`
 * Redis), or internal-only services on RFC1918 / link-local / unique-local ranges. The
 * payoff is credential theft (managed-identity tokens off the metadata endpoint) or an
 * internal-service pivot.
 *
 * WHAT THIS IS / IS NOT (label it honestly — SPEC §6.6 rule 3).
 *   - This is a **fail-closed runtime defense-in-depth FLOOR**, sound only at its sink
 *     (the resolved-IP check at the TCP or connected-datagram sink). It is **NEVER** a
 *     by-construction proof: privileged same-process app code can re-patch the prototype,
 *     spawn a worker/child process that doesn't inherit the hook, or open a native socket
 *     the JS layer never sees. Those are documented residual fail-open holes (see
 *     {@link installEgressFloor} doc and the SPEC section).
 *   - Process-global HTTP/TCP transport hooks allow public egress unless a framework-owned caller
 *     asks for the destination allowlist. Kovo runtime egress surfaces such as `ctx.fetch`
 *     use that stricter posture: an exact `egress.allowDestinations` origin is required
 *     before any public/private destination can be reached.
 *   - **Non-goal: a code sandbox.** This is not a defense against intentionally malicious
 *     in-process code, only against an SSRF *coaxing trusted code* to the wrong IP.
 *
 * DESIGN (SPEC §6.6).
 *   - Public / external IPs: **UNRESTRICTED** at the process-global transport floor,
 *     **ALLOWLISTED** for framework-owned runtime egress surfaces.
 *   - Private / loopback / link-local / unique-local / CGNAT / IANA-special IPs: **DENIED**
 *     by default, reachable only when the exact `host:port` is in the operator's narrow
 *     `egress.allowInternal` allowlist.
 *   - The cloud instance-metadata IP and Azure IMDS loopback: **DENIED** by default and —
 *     critically — **NOT** reachable via `allowInternal`. Reachable only inside the
 *     module-private {@link metadataAccessProvider} `AsyncLocalStorage` frame, which is entered
 *     ONLY by the per-cloud credential factories. Azure's configured endpoint additionally
 *     requires the Azure frame: an AWS/GCP frame cannot cross-open that loopback authority.
 *     A reflected SSRF never calls a factory, so it never enters the frame, so metadata stays
 *     denied at the very same IP.
 *   - HTTP/TCP enforcement is **dual-layer**: (a) `net.Socket.prototype.connect` (covers raw
 *     `node:http`/`node:https` — AWS IMDS via @smithy bypasses undici entirely — *and*
 *     undici/`fetch`, which dials through `net` underneath), pinning the validated IP via
 *     an injected `lookup` so a TOCTOU DNS-rebind can't swap a public answer for a private
 *     one between check and connect; (b) a custom undici dispatcher at the per-request
 *     `dispatch()` level (see `egress-undici.ts`) so pooled-socket reuse — which skips
 *     `beforeConnect`/the `net` dial on the second request — is still gated. `node:dgram` is
 *     separately floored by validating the kernel-pinned peer of connected sockets and denying
 *     unconnected sends whose socket-owned resolver cannot be pinned through Node's public API.
 */

/** Stable error name so callers and tests can `instanceof`/name-match a blocked egress. */
export const EGRESS_BLOCKED_ERROR_NAME = 'EgressBlockedError';

/**
 * Thrown (502-class — the *server* could not complete an upstream call it was coaxed
 * into) when the egress floor blocks an outbound connection to a private / loopback /
 * link-local / metadata destination that is not permitted. The message names the
 * destination and the remediation so an operator with a *legitimate* internal call can
 * fix it in one step.
 */
export class EgressBlockedError extends Error {
  override readonly name = EGRESS_BLOCKED_ERROR_NAME;
  /** The `host:port` (or `ip:port`) the connection was blocked from reaching. */
  readonly destination: string;
  /** The resolved IP the classifier rejected, when a literal/looked-up IP was available. */
  readonly resolvedIp: string | undefined;
  /** Coarse reason class for audit. */
  readonly classification: PrivateAddressClass;
  /** Which egress posture rejected the destination. */
  readonly reason:
    | 'private-network'
    | 'destination-allowlist'
    | 'missing-floor'
    | 'unix-domain-socket'
    | 'unconnected-datagram';
  /** Suggested HTTP status for adapters that surface this on the wire (SPEC §9.5). */
  readonly status = 502;

  constructor(args: {
    destination: string;
    resolvedIp?: string | undefined;
    classification: PrivateAddressClass;
    metadata?: boolean;
    reason?:
      | 'private-network'
      | 'destination-allowlist'
      | 'missing-floor'
      | 'unix-domain-socket'
      | 'unconnected-datagram'
      | undefined;
  }) {
    const where =
      args.resolvedIp && args.resolvedIp !== egressStringSplit(args.destination, ':')[0]
        ? `${args.destination} (resolved to ${args.resolvedIp})`
        : args.destination;
    const reason = args.reason ?? 'private-network';
    let remediation: string;
    if (reason === 'missing-floor') {
      remediation =
        'Install createApp({ egress }) / installEgressFloor() before invoking Kovo runtime egress.';
    } else if (reason === 'unix-domain-socket') {
      remediation =
        'Unix-domain sockets are default-denied because they can reach local privileged services; ' +
        'expose an explicitly governed TCP endpoint instead.';
    } else if (reason === 'unconnected-datagram') {
      remediation =
        'Connect the datagram socket before sending so Kovo can validate the kernel-pinned peer; ' +
        'unconnected per-send DNS cannot be pinned through the public node:dgram API.';
    } else if (reason === 'destination-allowlist') {
      remediation = 'Add the exact origin to createApp({ egress: { allowDestinations: [...] } }).';
    } else if (args.metadata) {
      remediation =
        'Cloud instance-metadata is reachable only inside an awsCredential()/gcpCredential()/' +
        'azureCredential() frame, never via egress.allowInternal.';
    } else {
      remediation =
        `If this internal destination is intended, add "${args.destination}" to ` +
        'createApp({ egress: { allowInternal: [...] } }).';
    }
    super(
      `Outbound egress to ${where} was blocked by the Kovo private-network deny floor ` +
        `(${args.classification}; SPEC §6.6 runtime defense-in-depth). ${remediation}`,
    );
    this.destination = args.destination;
    this.resolvedIp = args.resolvedIp;
    this.classification = args.classification;
    this.reason = reason;
  }
}

/** Coarse classification of a resolved destination address. */
export type PrivateAddressClass =
  | 'public'
  | 'metadata'
  | 'loopback'
  | 'link-local'
  | 'private-rfc1918'
  | 'unique-local'
  | 'carrier-nat'
  | 'unspecified'
  | 'special-use';

/**
 * Module-private capability. NEVER exported, and there is deliberately **no** generic
 * `withMetadataAccess` helper: the only way to enter the frame is the per-cloud credential
 * factory (`runWithMetadataAccess` below, called by `kovo.awsCredential()` &c.). Because the
 * frame is `AsyncLocalStorage`, it survives `await`/timer boundaries that destroy stack
 * frames, so an SDK credential *refresh* that re-enters the factory re-enters the frame —
 * but an SSRF, which never calls the factory, can never forge it. That is what makes this
 * "provenance-as-current-frame" unforgeable by SSRF while remaining runtime-DiD, not a proof.
 */
export type CloudMetadataProvider = 'aws' | 'azure' | 'gcp';

const metadataAccessProvider = new AsyncLocalStorage<CloudMetadataProvider>();

// A configured database URL is authority for the framework's Postgres transport, not ambient
// authority for every HTTP/TCP caller in the process. Keep that provenance on the exact Socket
// instance created for node-postgres so a reflected URL cannot reuse the DB host:port exemption
// through fetch(), node:http, or an unrelated raw socket (SPEC §6.6, §10.3).
const databaseEgressSocketEndpoints = createWitnessWeakMap<net.Socket, string>();

/**
 * Enter the metadata-allowed frame for the duration of `fn`. Module-internal: exported only
 * for the credential-factory module within this package; it is NOT part of the public API
 * surface and MUST NOT be re-exported from the package barrel.
 *
 * @internal
 */
export function runWithMetadataAccess<T>(provider: CloudMetadataProvider, fn: () => T): T {
  return metadataAccessProvider.run(provider, fn);
}

/** Whether the current async context is inside a credential-factory metadata frame. */
function isMetadataAllowed(provider?: CloudMetadataProvider): boolean {
  const activeProvider = metadataAccessProvider.getStore();
  return provider === undefined ? activeProvider !== undefined : activeProvider === provider;
}

interface AzureIdentityEndpoint {
  /** Normalized hostname/IP token without IPv6 brackets or a trailing DNS dot. */
  readonly host: string;
  /** Canonical literal IP when the configured host is itself an IP literal. */
  readonly literalIp: string | undefined;
  readonly port: number;
  /** IPs observed while resolving the configured hostname, pinned for later direct-IP dials. */
  readonly resolvedIps: Set<string>;
}

const azureIdentityEndpointPolicy: unique symbol = Symbol('kovo.azure-identity-endpoint-policy');
const nat64PrefixPolicy: unique symbol = Symbol('kovo.nat64-prefix-policy');

type Rfc6052PrefixLength = 32 | 40 | 48 | 56 | 64 | 96;

interface ResolvedNat64Prefix {
  /** Canonical network CIDR used for policy equality and diagnostics. */
  readonly cidr: string;
  /** Immutable 16-byte network address. */
  readonly bytes: readonly number[];
  readonly length: Rfc6052PrefixLength;
}

/** Resolved egress policy after normalizing operator config. */
export interface EgressPolicy {
  /** `host:port` (lowercased host) entries permitted to reach a private/loopback IP. */
  readonly allowInternal: ReadonlySet<string>;
  /** DB `host:port` endpoints eligible only for a framework-created Postgres socket exemption. */
  readonly allowDatabaseEndpoints: ReadonlySet<string>;
  /** Exact normalized origins permitted for framework-owned HTTP egress surfaces. */
  readonly allowDestinations: ReadonlySet<string>;
  /** Broad-CIDR entries the operator passed (flagged + warned, honored as a fallback). */
  readonly allowInternalCidrs: readonly string[];
  /** Canonical configured RFC 6052 Network-Specific Pref64 CIDRs. */
  readonly nat64Prefixes: readonly string[];
  /** Module-private metadata authority; the symbol survives internal object-spread policy clones. */
  readonly [azureIdentityEndpointPolicy]?: AzureIdentityEndpoint;
  /** Parsed Pref64 authority; the symbol survives internal object-spread policy clones. */
  readonly [nat64PrefixPolicy]?: readonly ResolvedNat64Prefix[];
  /**
   * Internal dev-only posture: keep the floor installed and metadata blocked, but permit
   * non-metadata private/loopback/link-local destinations so local sidecars do not brick.
   */
  readonly allowPrivateNetwork: boolean;
}

// Framework-owned fetches carry their stricter positive-destination policy through native
// fetch's redirect machinery. AsyncLocalStorage is the non-forgeable per-call signal that lets
// the global dispatcher distinguish a privileged ctx.fetch hop from ordinary public egress.
const frameworkEgressPolicyContext = new AsyncLocalStorage<EgressPolicy>();

/** @internal The exact policy pinned for the current framework-owned fetch redirect chain. */
export function activeFrameworkEgressPolicy(): EgressPolicy | undefined {
  return frameworkEgressPolicyContext.getStore();
}

/** Operator-facing config (the `egress` field of `createApp`). */
export interface EgressOptions {
  /**
   * Narrow `host:port` allowlist of internal destinations the app may reach despite the
   * deny floor — e.g. `['otel:4318', 'localhost:11434', '10.0.5.2:6379']`. `host:port`
   * entries only. A bare host or a CIDR is flagged and warned (broad CIDRs widen the hole);
   * the metadata endpoint can NEVER be allowlisted here.
   */
  allowInternal?: readonly string[];
  /**
   * Exact origin allowlist for framework-owned HTTP egress (`ctx.fetch` and future
   * webhook/agent-tool outbound helpers), e.g. `['https://api.stripe.com']`. This is a
   * positive destination allowlist: Kovo-owned runtime egress fails closed when omitted or
   * when the initial request or any redirect-hop origin is not listed. Private/internal origins also require
   * `allowInternal` because destination intent does not prove the resolved IP is safe.
   */
  allowDestinations?: readonly string[];
  /**
   * RFC 6052 Network-Specific Prefixes used by this deployment's DNS64/NAT64 translator.
   * Kovo already recognizes the well-known `64:ff9b::/96` prefix. List every additional
   * Pref64 as an IPv6 CIDR with one of RFC 6052's legal lengths: `/32`, `/40`, `/48`, `/56`,
   * `/64`, or `/96`. Prefixes are validated and snapshotted at boot; malformed, host-bit-set,
   * duplicate, or overlapping entries refuse boot instead of being ignored.
   */
  nat64Prefixes?: readonly string[];
  /**
   * Optional same-process tamper hardening for the transport monkeypatches.
   *
   * - `off` (default): only self-probes detect later monkeypatch drift.
   * - `warn`: installs warning setters around the net and datagram transport methods, so
   *   ordinary late reassignment is reported immediately. Undici global-dispatcher drift is
   *   still detected by self-probes because its ESM export cannot be frozen reliably here.
   * - `freeze`: makes the net-connect and datagram descriptors non-writable against ordinary
   *   reassignment.
   *
   * SPEC §6.6: this remains a runtime defense-in-depth floor, not sandbox protection.
   * Privileged same-process code can still bypass it with `defineProperty`, workers/children
   * need their own bootstrap, and native sockets are out of scope.
   */
  hardening?: 'off' | 'warn' | 'freeze';
}

type EgressHardeningMode = NonNullable<EgressOptions['hardening']>;

interface ResolveEgressPolicyOptions {
  /** Internal boot posture for omitted `createApp({ egress })` in development. */
  allowPrivateNetwork?: boolean;
  /** Already-normalized framework-owned DB endpoints registered before this floor install. */
  databaseEndpoints?: readonly string[];
  /**
   * Runtime database URLs whose exact host:port a framework-created Postgres socket may reach
   * even when the production/private-network floor is otherwise empty. Defaults to boot-pinned
   * `KOVO_DATABASE_URL`; unrelated sockets remain denied.
   */
  databaseUrls?: readonly (string | undefined)[];
  /** Test/bootstrap override; production defaults to boot-pinned platform `IDENTITY_ENDPOINT`. */
  identityEndpoint?: string | undefined;
}

const METADATA_ALLOWLIST_REJECT =
  'The cloud instance-metadata endpoint can never be allowlisted via egress.allowInternal ' +
  '(that would re-open the exact SSRF credential-theft path the floor closes). Remove it; ' +
  'metadata is reachable only inside a kovo credential-factory frame (SPEC §6.6).';

/** Normalize + validate operator egress config into a resolved policy (called at boot). */
export function resolveEgressPolicy(
  options: EgressOptions | undefined,
  warn: (message: string) => void = (m) => console.warn(`[kovo egress] ${m}`),
  policyOptions: ResolveEgressPolicyOptions = {},
): EgressPolicy {
  const azureIdentityEndpoint = resolveAzureIdentityEndpoint(
    policyOptions.identityEndpoint ?? runtimeEnvironmentValue('IDENTITY_ENDPOINT'),
  );
  const nat64Prefixes = resolveNat64Prefixes(options?.nat64Prefixes);
  const allowInternal = egressCreateSet<string>();
  const allowDatabaseEndpoints = egressCreateSet<string>();
  const allowDestinations = egressCreateSet<string>();
  const allowInternalCidrs: string[] = [];
  const destinationInputs = options?.allowDestinations ?? [];
  if (!egressArrayIsArray(destinationInputs)) {
    throw new EgressConfigError(
      'egress.allowDestinations must be a dense array of exact http(s) origin strings.',
      '<allowDestinations>',
    );
  }
  for (let index = 0; index < destinationInputs.length; index += 1) {
    const raw = destinationInputs[index];
    if (typeof raw !== 'string') {
      throw new EgressConfigError(
        'Every egress.allowDestinations entry must be an exact http(s) origin string.',
        '<non-string destination entry>',
      );
    }
    const entry = egressStringTrim(raw);
    const normalized = normalizeHttpOrigin(entry);
    if (!normalized) {
      throw new EgressConfigError(
        `egress.allowDestinations entry "${entry}" is not an exact http(s) origin. ` +
          'Declare only scheme, host, and optional port (for example "https://api.example.com").',
        entry,
      );
    }
    egressSetAdd(allowDestinations, normalized);
  }
  const internalInputs = options?.allowInternal ?? [];
  for (let index = 0; index < internalInputs.length; index += 1) {
    const entry = egressStringTrim(egressString(internalInputs[index]));
    if (entry === '') continue;
    // CIDR notation: flag + warn (broad ranges widen the floor), honor as a fallback range.
    if (egressStringIncludes(entry, '/')) {
      warn(
        `allowInternal entry "${entry}" is a CIDR range. A broad CIDR widens the private-network ` +
          'floor; prefer narrow host:port entries. Honored as a range fallback.',
      );
      egressArrayPush(allowInternalCidrs, entry);
      continue;
    }
    const parsed = parseHostPort(entry);
    if (!parsed) {
      warn(
        `allowInternal entry "${entry}" is not a valid host:port (e.g. "10.0.5.2:6379"); ignored.`,
      );
      continue;
    }
    if (isConfiguredAzureIdentityAuthority(azureIdentityEndpoint, parsed.host, parsed.port)) {
      throw new EgressConfigError(METADATA_ALLOWLIST_REJECT, entry);
    }
    // A metadata-IP allowlist entry is rejected loudly — it must never re-open the path.
    const cls = classifyIpWithNat64Prefixes(parsed.host, nat64Prefixes);
    if (cls === 'metadata') {
      throw new EgressConfigError(METADATA_ALLOWLIST_REJECT, entry);
    }
    if (cls === 'public') {
      warn(
        `allowInternal entry "${entry}" is a public address; public egress is already unrestricted, ` +
          'so this entry is redundant.',
      );
    }
    egressSetAdd(allowInternal, `${egressStringToLowerCase(parsed.host)}:${parsed.port}`);
  }
  const resolvedDatabaseEndpoints = resolveDatabaseEgressEndpoints(policyOptions.databaseUrls);
  for (let index = 0; index < resolvedDatabaseEndpoints.length; index += 1) {
    egressSetAdd(allowDatabaseEndpoints, resolvedDatabaseEndpoints[index]!);
  }
  const configuredDatabaseEndpoints = policyOptions.databaseEndpoints ?? [];
  for (let index = 0; index < configuredDatabaseEndpoints.length; index += 1) {
    egressSetAdd(allowDatabaseEndpoints, configuredDatabaseEndpoints[index]!);
  }
  const policy: EgressPolicy = {
    allowInternal,
    allowDatabaseEndpoints,
    allowDestinations,
    allowInternalCidrs,
    nat64Prefixes: witnessFreeze(egressArrayMap(nat64Prefixes, (prefix) => prefix.cidr)),
    allowPrivateNetwork: policyOptions.allowPrivateNetwork === true,
    [nat64PrefixPolicy]: nat64Prefixes,
    ...(azureIdentityEndpoint === undefined
      ? {}
      : { [azureIdentityEndpointPolicy]: azureIdentityEndpoint }),
  };
  return policy;
}

function resolveNat64Prefixes(
  inputs: readonly string[] | undefined,
): readonly ResolvedNat64Prefix[] {
  if (inputs === undefined) {
    const empty: ResolvedNat64Prefix[] = [];
    return witnessFreeze(empty);
  }
  if (!egressArrayIsArray(inputs)) {
    throw new EgressConfigError(
      'egress.nat64Prefixes must be a dense array of RFC 6052 IPv6 CIDRs.',
      '<nat64Prefixes>',
    );
  }

  const resolved: ResolvedNat64Prefix[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const raw = inputs[index];
    if (typeof raw !== 'string') {
      throw new EgressConfigError(
        'Every egress.nat64Prefixes entry must be an RFC 6052 IPv6 CIDR string.',
        '<non-string Pref64 entry>',
      );
    }
    const candidate = parseNat64Prefix(raw);
    if (nat64PrefixOverlapsWellKnownPrefix(candidate)) {
      throw new EgressConfigError(
        `egress.nat64Prefixes entry "${candidate.cidr}" overlaps the RFC 6052 well-known ` +
          '`64:ff9b::/96` decoder that Kovo always applies. Remove the redundant/ambiguous ' +
          'entry and configure only Network-Specific prefixes.',
        raw,
      );
    }
    for (let existingIndex = 0; existingIndex < resolved.length; existingIndex += 1) {
      const existing = resolved[existingIndex]!;
      if (nat64PrefixesOverlap(candidate, existing)) {
        throw new EgressConfigError(
          `egress.nat64Prefixes entries "${candidate.cidr}" and "${existing.cidr}" overlap. ` +
            'One translated IPv6 address could decode to two different IPv4 destinations; ' +
            'declare one unambiguous Pref64 only.',
          raw,
        );
      }
    }

    // Prefix order has no policy meaning once overlap is rejected. Store a canonical lexical
    // order so equivalent operator input produces the same process-global posture.
    let insertionIndex = resolved.length;
    for (let existingIndex = 0; existingIndex < resolved.length; existingIndex += 1) {
      if (candidate.cidr < resolved[existingIndex]!.cidr) {
        insertionIndex = existingIndex;
        break;
      }
    }
    egressArraySplice(resolved, insertionIndex, 0, candidate);
  }
  return witnessFreeze(resolved);
}

function parseNat64Prefix(entry: string): ResolvedNat64Prefix {
  const parts = egressStringSplit(entry, '/');
  const address = parts[0];
  const length = rfc6052PrefixLength(parts[1]);
  if (parts.length !== 2 || address === undefined || address === '' || length === null) {
    throw invalidNat64Prefix(entry);
  }
  const parsed = parseIpv6Bytes(address);
  if (parsed === null) throw invalidNat64Prefix(entry);

  const prefixBytes = length / 8;
  for (let index = prefixBytes; index < parsed.bytes.length; index += 1) {
    if (parsed.bytes[index] !== 0) {
      throw new EgressConfigError(
        `egress.nat64Prefixes entry "${entry}" is not a canonical /${length} network ` +
          'address because host bits are set.',
        entry,
      );
    }
  }
  // RFC 6052 §2.2 reserves the u octet at bits 64..71. With /96 it belongs to the prefix
  // itself, so prefix selection must make it zero; shorter layouts validate the address byte
  // at the egress sink after the IPv4 bits have been inserted.
  if (length === 96 && parsed.bytes[8] !== 0) {
    throw new EgressConfigError(
      `egress.nat64Prefixes entry "${entry}" has a non-zero RFC 6052 u octet ` +
        '(bits 64..71). Select a /96 prefix whose u octet is zero.',
      entry,
    );
  }

  const bytes = witnessFreeze(egressArraySlice(parsed.bytes));
  return witnessFreeze({
    bytes,
    cidr: `${canonicalizeIpv6Bytes({ bytes })}/${length}`,
    length,
  });
}

function rfc6052PrefixLength(input: string | undefined): Rfc6052PrefixLength | null {
  if (input === '32') return 32;
  if (input === '40') return 40;
  if (input === '48') return 48;
  if (input === '56') return 56;
  if (input === '64') return 64;
  if (input === '96') return 96;
  return null;
}

function invalidNat64Prefix(entry: string): EgressConfigError {
  return new EgressConfigError(
    `egress.nat64Prefixes entry "${entry}" must be an IPv6 network CIDR with ` +
      'an RFC 6052 prefix length (/32, /40, /48, /56, /64, or /96).',
    entry,
  );
}

function nat64PrefixesOverlap(left: ResolvedNat64Prefix, right: ResolvedNat64Prefix): boolean {
  const sharedBytes = (left.length < right.length ? left.length : right.length) / 8;
  for (let index = 0; index < sharedBytes; index += 1) {
    if (left.bytes[index] !== right.bytes[index]) return false;
  }
  return true;
}

function nat64PrefixOverlapsWellKnownPrefix(prefix: ResolvedNat64Prefix): boolean {
  const wellKnownPrefix = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];
  const sharedBytes = prefix.length / 8;
  for (let index = 0; index < sharedBytes; index += 1) {
    if (prefix.bytes[index] !== wellKnownPrefix[index]) return false;
  }
  return true;
}

/** @internal Normalize Postgres URLs into exact DB host:port socket capabilities. */
export function databaseEgressEndpointsFromUrls(
  databaseUrls: readonly (string | undefined)[],
): readonly string[] {
  return resolveDatabaseEgressEndpoints(databaseUrls);
}

/** @internal Mutate the active egress floor with framework-owned DB endpoints. */
export function addDatabaseEgressEndpoints(
  policy: EgressPolicy,
  endpoints: readonly string[],
): void {
  const mutable = policy.allowDatabaseEndpoints as Set<string>;
  for (let index = 0; index < endpoints.length; index += 1) {
    egressSetAdd(mutable, endpoints[index]!);
  }
}

/** @internal Remove framework-owned DB endpoints that are no longer registered. */
export function removeDatabaseEgressEndpoints(
  policy: EgressPolicy,
  endpoints: readonly string[],
): void {
  const mutable = policy.allowDatabaseEndpoints as Set<string>;
  for (let index = 0; index < endpoints.length; index += 1) {
    egressSetDelete(mutable, endpoints[index]!);
  }
}

function resolveDatabaseEgressEndpoints(
  databaseUrls: readonly (string | undefined)[] | undefined,
): readonly string[] {
  const urls = databaseUrls ?? [runtimeEnvironmentValue('KOVO_DATABASE_URL')];
  const endpoints = egressCreateSet<string>();
  const result: string[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    const raw = urls[index];
    if (raw === undefined || egressStringTrim(raw) === '') continue;
    const endpoint = databaseEgressEndpointFromUrl(raw);
    if (endpoint && !egressSetHas(endpoints, endpoint)) {
      egressSetAdd(endpoints, endpoint);
      egressArrayPush(result, endpoint);
    }
  }
  return result;
}

/** Effective node-postgres connection facts parsed from a framework-owned connection string. */
export interface DatabaseEgressUrlFacts {
  readonly authorityHost: string;
  readonly authorityPortExplicit: boolean;
  readonly authorityUsername: string;
  readonly databasePathPresent: boolean;
  readonly host: string;
  readonly port: number;
  readonly queryDatabaseOverride: string | undefined;
  readonly queryHostOverride: string | undefined;
  readonly queryPortOverride: string | undefined;
  readonly queryUserOverride: string | undefined;
  readonly sslMode: string | undefined;
  readonly unixSocket: boolean;
}

/**
 * Parse the host/port/TLS posture that pinned `pg-connection-string` will actually use.
 *
 * Query-string `host`, `port`, and `sslmode` values are last-wins in node-postgres. Keeping this
 * parser beside the DB socket provenance parser prevents a URL whose authority says loopback from
 * redirecting the real database carrier through `?host=...` (SPEC §6.6/§10.3).
 *
 * @internal
 */
export function databaseEgressUrlFacts(raw: string): DatabaseEgressUrlFacts | null {
  // Deliberately reject pg-connection-string's historical `/socket/path database` shorthand.
  // That grammar has no user or port fields, so node-postgres silently sources both from PGUSER /
  // PGPORT (or OS defaults) after Kovo has reviewed a different authority. A Unix carrier remains
  // available through a canonical URL such as
  // `postgres://app@localhost:5432/kovo?host=%2Fvar%2Frun%2Fpostgresql`.
  // pg-connection-string preprocesses any raw space/control-containing URL with encodeURI before
  // parsing it relative to `postgres://base`, while WHATWG URL trims leading controls. Reject the
  // differential entirely; callers can percent-encode intentional credential/query bytes.
  if (egressRegExpTest(/[\p{White_Space}\p{Cc}]/u, raw)) return null;
  // A single malformed percent escape makes pg-connection-string encodeURI() the *whole* input.
  // That can double-encode otherwise-valid query-key escapes (for example h%6Fst), so Kovo and pg
  // would disagree about the effective host or sslmode. Require a canonical escape envelope before
  // either parser sees the URL.
  if (egressRegExpTest(/%(?![0-9A-Fa-f]{2})/u, raw)) return null;
  if (
    !egressStringStartsWith(raw, 'postgres://') &&
    !egressStringStartsWith(raw, 'postgresql://')
  ) {
    return null;
  }

  let url: URL;
  try {
    url = egressUrl(raw);
  } catch {
    return null;
  }
  const protocol = egressUrlProtocol(url);
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') return null;
  let queryHost: string | undefined;
  let queryPort: string | undefined;
  let queryUser: string | undefined;
  let queryDatabase: string | undefined;
  let sslMode: string | undefined;
  try {
    const query = egressUrlSearch(url);
    const encodedEntries = egressStringSplit(
      egressStringStartsWith(query, '?') ? egressStringSlice(query, 1) : query,
      '&',
    );
    for (let index = 0; index < encodedEntries.length; index += 1) {
      const entry = encodedEntries[index]!;
      if (entry === '') continue;
      const separator = egressStringIndexOf(entry, '=');
      const encodedKey = separator < 0 ? entry : egressStringSlice(entry, 0, separator);
      const encodedValue = separator < 0 ? '' : egressStringSlice(entry, separator + 1);
      const key = decodeDatabaseUrlQueryComponent(encodedKey);
      const value = decodeDatabaseUrlQueryComponent(encodedValue);
      if (key === 'host') queryHost = value;
      else if (key === 'port') queryPort = value;
      else if (key === 'user') queryUser = value;
      else if (key === 'database') queryDatabase = value;
      else if (key === 'sslmode') sslMode = value;
    }
  } catch {
    return null;
  }

  let authorityHost: string;
  let authorityUsername: string;
  try {
    // Keep WHATWG's non-special-scheme bracket spelling: pinned pg passes `[::1]` (including the
    // brackets) to net.connect, so normalizing it to `::1` here would approve a different carrier.
    authorityHost = egressDecodeURIComponent(egressUrlHostname(url));
    authorityUsername = egressDecodeURIComponent(egressUrlUsername(url));
  } catch {
    return null;
  }
  // pg-connection-string falls back to the authority for an absent or empty query host/port.
  const host = queryHost === undefined || queryHost === '' ? authorityHost : queryHost;
  if (host === '') return null;
  const authorityPort = egressUrlPort(url);
  const effectivePort = queryPort === undefined || queryPort === '' ? authorityPort : queryPort;
  if (
    queryPort !== undefined &&
    queryPort !== '' &&
    !egressRegExpTest(/^[1-9][0-9]{0,4}$/u, queryPort)
  ) {
    return null;
  }
  const port = effectivePort === '' ? 5432 : egressNumber(effectivePort);
  if (!egressNumberIsInteger(port) || port < 1 || port > 65535) return null;
  return {
    authorityHost,
    authorityPortExplicit: authorityPort !== '',
    authorityUsername,
    databasePathPresent: egressUrlPathname(url).length > 1,
    host,
    port,
    queryDatabaseOverride: queryDatabase,
    queryHostOverride: queryHost,
    queryPortOverride: queryPort,
    queryUserOverride: queryUser,
    sslMode,
    unixSocket: egressStringStartsWith(host, '/'),
  };
}

function decodeDatabaseUrlQueryComponent(value: string): string {
  // WHATWG URLSearchParams uses application/x-www-form-urlencoded `+` => space semantics.
  return egressDecodeURIComponent(egressArrayJoin(egressStringSplit(value, '+'), '%20'));
}

function databaseEgressEndpointFromUrl(raw: string): string | null {
  const facts = databaseEgressUrlFacts(raw);
  if (facts === null || facts.unixSocket) return null;
  return `${egressStringToLowerCase(facts.host)}:${facts.port}`;
}

/**
 * Create the exact network carrier used by a framework-owned node-postgres connection.
 *
 * The returned socket is remembered only in a module-private WeakMap. Registering a database URL
 * therefore does not widen the ambient process egress policy: the endpoint exemption is available
 * only when this precise socket reaches the net.connect sink.
 *
 * @internal
 */
export function createDatabaseEgressSocket(databaseUrl: string): net.Socket {
  const facts = databaseEgressUrlFacts(databaseUrl);
  if (facts === null) {
    throw new TypeError(
      'Framework-owned database egress requires an absolute postgres:// or postgresql:// URL.',
    );
  }
  const socket = new net.Socket();
  witnessWeakMapSet(
    databaseEgressSocketEndpoints,
    socket,
    facts.unixSocket
      ? `unix:${facts.host}/.s.PGSQL.${facts.port}`
      : `${egressStringToLowerCase(facts.host)}:${facts.port}`,
  );
  return socket;
}

/** Boot-time config error for an invalid/forbidden egress allowlist entry. */
export class EgressConfigError extends Error {
  override readonly name = 'EgressConfigError';
  readonly entry: string;
  constructor(message: string, entry: string) {
    super(message);
    this.entry = entry;
  }
}

interface HostPort {
  host: string;
  port: number;
}

/** Parse `host:port` allowing bracketed IPv6 (`[::1]:6379`). Returns null on malformed input. */
function parseHostPort(entry: string): HostPort | null {
  let host: string;
  let portStr: string;
  if (egressStringStartsWith(entry, '[')) {
    const close = egressStringIndexOf(entry, ']');
    if (close < 0) return null;
    host = egressStringSlice(entry, 1, close);
    const rest = egressStringSlice(entry, close + 1);
    if (!egressStringStartsWith(rest, ':')) return null;
    portStr = egressStringSlice(rest, 1);
  } else {
    const idx = egressStringLastIndexOf(entry, ':');
    if (idx < 0) return null;
    host = egressStringSlice(entry, 0, idx);
    portStr = egressStringSlice(entry, idx + 1);
  }
  const port = egressNumber(portStr);
  if (host === '' || !egressNumberIsInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

function normalizeHttpOrigin(entry: string): string | null {
  try {
    const url = egressUrl(entry);
    const protocol = egressUrlProtocol(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    if (
      egressUrlUsername(url) ||
      egressUrlPassword(url) ||
      egressUrlPathname(url) !== '/' ||
      egressUrlSearch(url) ||
      egressUrlHash(url)
    ) {
      return null;
    }
    return canonicalHttpOrigin(protocol, egressUrlHostname(url), normalizedUrlPort(url));
  } catch {
    return null;
  }
}

/**
 * Canonical origin identity for the framework-owned positive egress capability (SPEC §6.6).
 * URL parsing owns Unicode/legacy-IPv4 normalization before this helper is called. This final
 * step collapses DNS trailing dots, brackets IPv6, and makes the effective port explicit so boot,
 * initial requests, redirect hops, and pooled requests compare one spelling.
 *
 * @internal
 */
export function canonicalHttpOrigin(
  protocol: string | undefined,
  host: string,
  port: number,
): string | null {
  if (
    (protocol !== 'http:' && protocol !== 'https:') ||
    !egressNumberIsInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return null;
  }
  const canonicalHost = normalizeAuthorityHost(host);
  if (canonicalHost === '') return null;
  const authorityHost = egressStringIncludes(canonicalHost, ':')
    ? `[${canonicalHost}]`
    : canonicalHost;
  return `${protocol}//${authorityHost}:${port}`;
}

function normalizedUrlPort(url: URL): number {
  const port = egressUrlPort(url);
  if (port) return egressNumber(port);
  return egressUrlProtocol(url) === 'https:' ? 443 : 80;
}

function stripIpv6Brackets(value: string): string {
  let result = value;
  if (egressStringStartsWith(result, '[')) result = egressStringSlice(result, 1);
  if (egressStringEndsWith(result, ']')) result = egressStringSlice(result, 0, -1);
  return result;
}

function stripTrailingDnsDot(value: string): string {
  return egressStringEndsWith(value, '.') ? egressStringSlice(value, 0, -1) : value;
}

function resolveAzureIdentityEndpoint(raw: string | undefined): AzureIdentityEndpoint | undefined {
  if (raw === undefined || egressStringTrim(raw) === '') return undefined;

  let url: URL;
  try {
    url = egressUrl(egressStringTrim(raw));
  } catch {
    throw new EgressConfigError(
      'IDENTITY_ENDPOINT must be an absolute http(s) URL so Kovo can classify its authority as ' +
        'Azure metadata (SPEC §6.6). Refusing to install an ambiguous egress floor.',
      raw,
    );
  }
  if (
    (egressUrlProtocol(url) !== 'http:' && egressUrlProtocol(url) !== 'https:') ||
    egressUrlUsername(url) !== '' ||
    egressUrlPassword(url) !== ''
  ) {
    throw new EgressConfigError(
      'IDENTITY_ENDPOINT must be an absolute http(s) URL without embedded credentials so Kovo ' +
        'can fail closed around its Azure metadata authority (SPEC §6.6).',
      raw,
    );
  }

  const host = normalizeAuthorityHost(egressUrlHostname(url));
  const port = normalizedUrlPort(url);
  if (host === '' || !egressNumberIsInteger(port) || port < 1 || port > 65_535) {
    throw new EgressConfigError(
      'IDENTITY_ENDPOINT has an invalid host or port; refusing to install an ambiguous Azure ' +
        'metadata egress policy (SPEC §6.6).',
      raw,
    );
  }
  const literalIp = normalizeIpLiteral(host) ?? undefined;
  return {
    host,
    literalIp,
    port,
    resolvedIps: egressCreateSet<string>(),
  };
}

function normalizeAuthorityHost(host: string): string {
  const unbracketed = stripIpv6Brackets(egressStringTrim(host));
  const literalIp = normalizeIpLiteral(unbracketed);
  if (literalIp !== null) return egressStringToLowerCase(literalIp);
  return stripTrailingDnsDot(egressStringToLowerCase(unbracketed));
}

function isLocalhostName(host: string): boolean {
  return host === 'localhost' || egressStringEndsWith(host, '.localhost');
}

function isConfiguredAzureIdentityAuthority(
  endpoint: AzureIdentityEndpoint | undefined,
  host: string,
  port: number,
): boolean {
  if (endpoint === undefined || endpoint.port !== port) return false;
  const normalizedHost = normalizeAuthorityHost(host);
  if (normalizedHost === endpoint.host) return true;
  const literalIp = normalizeIpLiteral(normalizedHost);
  if (endpoint.literalIp !== undefined && literalIp === endpoint.literalIp) return true;
  // IDENTITY_ENDPOINT is a platform-declared loopback credential authority. Reserve every
  // loopback spelling on its port even when the configured hostname has not been resolved yet;
  // this closes the direct-IP-before-first-provider-dial window.
  return (
    isLocalhostName(normalizedHost) || (literalIp !== null && classifyIp(literalIp) === 'loopback')
  );
}

function isAzureIdentityDestination(args: {
  endpoint: AzureIdentityEndpoint | undefined;
  host: string;
  port: number;
  resolvedIp: string;
}): boolean {
  const { endpoint, host, port, resolvedIp } = args;
  if (endpoint === undefined || endpoint.port !== port) return false;

  const normalizedHost = normalizeAuthorityHost(host);
  const normalizedResolvedIp = normalizeIpLiteral(resolvedIp);
  if (normalizedHost === endpoint.host) {
    if (normalizedResolvedIp !== null) {
      egressSetAdd(endpoint.resolvedIps, normalizedResolvedIp);
    }
    return true;
  }
  if (
    endpoint.literalIp !== undefined &&
    (normalizedHost === endpoint.literalIp || normalizedResolvedIp === endpoint.literalIp)
  ) {
    return true;
  }
  if (
    (normalizedResolvedIp !== null && classifyIp(normalizedResolvedIp) === 'loopback') ||
    isLocalhostName(normalizedHost)
  ) {
    return true;
  }
  return normalizedResolvedIp !== null && egressSetHas(endpoint.resolvedIps, normalizedResolvedIp);
}

// ---------------------------------------------------------------------------
// IP classification.
//
// SPEC §6.6 decision rule: normalize (IPv4-mapped ::ffff:, decimal/octal/hex, NAT64) →
// classify the *exact* address. Public → allow. Metadata → allow iff in a credential frame.
// Other non-public → allow iff host:port ∈ allowInternal. Anything we cannot confidently
// classify as public fails CLOSED (treated as special-use → denied unless allowlisted).
// ---------------------------------------------------------------------------

/**
 * Normalize a host string that may be an IP literal in a non-canonical base (decimal
 * `2130706433`, octal `0177.0.0.1`, hex `0x7f.1`) or an IPv4-mapped/compat IPv6 form, into a
 * canonical dotted-quad / colon-hex string. Returns null if the host is not an IP literal
 * (i.e. it is a DNS name needing resolution). This closes the classic SSRF bypass of feeding
 * `http://2130706433/` (== 127.0.0.1) past a naive `=== '127.0.0.1'` check.
 */
export function normalizeIpLiteral(host: string): string | null {
  const h = stripIpv6Brackets(egressStringTrim(host));
  if (h === '') return null;

  // Bare IPv4 in decimal/octal/hex (any of the 1–4 part forms inet_aton accepts).
  const v4 = parseLooseIpv4(h);
  if (v4 !== null) return v4;

  const v6 = parseIpv6Bytes(h);
  if (v6 !== null) return canonicalizeIpv6Bytes(v6);

  const scopedV6 = parseScopedIpv6Bytes(h);
  if (scopedV6 !== null) return canonicalizeIpv6Bytes(scopedV6);

  return null;
}

/**
 * Normalize only address strings that are already canonical enough for the synchronous
 * no-DNS fast path. Loose IPv4 spellings intentionally return null so `net`/undici resolve
 * and pin the actual dialed address before the SPEC §6.6 sink decision.
 */
export function normalizeFastPathIpLiteral(host: string): string | null {
  const h = stripIpv6Brackets(egressStringTrim(host));
  if (h === '') return null;

  if (isCanonicalIpv4Literal(h)) return h;

  const v6 = parseIpv6Bytes(h);
  if (v6 !== null) return canonicalizeIpv6Bytes(v6);

  const scopedV6 = parseScopedIpv6Bytes(h);
  if (scopedV6 !== null) return canonicalizeIpv6Bytes(scopedV6);

  return null;
}

/**
 * SPEC §6.6 / C15 corollary: if Node accepts an IP literal but Kovo cannot normalize it into
 * the classifier's canonical address model, the egress sink must fail closed before allowlists.
 * Scoped IPv6 literals (`fe80::1%lo0`, `::ffff:169.254.169.254%eth0`) are normalized by
 * stripping the local interface zone for address classification while preserving the full
 * scoped host token as the exact allowInternal key.
 *
 * @internal
 */
export function isNodeAcceptedUnnormalizedIpLiteral(host: string): boolean {
  const h = stripIpv6Brackets(egressStringTrim(host));
  return h !== '' && egressNetIsIp(h) !== 0 && normalizeIpLiteral(h) === null;
}

function isCanonicalIpv4Literal(input: string): boolean {
  const parts = egressStringSplit(input, '.');
  if (parts.length !== 4) return false;
  return egressArrayEvery(parts, (part) => {
    if (!egressRegExpTest(/^(0|[1-9][0-9]*)$/u, part)) return false;
    const value = egressNumber(part);
    return (
      egressNumberIsInteger(value) && value >= 0 && value <= 255 && egressString(value) === part
    );
  });
}

/**
 * Parse the loose IPv4 forms `inet_aton`/`URL` historically accept: 1–4 dotted parts, each in
 * decimal, octal (`0NNN`), or hex (`0xNN`), with the final part absorbing the remaining bytes.
 * Returns canonical dotted-quad or null.
 */
export function parseLooseIpv4(input: string): string | null {
  const parts = egressStringSplit(input, '.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part === '') return null;
    let value: number;
    if (egressRegExpTest(/^0x[0-9a-f]+$/iu, part)) {
      value = egressParseInt(egressStringSlice(part, 2), 16);
    } else if (egressRegExpTest(/^0[0-7]+$/u, part)) value = egressParseInt(part, 8);
    else if (egressRegExpTest(/^0$/u, part)) value = 0;
    else if (egressRegExpTest(/^[1-9][0-9]*$/u, part)) value = egressParseInt(part, 10);
    else return null;
    if (!egressNumberIsInteger(value) || value < 0) return null;
    egressArrayPush(nums, value);
  }
  // Compose into a 32-bit address per inet_aton's part-count semantics.
  let addr: number;
  const n = nums.length;
  if (n === 1) {
    if (nums[0]! > 0xffffffff) return null;
    addr = nums[0]!;
  } else if (n === 2) {
    if (nums[0]! > 0xff || nums[1]! > 0xffffff) return null;
    addr = (nums[0]! << 24) | nums[1]!;
  } else if (n === 3) {
    if (nums[0]! > 0xff || nums[1]! > 0xff || nums[2]! > 0xffff) return null;
    addr = (nums[0]! << 24) | (nums[1]! << 16) | nums[2]!;
  } else {
    if (egressArraySome(nums, (x) => x > 0xff)) return null;
    addr = (nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!;
  }
  addr = addr >>> 0;
  return `${(addr >>> 24) & 0xff}.${(addr >>> 16) & 0xff}.${(addr >>> 8) & 0xff}.${addr & 0xff}`;
}

/**
 * Classify a host that is (or may be) an IP literal. A DNS name that is not an IP literal
 * returns `null` — the caller must resolve it first, then classify the resolved IP. This is
 * the single sink the whole floor trusts (SPEC §6.6 rule 2: runtime contributes sink
 * validation of a resolved IP, which survives transforms).
 */
export function classifyHost(host: string): PrivateAddressClass | null {
  const ip = normalizeIpLiteral(host);
  if (ip === null) return null;
  return classifyIp(ip);
}

/** Classify a canonical IP literal. Unknown/unparseable → special-use (fails closed). */
export function classifyIp(host: string): PrivateAddressClass {
  const h = normalizeIpLiteral(host);
  if (h === null) return 'special-use';
  const v4 = parseLooseIpv4(h);
  if (v4 !== null) return classifyIpv4(v4);
  const v6 = parseIpv6Bytes(h);
  if (v6 !== null) return classifyIpv6Bytes(v6);
  return 'special-use';
}

/**
 * Apply deployment topology before the context-free registry classifier. A Network-Specific
 * Pref64 is ordinary IPv6 on the public Internet; only the operator can assert that this process
 * reaches an RFC 6052 translator at that prefix. Keep {@link classifyIp} topology-free and route
 * the configured fact only through the resolved egress policy.
 */
function classifyIpForPolicy(host: string, policy: EgressPolicy): PrivateAddressClass {
  return classifyIpWithNat64Prefixes(host, policy[nat64PrefixPolicy] ?? []);
}

function classifyIpWithNat64Prefixes(
  host: string,
  prefixes: readonly ResolvedNat64Prefix[],
): PrivateAddressClass {
  const normalized = normalizeIpLiteral(host);
  if (normalized === null) return 'special-use';
  const contextFree = classifyIp(normalized);
  const ipv6 = parseIpv6Bytes(normalized);
  if (ipv6 !== null) {
    const translated = classifyConfiguredNat64Address(ipv6.bytes, prefixes);
    if (translated !== null) {
      // Metadata is the strongest verdict because it cannot be reopened through allowInternal.
      // Other context-free special ranges may deliberately carry a configured translator (for
      // example RFC 8215's 64:ff9b:1::/48 local-use prefix), so the explicit topology is allowed
      // to expose their embedded public IPv4 destination.
      if (contextFree === 'metadata' || translated === 'metadata') return 'metadata';
      return translated;
    }
  }
  return contextFree;
}

function classifyConfiguredNat64Address(
  bytes: readonly number[],
  prefixes: readonly ResolvedNat64Prefix[],
): PrivateAddressClass | null {
  for (let prefixIndex = 0; prefixIndex < prefixes.length; prefixIndex += 1) {
    const prefix = prefixes[prefixIndex]!;
    const prefixBytes = prefix.length / 8;
    let matches = true;
    for (let byteIndex = 0; byteIndex < prefixBytes; byteIndex += 1) {
      if (bytes[byteIndex] !== prefix.bytes[byteIndex]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    // RFC 6052 Table 1 inserts the reserved u octet at bits 64..71 for every prefix shorter
    // than /96. It must be zero; an invalid carrier is not confidently public and fails closed.
    if (prefix.length < 96 && bytes[8] !== 0) return 'special-use';

    const ipv4: number[] = [];
    let byteIndex = prefixBytes;
    while (ipv4.length < 4) {
      if (byteIndex === 8) byteIndex = 9; // skip RFC 6052's reserved u octet
      egressArrayPush(ipv4, bytes[byteIndex] ?? 0);
      byteIndex += 1;
    }
    return classifyIpv4(`${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.${ipv4[3]}`);
  }
  return null;
}

type Ipv4SpecialPurposePrefix = readonly [cidr: string, classification: PrivateAddressClass];

/**
 * Minimal covering prefixes from the IANA IPv4 Special-Purpose Address Space registry,
 * snapshot 2025-10-09. Nested registry records are covered by their parent prefix. Keeping the
 * registry as one declared table makes a newly omitted globally-reachable special-purpose range
 * visible in review instead of relying on an incomplete chain of first-octet conditions.
 *
 * Source: https://www.iana.org/assignments/iana-ipv4-special-registry/
 */
const IANA_IPV4_SPECIAL_PURPOSE_PREFIXES: readonly Ipv4SpecialPurposePrefix[] = [
  ['0.0.0.0/8', 'unspecified'],
  ['10.0.0.0/8', 'private-rfc1918'],
  ['100.64.0.0/10', 'carrier-nat'],
  ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local'],
  ['172.16.0.0/12', 'private-rfc1918'],
  ['192.0.0.0/24', 'special-use'],
  ['192.0.2.0/24', 'special-use'],
  ['192.31.196.0/24', 'special-use'],
  ['192.52.193.0/24', 'special-use'],
  ['192.88.99.0/24', 'special-use'],
  ['192.168.0.0/16', 'private-rfc1918'],
  ['192.175.48.0/24', 'special-use'],
  ['198.18.0.0/15', 'special-use'],
  ['198.51.100.0/24', 'special-use'],
  ['203.0.113.0/24', 'special-use'],
  ['240.0.0.0/4', 'special-use'],
];

/** C13: retain every broader closed verdict from the predecessor classifier as a superset. */
const CONSERVATIVE_IPV4_CLOSED_PREFIXES: readonly Ipv4SpecialPurposePrefix[] = [
  ['192.0.0.0/16', 'special-use'],
  ['192.88.0.0/16', 'special-use'],
  ['198.51.0.0/16', 'special-use'],
  ['203.0.0.0/16', 'special-use'],
  ['224.0.0.0/4', 'special-use'], // multicast is non-public even though separately registered
];

function classifyIpv4(ip: string): PrivateAddressClass {
  const octets = egressArrayMap(egressStringSplit(ip, '.'), (octet) => egressNumber(octet));
  if (
    octets.length !== 4 ||
    egressArraySome(octets, (octet) => !egressNumberIsInteger(octet) || octet < 0 || octet > 255)
  ) {
    return 'special-use';
  }
  // Cloud instance-metadata (AWS/GCP/Azure all use 169.254.169.254; AWS also 169.254.169.123 NTP,
  // 169.254.170.2 ECS task creds, 169.254.170.23 EKS Pod Identity). Treat the whole 169.254/16
  // link-local block as metadata-sensitive: it is the SSRF credential-theft surface. (A genuine
  // non-metadata 169.254 link-local target is still reachable only via allowInternal? No — see
  // classify: link-local is its own class. We single out the documented metadata IPs here and
  // leave the rest of 169.254/16 as link-local so allowInternal can reach a bespoke link-local
  // service if truly needed, while the metadata IPs require the credential frame.)
  if (octets[0] === 169 && octets[1] === 254) {
    if (
      ip === '169.254.169.254' ||
      ip === '169.254.169.123' ||
      ip === '169.254.170.2' ||
      ip === '169.254.170.23'
    ) {
      return 'metadata';
    }
    return 'link-local';
  }
  const registryClassification = classifyIpv4FromPrefixes(
    octets,
    IANA_IPV4_SPECIAL_PURPOSE_PREFIXES,
  );
  if (registryClassification !== null) return registryClassification;
  const conservativeClassification = classifyIpv4FromPrefixes(
    octets,
    CONSERVATIVE_IPV4_CLOSED_PREFIXES,
  );
  if (conservativeClassification !== null) return conservativeClassification;
  return 'public';
}

function classifyIpv4FromPrefixes(
  octets: readonly number[],
  prefixes: readonly Ipv4SpecialPurposePrefix[],
): PrivateAddressClass | null {
  for (let index = 0; index < prefixes.length; index += 1) {
    const prefix = prefixes[index]!;
    if (ipv4OctetsInCidr(octets, prefix[0])) return prefix[1];
  }
  return null;
}

function ipv4OctetsInCidr(octets: readonly number[], cidr: string): boolean {
  const cidrParts = egressStringSplit(cidr, '/');
  const rangeParts = egressStringSplit(cidrParts[0] ?? '', '.');
  const bits = egressNumber(cidrParts[1]);
  if (
    octets.length !== 4 ||
    rangeParts.length !== 4 ||
    !egressNumberIsInteger(bits) ||
    bits < 0 ||
    bits > 32
  ) {
    return false;
  }

  let address = 0;
  let network = 0;
  for (let index = 0; index < 4; index += 1) {
    address = ((address << 8) | (octets[index]! & 0xff)) >>> 0;
    network = ((network << 8) | (egressNumber(rangeParts[index]) & 0xff)) >>> 0;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (network & mask);
}

interface Ipv6Bytes {
  readonly bytes: readonly number[];
}

type Ipv6SpecialPurposeDisposition = PrivateAddressClass | 'embedded-ipv4';
type Ipv6SpecialPurposePrefix = readonly [
  prefixWords: readonly number[],
  prefixLength: number,
  disposition: Ipv6SpecialPurposeDisposition,
];

/**
 * IANA IPv6 Special-Purpose Address Space registry, snapshot 2025-10-09. Nested 2001::/23
 * records are represented by that parent. The mapped/NAT64 /96 entries follow SPEC §6.6's
 * explicit normalization rule and inherit the embedded IPv4 destination's classification.
 *
 * Source: https://www.iana.org/assignments/iana-ipv6-special-registry/
 */
const IANA_IPV6_SPECIAL_PURPOSE_PREFIXES: readonly Ipv6SpecialPurposePrefix[] = [
  [[0, 0, 0, 0, 0, 0, 0, 1], 128, 'loopback'], // ::1/128
  [[0, 0, 0, 0, 0, 0, 0, 0], 128, 'unspecified'], // ::/128
  [[0, 0, 0, 0, 0, 0xffff], 96, 'embedded-ipv4'], // ::ffff:0:0/96
  [[0x0064, 0xff9b, 0, 0, 0, 0], 96, 'embedded-ipv4'], // 64:ff9b::/96
  [[0x0064, 0xff9b, 0x0001], 48, 'special-use'],
  [[0x0100, 0, 0, 0], 64, 'special-use'],
  [[0x0100, 0, 0, 1], 64, 'special-use'],
  [[0x2001, 0], 23, 'special-use'],
  [[0x2001, 0x0db8], 32, 'special-use'],
  [[0x2002], 16, 'special-use'],
  [[0x2620, 0x004f, 0x8000], 48, 'special-use'],
  [[0x3fff, 0], 20, 'special-use'],
  [[0x5f00], 16, 'special-use'],
  [[0xfc00], 7, 'unique-local'],
  [[0xfe80], 10, 'link-local'],
];

function classifyIpv6Bytes(ip: Ipv6Bytes): PrivateAddressClass {
  const bytes = ip.bytes;
  // Azure/GCP also expose metadata over v6 link-local addresses; AWS IMDSv6 is fd00:ec2::254.
  if (canonicalizeIpv6Bytes(ip) === 'fd00:ec2::254') return 'metadata';

  const registryDisposition = classifyIpv6FromPrefixes(bytes, IANA_IPV6_SPECIAL_PURPOSE_PREFIXES);
  if (registryDisposition === 'embedded-ipv4') {
    return classifyIpv4(embeddedIpv4FromIpv6(bytes));
  }
  if (registryDisposition !== null) return registryDisposition;

  // IPv4-compatible and ISATAP forms are normalization carriers outside the live registry.
  const extractedV4 = extractedIpv4FromIpv6(bytes);
  if (extractedV4 !== null) return classifyIpv4(extractedV4);

  const firstWord = wordAt(bytes, 0);
  if ((firstWord & 0xffc0) === 0xfec0) return 'special-use'; // fec0::/10 site-local
  if ((bytes[0] ?? 0) === 0xff) return 'special-use'; // multicast ff00::/8

  // Fail closed: only genuine global unicast is public, after extracting/denying special forms.
  if ((firstWord & 0xe000) === 0x2000) return 'public'; // 2000::/3
  return 'special-use';
}

function classifyIpv6FromPrefixes(
  bytes: readonly number[],
  prefixes: readonly Ipv6SpecialPurposePrefix[],
): Ipv6SpecialPurposeDisposition | null {
  for (let index = 0; index < prefixes.length; index += 1) {
    const prefix = prefixes[index]!;
    if (ipv6MatchesPrefix(bytes, prefix[0], prefix[1])) return prefix[2];
  }
  return null;
}

function ipv6MatchesPrefix(
  bytes: readonly number[],
  prefixWords: readonly number[],
  prefixLength: number,
): boolean {
  const remainder = prefixLength % 16;
  const fullWords = (prefixLength - remainder) / 16;
  for (let index = 0; index < fullWords; index += 1) {
    if (wordAt(bytes, index) !== prefixWords[index]) return false;
  }
  if (remainder === 0) return true;
  const mask = (0xffff << (16 - remainder)) & 0xffff;
  return (wordAt(bytes, fullWords) & mask) === ((prefixWords[fullWords] ?? 0) & mask);
}

function embeddedIpv4FromIpv6(bytes: readonly number[]): string {
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function extractedIpv4FromIpv6(bytes: readonly number[]): string | null {
  const prefix96 = egressArraySlice(bytes, 0, 12);

  // ::a.b.c.d / ::hhhh:hhhh IPv4-compatible.
  if (egressArrayEvery(prefix96, (byte) => byte === 0)) return embeddedIpv4FromIpv6(bytes);

  // ::ffff:a.b.c.d / ::ffff:hhhh:hhhh IPv4-mapped.
  if (
    egressArrayEvery(egressArraySlice(bytes, 0, 10), (byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return embeddedIpv4FromIpv6(bytes);
  }

  // 64:ff9b::/96 NAT64.
  const nat64Prefix = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];
  if (egressArrayEvery(prefix96, (byte, index) => byte === nat64Prefix[index])) {
    return embeddedIpv4FromIpv6(bytes);
  }

  // ISATAP embeds IPv4 in the low 32 bits after a 0000:5efe interface-id marker:
  // <prefix>:0:5efe:w.x.y.z or <prefix>:0:5efe:hhhh:hhhh.
  if (bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0x5e && bytes[11] === 0xfe) {
    const v4 = embeddedIpv4FromIpv6(bytes);
    return classifyIpv4(v4) === 'public' ? null : v4;
  }

  return null;
}

function parseIpv6Bytes(input: string): Ipv6Bytes | null {
  const ip = egressStringToLowerCase(input);
  if (!egressStringIncludes(ip, ':') || egressStringIncludes(ip, '%')) return null;
  if (egressStringSplit(ip, '::').length > 2) return null;

  const halves = egressStringSplit(ip, '::');
  const headRaw = halves[0]!;
  const tailRaw = halves[1];
  const head = parseIpv6Side(headRaw);
  if (head === null) return null;
  const tail = tailRaw === undefined ? [] : parseIpv6Side(tailRaw);
  if (tail === null) return null;

  const missing = 8 - head.length - tail.length;
  if (tailRaw === undefined) {
    if (missing !== 0) return null;
  } else if (missing < 1) {
    return null;
  }

  const words = egressArraySlice(head);
  if (tailRaw !== undefined) {
    for (let index = 0; index < missing; index += 1) egressArrayPush(words, 0);
    for (let index = 0; index < tail.length; index += 1) egressArrayPush(words, tail[index]!);
  }
  if (words.length !== 8) return null;
  const bytes: number[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    egressArrayPush(bytes, (word >> 8) & 0xff, word & 0xff);
  }
  return { bytes };
}

function parseScopedIpv6Bytes(input: string): Ipv6Bytes | null {
  const percent = egressStringLastIndexOf(input, '%');
  if (percent <= 0 || percent === input.length - 1) return null;
  const address = egressStringSlice(input, 0, percent);
  const scope = egressStringSlice(input, percent + 1);
  if (!egressRegExpTest(/^[0-9a-z_.~-]+$/iu, scope)) return null;
  if (egressNetIsIp(input) !== 6) return null;
  return parseIpv6Bytes(address);
}

function parseIpv6Side(side: string): number[] | null {
  if (side === '') return [];
  const parts = egressStringSplit(side, ':');
  const words: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part === '') return null;
    if (egressStringIncludes(part, '.')) {
      if (index !== parts.length - 1) return null;
      const v4 = parseStrictIpv4(part);
      if (v4 === null) return null;
      egressArrayPush(words, (v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
      continue;
    }
    if (!egressRegExpTest(/^[0-9a-f]{1,4}$/u, part)) return null;
    egressArrayPush(words, egressParseInt(part, 16));
  }
  return words;
}

function parseStrictIpv4(input: string): readonly number[] | null {
  const parts = egressStringSplit(input, '.');
  if (parts.length !== 4) return null;
  const octets = egressArrayMap(parts, (part) => {
    if (!egressRegExpTest(/^(0|[1-9][0-9]*)$/u, part)) return null;
    const value = egressNumber(part);
    return egressNumberIsInteger(value) && value >= 0 && value <= 255 ? value : null;
  });
  return egressArraySome(octets, (octet) => octet === null) ? null : (octets as number[]);
}

function wordAt(bytes: readonly number[], index: number): number {
  const offset = index * 2;
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function canonicalizeIpv6Bytes(ip: Ipv6Bytes): string {
  const words: number[] = [];
  for (let index = 0; index < 8; index += 1) egressArrayPush(words, wordAt(ip.bytes, index));
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < words.length; ) {
    if (words[index] !== 0) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < words.length && words[index] === 0) index += 1;
    const length = index - start;
    if (length > bestLength && length > 1) {
      bestStart = start;
      bestLength = length;
    }
  }
  if (bestStart === -1) {
    return egressArrayJoin(
      egressArrayMap(words, (word) => egressNumberToString(word, 16)),
      ':',
    );
  }

  const left = egressArrayMap(egressArraySlice(words, 0, bestStart), (word) =>
    egressNumberToString(word, 16),
  );
  const right = egressArrayMap(egressArraySlice(words, bestStart + bestLength), (word) =>
    egressNumberToString(word, 16),
  );
  return `${egressArrayJoin(left, ':')}::${egressArrayJoin(right, ':')}`;
}

/**
 * Decide whether a connection to `host:port`, whose resolved literal IP is `resolvedIp`
 * (may equal `host` when `host` is already an IP literal), is permitted under `policy` and
 * the current async metadata frame. Returns null when permitted, or an
 * {@link EgressBlockedError} to throw when denied. This is the *only* policy decision point;
 * both enforcement layers call it.
 */
export function evaluateEgress(args: {
  host: string;
  port: number;
  protocol?: 'http:' | 'https:' | undefined;
  resolvedIp: string;
  policy: EgressPolicy;
  requireDestinationAllowlist?: boolean | undefined;
}): EgressBlockedError | null {
  return evaluateEgressDecision(args);
}

function evaluateSocketEgress(
  args: {
    host: string;
    port: number;
    protocol?: 'http:' | 'https:' | undefined;
    resolvedIp: string;
    policy: EgressPolicy;
    requireDestinationAllowlist?: boolean | undefined;
  },
  socket: net.Socket,
): EgressBlockedError | null {
  return evaluateEgressDecision(args, witnessWeakMapGet(databaseEgressSocketEndpoints, socket));
}

function evaluateEgressDecision(
  args: {
    host: string;
    port: number;
    protocol?: 'http:' | 'https:' | undefined;
    resolvedIp: string;
    policy: EgressPolicy;
    requireDestinationAllowlist?: boolean | undefined;
  },
  databaseSocketEndpoint?: string,
): EgressBlockedError | null {
  const { host, port, protocol, resolvedIp, policy } = args;
  if (args.requireDestinationAllowlist) {
    const blocked = evaluateDestinationAllowlist({ host, port, protocol, resolvedIp, policy });
    if (blocked) return blocked;
  }
  if (isNodeAcceptedUnnormalizedIpLiteral(resolvedIp)) {
    return new EgressBlockedError({
      destination: `${host}:${port}`,
      resolvedIp,
      classification: 'special-use',
    });
  }
  // SPEC §6.6: Azure App Service exposes managed-identity tokens on the configured
  // IDENTITY_ENDPOINT, commonly a 127/8 authority. Treat that exact authority (and the resolved
  // loopback spelling it pins) as metadata BEFORE ordinary public/private/allowInternal routing.
  // Only azureCredential() provenance opens it; AWS/GCP frames and every operator allowlist remain
  // unable to turn it into a generic SSRF target.
  if (
    isAzureIdentityDestination({
      endpoint: policy[azureIdentityEndpointPolicy],
      host,
      port,
      resolvedIp,
    })
  ) {
    if (isMetadataAllowed('azure')) return null;
    return new EgressBlockedError({
      destination: `${host}:${port}`,
      resolvedIp,
      classification: 'metadata',
      metadata: true,
    });
  }
  const cls = classifyIpForPolicy(resolvedIp, policy);
  if (cls === 'public') return null;

  if (cls === 'metadata') {
    if (isMetadataAllowed()) return null;
    return new EgressBlockedError({
      destination: `${host}:${port}`,
      resolvedIp,
      classification: cls,
      metadata: true,
    });
  }

  // Any other non-public class: permitted only by an exact host:port allowlist match, against
  // BOTH the original host token (e.g. "localhost:11434", "otel:4318") and the resolved IP
  // (e.g. "127.0.0.1:11434", "10.0.5.2:6379"). Matching the host token lets operators allowlist
  // a stable name; matching the resolved IP lets them allowlist by address.
  if (policy.allowPrivateNetwork) return null;

  const hostKey = `${egressStringToLowerCase(host)}:${port}`;
  const ipKey = `${egressStringToLowerCase(resolvedIp)}:${port}`;
  if (egressSetHas(policy.allowInternal, hostKey) || egressSetHas(policy.allowInternal, ipKey)) {
    return null;
  }
  if (
    databaseSocketEndpoint !== undefined &&
    egressSetHas(policy.allowDatabaseEndpoints, databaseSocketEndpoint) &&
    (databaseSocketEndpoint === hostKey || databaseSocketEndpoint === ipKey)
  ) {
    return null;
  }

  // CIDR fallback (operator opted into a broad range, warned at boot).
  if (egressArraySome(policy.allowInternalCidrs, (cidr) => ipInCidr(resolvedIp, cidr))) return null;

  return new EgressBlockedError({
    destination: `${host}:${port}`,
    resolvedIp,
    classification: cls,
  });
}

function evaluateDestinationAllowlist(args: {
  host: string;
  port: number;
  protocol?: 'http:' | 'https:' | undefined;
  resolvedIp: string;
  policy: EgressPolicy;
}): EgressBlockedError | null {
  const { host, port, protocol, resolvedIp, policy } = args;
  const origin = canonicalHttpOrigin(protocol, host, port);
  if (origin === null) {
    return new EgressBlockedError({
      destination: `${host}:${port}`,
      resolvedIp,
      classification: classifyIpForPolicy(resolvedIp, policy),
      reason: 'destination-allowlist',
    });
  }
  if (egressSetHas(policy.allowDestinations, origin)) return null;
  return new EgressBlockedError({
    destination: origin,
    resolvedIp,
    classification: classifyIpForPolicy(resolvedIp, policy),
    reason: 'destination-allowlist',
  });
}

/** Reject an undeclared framework origin before any DNS lookup or transport dispatch. */
export function evaluateFrameworkDestinationOrigin(args: {
  host: string;
  port: number;
  protocol: string | undefined;
  policy: EgressPolicy;
}): EgressBlockedError | null {
  const origin = canonicalHttpOrigin(args.protocol, args.host, args.port);
  if (origin !== null && egressSetHas(args.policy.allowDestinations, origin)) return null;
  return new EgressBlockedError({
    destination: origin ?? `${args.host}:${args.port}`,
    classification: 'special-use',
    reason: 'destination-allowlist',
  });
}

/**
 * Framework-owned HTTP egress choke (DEC6). This helper is intentionally stricter than the
 * process-global transport floor: it requires an active floor plus an exact
 * `egress.allowDestinations` origin before delegating to `fetch`. The transport floor still
 * performs resolved-IP validation, so DNS rebinding to private/metadata addresses remains
 * denied at the sink.
 */
export const frameworkEgressFetch: typeof globalThis.fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const policy = activeEgressPolicy();
  if (!policy) {
    throw new EgressBlockedError({
      destination: requestDestination(input),
      classification: 'special-use',
      reason: 'missing-floor',
    });
  }
  let request: Request;
  try {
    // SPEC §6.6 rule 5: normalize caller-owned URL/init/Request carriers once. Passing the pinned
    // Request to native fetch both prevents post-check mutation and preserves native redirect
    // method, body, header, credential-stripping, referrer, abort, and manual/error semantics.
    // Calling fetch with only this Request also prevents a nonstandard per-call dispatcher from
    // bypassing the framework-owned dispatcher on later hops.
    request = egressRequest(input, init);
  } catch {
    throw new EgressBlockedError({
      destination: requestDestination(input),
      classification: 'special-use',
      reason: 'destination-allowlist',
    });
  }
  const requestUrl = egressRequestUrl(request);
  const url = egressUrl(requestUrl);

  // The strict dispatcher is load-bearing for redirect hops: net.connect sees only dials, not
  // every pooled request, and it does not know that this call requires allowDestinations. Refuse
  // the framework surface when either half of the dual floor is missing or has been replaced.
  // This import is deliberately after the synchronous Request snapshot above: native fetch pins
  // caller-owned URL/init carriers before yielding, and the security wrapper must do the same.
  const dispatcher = activeUndiciFloorDispatcher();
  if (dispatcher === undefined) {
    throw new EgressBlockedError({
      destination: requestUrl,
      classification: 'special-use',
      reason: 'missing-floor',
    });
  }
  // Undici Request objects retain a non-standard per-call dispatcher in private state. Rebind
  // the already-snapshotted Request to the exact installed framework dispatcher before any
  // request can run; this keeps native replayable-body/redirect semantics while closing proxy
  // and custom-dispatcher bypasses through ctx.fetch.
  request = egressRequestWithDispatcher(request, dispatcher);

  const protocol = egressUrlProtocol(url);
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new EgressBlockedError({
      destination: requestUrl,
      classification: 'special-use',
      reason: 'destination-allowlist',
    });
  }
  const host = stripIpv6Brackets(egressDecodeURIComponent(egressUrlHostname(url)));
  const port = normalizedUrlPort(url);
  const originBlocked = evaluateFrameworkDestinationOrigin({ host, port, protocol, policy });
  if (originBlocked) throw originBlocked;
  // Classify the initial request before native fetch can observe an abort or other caller state.
  // The dispatcher repeats this all-address decision for every request/redirect hop; the net
  // layer independently rechecks and pins the exact resolver result used by each new dial.
  const literalIp = normalizeFastPathIpLiteral(host);
  if (literalIp !== null) {
    const blocked = evaluateEgress({
      host,
      port,
      protocol,
      resolvedIp: literalIp,
      policy,
      requireDestinationAllowlist: true,
    });
    if (blocked) throw blocked;
  } else if (isNodeAcceptedUnnormalizedIpLiteral(host)) {
    throw new EgressBlockedError({
      destination: `${host}:${port}`,
      resolvedIp: host,
      classification: 'special-use',
      reason: 'destination-allowlist',
    });
  } else {
    const resolved = await lookupAllAddresses(host);
    if (resolved.length === 0) {
      throw new EgressBlockedError({
        destination: `${host}:${port}`,
        classification: 'special-use',
        reason: 'destination-allowlist',
      });
    }
    for (let index = 0; index < resolved.length; index += 1) {
      const blocked = evaluateEgress({
        host,
        port,
        protocol,
        resolvedIp: resolved[index]!.address,
        policy,
        requireDestinationAllowlist: true,
      });
      if (blocked) throw blocked;
    }
  }
  // Keep redirect handling inside native fetch. Its HTTP(S)-scheme rejection, 20-hop bound,
  // 301/302/303 rewrites, 307/308 replay rules, cross-origin credential stripping, and manual/error
  // modes remain authoritative; the dispatcher below re-runs the pinned policy on every hop.
  return frameworkEgressPolicyContext.run(policy, () => frameworkEgressNativeFetch(request));
}) as typeof globalThis.fetch;

function lookupAllAddresses(host: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(addresses);
    });
  });
}

function requestDestination(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  try {
    return egressUrlToString(egressUrl(input as URL));
  } catch {
    try {
      return egressRequestUrl(input as Request);
    } catch {
      return '<invalid-egress-destination>';
    }
  }
}

/** Minimal IPv4 CIDR membership for the broad-range fallback. IPv6 CIDR ranges are not honored. */
function ipInCidr(ip: string, cidr: string): boolean {
  const cidrParts = egressStringSplit(cidr, '/');
  const range = cidrParts[0];
  const bitsStr = cidrParts[1];
  if (!range || bitsStr === undefined) return false;
  if (egressNetIsIp(ip) !== 4 || egressNetIsIp(range) !== 4) return false;
  const bits = egressNumber(bitsStr);
  if (!egressNumberIsInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (value: string): number => {
    const octets = egressStringSplit(value, '.');
    let result = 0;
    for (let index = 0; index < octets.length; index += 1) {
      result = ((result << 8) | (egressNumber(octets[index]) & 0xff)) >>> 0;
    }
    return result >>> 0;
  };
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(range) & mask);
}

// ---------------------------------------------------------------------------
// Layer (b): net.Socket.prototype.connect enforcement.
//
// Covers raw node:http/node:https (AWS IMDS via @smithy uses these and bypasses undici) AND
// undici/fetch (which dials through net underneath). We intercept connect, classify the
// destination, and — crucially — inject a `lookup` that classifies the RESOLVED IP and PINS
// it, so a DNS rebind cannot return a public IP to our pre-check and a private IP to the
// real socket. When the host is already an IP literal, no lookup runs; we classify it directly.
// ---------------------------------------------------------------------------

interface ConnectOptions {
  host?: string;
  port?: number | string;
  path?: string | null;
  lookup?: typeof dns.lookup;
  [key: string]: unknown;
}

type ConnectFn = (...args: unknown[]) => net.Socket;

interface NetConnectFloorState {
  hardening: {
    mode: EgressHardeningMode;
    warn: (message: string) => void;
  };
  httpAgentWrapper?: AddRequestFn;
  installOwner: object;
  originalConnect: ConnectFn;
  originalHttpAgentAddRequest?: AddRequestFn;
  policy: EgressPolicy;
  wrapper: ConnectFn;
}

// SPEC §6.6: app modules execute in this process before createApp(). Floor identity and policy
// therefore stay in module-private closure state; Symbol.for properties on the public node:net
// module are forgeable and cannot authenticate either the wrapper or the startup self-probe.
let netConnectFloorState: NetConnectFloorState | undefined;

type AddRequestFn = (
  this: http.Agent,
  req: http.ClientRequest,
  options: AgentRequestOptions,
) => void;

interface AgentRequestOptions {
  host?: string;
  hostname?: string;
  port?: number | string;
  defaultPort?: number | string;
  protocol?: string;
  socketPath?: string;
  [key: string]: unknown;
}

type AgentSocket = net.Socket & { remotePort?: number };

/**
 * Install the `net.Socket.prototype.connect` enforcement layer for `policy`. Idempotent: a
 * re-install replaces the active policy without re-wrapping (so APM tools that also patch the
 * prototype are not double-wrapped). Returns an `uninstall()` for tests. SPEC §6.6.
 *
 * Residual fail-open (documented, by design — this is a FLOOR not a proof):
 *   - Same-process app code can re-assign `net.Socket.prototype.connect` after us.
 *   - A `Worker`/`child_process` does NOT inherit this monkeypatch; each worker bootstrap must
 *     re-install (see {@link installEgressFloor}).
 *   - Native addons / FFI that open sockets without going through `net` are not seen.
 *   - Unix-domain-socket connects are denied because path-only dials can reach local privileged
 *     HTTP services without presenting an IP address to the classifier.
 */
export function installNetConnectFloor(
  policy: EgressPolicy,
  hardening: EgressHardeningMode = 'off',
  warn: (message: string) => void = (m) => console.warn(`[kovo egress] ${m}`),
): () => void {
  const proto = net.Socket.prototype as unknown as { connect: ConnectFn };
  const installOwner = {};

  if (netConnectFloorState !== undefined) {
    // Already installed — just swap the active policy.
    netConnectFloorState.policy = policy;
    installHttpAgentReuseFloor(netConnectFloorState);
    applyNetConnectHardening(netConnectFloorState, proto, hardening, warn);
    netConnectFloorState.installOwner = installOwner;
    return makeUninstall(netConnectFloorState, proto, installOwner);
  }

  const original = proto.connect;
  let state: NetConnectFloorState;

  const patchedConnect = function patchedConnect(this: net.Socket, ...args: unknown[]): net.Socket {
    const activePolicy = state.policy;

    const options = normalizeConnectOptions(args);
    if (options !== null) {
      const path = stableConnectTargetValue(options, 'path');
      if (path != null) {
        // UDS remains ambient-default-denied. Only the exact path derived from a validated managed
        // Postgres URL may pass, and only on the framework-created socket carrying that private
        // witness. Registering the URL cannot open the path to unrelated process callers.
        if (
          typeof path !== 'string' ||
          witnessWeakMapGet(databaseEgressSocketEndpoints, this) !== `unix:${path}`
        ) {
          throw unixDomainSocketBlocked();
        }
        return egressApply(original, this, args);
      }
    }
    if (!options || options.host === undefined || options.host === '') {
      // Unparseable forms retain Node's own argument validation. Recognized path-only forms were
      // denied above before the original connect function could open a local service socket.
      return egressApply(original, this, args);
    }
    const host = options.host;
    const port = egressNumber(options.port ?? 0);

    // If host is already an IP literal, classify + decide synchronously before connecting.
    const literalIp = normalizeFastPathIpLiteral(host);
    if (literalIp !== null) {
      const blocked = evaluateSocketEgress(
        { host, port, resolvedIp: literalIp, policy: activePolicy },
        this,
      );
      if (blocked) {
        // Throw on the connect call so fetch/http.get reject with the typed error.
        throw blocked;
      }
      return egressApply(original, this, args);
    }
    if (isNodeAcceptedUnnormalizedIpLiteral(host)) {
      throw new EgressBlockedError({
        destination: `${host}:${port}`,
        resolvedIp: host,
        classification: 'special-use',
      });
    }

    // Hostname: inject a pinning lookup that validates the RESOLVED IP and rejects before the
    // socket dials, defeating DNS rebinding (the answer we validate is the answer we connect to).
    const userLookup = options.lookup;
    options.lookup = ((
      hostname: string,
      lookupOptions: unknown,
      callback: (err: Error | null, address: string, family: number) => void,
    ) => {
      const cb =
        typeof lookupOptions === 'function'
          ? (lookupOptions as (err: Error | null, a: string, f: number) => void)
          : callback;
      const opts = typeof lookupOptions === 'function' ? {} : (lookupOptions as object);
      const resolver = (userLookup ?? dns.lookup) as typeof dns.lookup;
      egressApply<void>(resolver, dns, [
        hostname,
        opts as dns.LookupOptions,
        (err: Error | null, address: string | LookupAddress[], family: number) => {
          if (err) return cb(err, address as unknown as string, family as unknown as number);
          // SPEC §6.6 rule 2 ("the answer we validate is the answer we connect to"): classify
          // EVERY resolved IP, not just address[0]. Under Node's default autoSelectFamily the
          // lookup is invoked with `{ all: true }` and `address` is a `LookupAddress[]` that
          // RFC-8305 happy-eyeballs may dial at ANY index when an earlier record is slow/refused.
          // Validating only address[0] and then forwarding the whole array (the old bug) let a
          // multi-A answer like `[<public>, 169.254.169.254]` (or `[<public>, 127.0.0.1]`) pass
          // the floor and then connect to the private sibling — SSRF/DNS-rebind to cloud metadata.
          // Fail the WHOLE lookup CLOSED if any entry is non-public/not-allowlisted; never forward
          // an unvalidated array on the strength of one passing record.
          if (egressArrayIsArray(address)) {
            for (let index = 0; index < address.length; index += 1) {
              const entry = address[index] as LookupAddress;
              const blocked = evaluateSocketEgress(
                {
                  host,
                  port,
                  resolvedIp: entry.address,
                  policy: activePolicy,
                },
                this,
              );
              if (blocked) return cb(blocked, entry.address, family as unknown as number);
            }
            return cb(null, address as unknown as string, family as unknown as number);
          }
          const resolvedIp = address as string;
          const blocked = evaluateSocketEgress(
            { host, port, resolvedIp, policy: activePolicy },
            this,
          );
          if (blocked) return cb(blocked, resolvedIp, family as unknown as number);
          cb(null, address as unknown as string, family as unknown as number);
        },
      ]);
    }) as typeof dns.lookup;

    return egressApply(original, this, args);
  } as ConnectFn;

  state = {
    hardening: { mode: hardening, warn },
    installOwner,
    originalConnect: original,
    policy,
    wrapper: patchedConnect,
  };
  netConnectFloorState = state;
  proto.connect = patchedConnect;
  installHttpAgentReuseFloor(state);
  applyNetConnectHardening(state, proto, hardening, warn);

  return makeUninstall(state, proto, installOwner);
}

function installHttpAgentReuseFloor(state: NetConnectFloorState): void {
  const agentProto = http.Agent.prototype as unknown as { addRequest: AddRequestFn };
  if (state.originalHttpAgentAddRequest !== undefined) return;

  const original = agentProto.addRequest;
  state.originalHttpAgentAddRequest = original;

  const patchedAddRequest = function patchedAddRequest(
    this: http.Agent,
    req: http.ClientRequest,
    options: AgentRequestOptions,
  ): void {
    const activePolicy = state.policy;

    const blocked = evaluateHttpAgentRequest(this, options, activePolicy);
    if (blocked) {
      // Raw node:http/node:https keep-alive reuse skips net.Socket.prototype.connect. Deny the
      // request at the agent boundary so a socket opened before Kovo installed the SPEC §6.6
      // runtime floor cannot carry another request to a now-blocked private destination.
      throw blocked;
    }

    return egressApply(original, this, [req, options]);
  };

  state.httpAgentWrapper = patchedAddRequest;
  agentProto.addRequest = patchedAddRequest;
}

function evaluateHttpAgentRequest(
  agent: http.Agent,
  options: AgentRequestOptions,
  policy: EgressPolicy,
): EgressBlockedError | null {
  if (stableConnectTargetValue(options, 'socketPath') != null) {
    return unixDomainSocketBlocked();
  }
  const host = egressString(options.hostname ?? options.host ?? 'localhost');
  const port = egressNumber(
    options.port ?? options.defaultPort ?? (options.protocol === 'https:' ? 443 : 80),
  );
  const literalIp = normalizeFastPathIpLiteral(host);
  if (literalIp !== null) {
    return evaluateEgress({ host, port, resolvedIp: literalIp, policy });
  }
  if (isNodeAcceptedUnnormalizedIpLiteral(host)) {
    return new EgressBlockedError({
      destination: `${host}:${port}`,
      resolvedIp: host,
      classification: 'special-use',
    });
  }

  const getName = (agent as unknown as { getName?: (opts: AgentRequestOptions) => string }).getName;
  const name =
    typeof getName === 'function' ? egressApply<string>(getName, agent, [options]) : undefined;
  const agentState = agent as unknown as {
    freeSockets?: Record<string, AgentSocket[]>;
    sockets?: Record<string, AgentSocket[]>;
  };
  const socketGroups = name
    ? egressArrayFilter(
        [agentState.freeSockets?.[name], agentState.sockets?.[name]],
        (sockets): sockets is AgentSocket[] => sockets !== undefined && sockets.length > 0,
      )
    : [];
  if (socketGroups.length === 0) return null;

  for (let groupIndex = 0; groupIndex < socketGroups.length; groupIndex += 1) {
    const sockets = socketGroups[groupIndex]!;
    for (let socketIndex = 0; socketIndex < sockets.length; socketIndex += 1) {
      const socket = sockets[socketIndex]!;
      const resolvedIp = socket.remoteAddress;
      if (!resolvedIp) continue;
      const socketPort = egressNumber(socket.remotePort ?? port);
      const blocked = evaluateEgress({ host, port: socketPort, resolvedIp, policy });
      if (blocked) {
        for (
          let destroyGroupIndex = 0;
          destroyGroupIndex < socketGroups.length;
          destroyGroupIndex += 1
        ) {
          const group = socketGroups[destroyGroupIndex]!;
          for (let pooledIndex = 0; pooledIndex < group.length; pooledIndex += 1) {
            group[pooledIndex]!.destroy(blocked);
          }
        }
        return blocked;
      }
    }
  }
  return null;
}

function makeUninstall(
  state: NetConnectFloorState,
  proto: { connect: ConnectFn },
  installOwner: object,
): () => void {
  return () => {
    if (netConnectFloorState !== state || state.installOwner !== installOwner) return;
    egressObjectDefineProperty(proto, 'connect', {
      value: state.originalConnect,
      writable: true,
      configurable: true,
    });
    if (state.originalHttpAgentAddRequest !== undefined) {
      egressObjectDefineProperty(http.Agent.prototype, 'addRequest', {
        value: state.originalHttpAgentAddRequest,
        writable: true,
        configurable: true,
      });
    }
    netConnectFloorState = undefined;
  };
}

function applyNetConnectHardening(
  state: NetConnectFloorState,
  proto: { connect: ConnectFn },
  mode: EgressHardeningMode,
  warn: (message: string) => void,
): void {
  const wrapper = state.wrapper;
  state.hardening = { mode, warn };
  if (mode === 'off') {
    egressObjectDefineProperty(proto, 'connect', {
      value: wrapper,
      writable: true,
      configurable: true,
    });
    return;
  }
  if (mode === 'freeze') {
    egressObjectDefineProperty(proto, 'connect', {
      value: wrapper,
      writable: false,
      configurable: true,
    });
    return;
  }

  let current: ConnectFn = wrapper;
  egressObjectDefineProperty(proto, 'connect', {
    configurable: true,
    get() {
      return current;
    },
    set(next: ConnectFn) {
      if (next !== wrapper) {
        warn(
          'TAMPER: net.Socket.prototype.connect was reassigned after Kovo installed the ' +
            'egress floor. The net.connect layer is no longer trusted in this process; ' +
            're-install installEgressFloor() before serving requests. This warning is a ' +
            'runtime defense-in-depth signal, not sandbox protection (SPEC §6.6).',
        );
      }
      current = next;
    },
  });
}

/**
 * Coerce the polymorphic `net.connect`/`socket.connect` argument forms into a single
 * `{host, port, lookup}` options object we can read and mutate.
 *
 * Forms we see:
 *   - `connect(options[, cb])` — the public form.
 *   - `connect([options, cb])` — node's `net.createConnection` (used by `http.Agent` and by
 *     `https`) pre-normalizes its args via `normalizeArgs` and calls
 *     `socket.connect(normalizedArgs)` where `normalizedArgs` is the array `[options, cb]`.
 *     This is the form raw `node:http`/`node:https` (and AWS IMDS via @smithy) actually take,
 *     so we MUST unwrap it or the floor reads `host === undefined` and fails open.
 *   - `connect(port[, host][, cb])` — synthesize an options object.
 *   - `connect(path[, cb])` — synthesize a path object so the sink can deny UDS.
 *
 * Mutating the returned options object in place propagates our injected `lookup`.
 */
function normalizeConnectOptions(args: unknown[]): ConnectOptions | null {
  let first = args[0];
  // Unwrap node's normalizeArgs array form: socket.connect([options, cb]).
  if (egressArrayIsArray(first)) {
    const inner = first[0];
    if (inner && typeof inner === 'object') return inner as ConnectOptions;
    first = inner;
  }
  if (first && typeof first === 'object') {
    return first as ConnectOptions;
  }
  if (
    typeof first === 'number' ||
    (typeof first === 'string' && egressRegExpTest(/^\d+$/u, first))
  ) {
    // (port, host?, cb?) — host is the next string arg.
    const port = egressNumber(first);
    const second = args[1];
    const host = typeof second === 'string' ? second : '127.0.0.1';
    const synthesized: ConnectOptions = { host, port };
    // Replace args so the options object (with our lookup) is what `connect` sees.
    egressArraySplice(
      args,
      0,
      args[1] !== undefined && typeof args[1] !== 'function' ? 2 : 1,
      synthesized,
    );
    return synthesized;
  }
  // (path, cb) — preserve a recognized UDS target for the default-deny sink above.
  return typeof first === 'string' ? { path: first } : null;
}

function stableConnectTargetValue(options: object, property: 'path' | 'socketPath'): unknown {
  const before = egressReflectGet(options, property, options);
  const after = egressReflectGet(options, property, options);
  if (!egressObjectIs(before, after)) throw unixDomainSocketBlocked();
  return before;
}

function unixDomainSocketBlocked(): EgressBlockedError {
  return new EgressBlockedError({
    classification: 'special-use',
    destination: 'unix-domain-socket',
    reason: 'unix-domain-socket',
  });
}

/**
 * Whether the net-connect floor is currently installed. Used by the bootstrap self-probe to
 * LOUDLY warn when a server starts without the floor active (SPEC §6.6).
 */
export function isNetConnectFloorInstalled(): boolean {
  return netConnectFloorTamperStatus().installed;
}

/** The policy currently enforced by the net-connect floor, if installed. */
export function activeEgressPolicy(): EgressPolicy | undefined {
  return netConnectFloorState?.policy;
}

/** Inspect whether the active net-connect hook is still Kovo's wrapper (SPEC §6.6 self-probe). */
export function netConnectFloorTamperStatus(): {
  installed: boolean;
  tampered: boolean;
  hardening: EgressHardeningMode;
} {
  const proto = net.Socket.prototype as unknown as { connect: ConnectFn };
  const state = netConnectFloorState;
  const installed = state !== undefined && proto.connect === state.wrapper;
  return {
    installed,
    tampered: state !== undefined && proto.connect !== state.wrapper,
    hardening: state?.hardening.mode ?? 'off',
  };
}
