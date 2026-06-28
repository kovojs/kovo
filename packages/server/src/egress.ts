import { AsyncLocalStorage } from 'node:async_hooks';
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import type { LookupAddress } from 'node:dns';

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
 *     (the resolved-IP check at `net.Socket.prototype.connect`). It is **NEVER** a
 *     by-construction proof: privileged same-process app code can re-patch the prototype,
 *     spawn a worker/child process that doesn't inherit the hook, or open a native socket
 *     the JS layer never sees. Those are documented residual fail-open holes (see
 *     {@link installEgressFloor} doc and the SPEC section).
 *   - **Non-goal: data exfiltration.** This floor allows *all public egress* — it does
 *     NOT stop a request to `attacker.example.com`. Stopping exfiltration needs a
 *     *positive* destination allowlist (a different, app-specific control); this floor
 *     deliberately does not impose one. Document that gap to the operator.
 *   - **Non-goal: a code sandbox.** This is not a defense against intentionally malicious
 *     in-process code, only against an SSRF *coaxing trusted code* to the wrong IP.
 *
 * DESIGN (SPEC §6.6).
 *   - Public / external IPs: **UNRESTRICTED**.
 *   - Private / loopback / link-local / unique-local / CGNAT / IANA-special IPs: **DENIED**
 *     by default, reachable only when the exact `host:port` is in the operator's narrow
 *     `egress.allowInternal` allowlist.
 *   - The cloud instance-metadata IP and Azure IMDS loopback: **DENIED** by default and —
 *     critically — **NOT** reachable via `allowInternal`. Reachable only inside the
 *     module-private {@link metadataAllowed} `AsyncLocalStorage` frame, which is entered
 *     ONLY by the per-cloud credential factories. A reflected SSRF never calls a factory,
 *     so it never enters the frame, so metadata stays denied at the very same IP.
 *   - Enforcement is **dual-layer**: (a) `net.Socket.prototype.connect` (covers raw
 *     `node:http`/`node:https` — AWS IMDS via @smithy bypasses undici entirely — *and*
 *     undici/`fetch`, which dials through `net` underneath), pinning the validated IP via
 *     an injected `lookup` so a TOCTOU DNS-rebind can't swap a public answer for a private
 *     one between check and connect; (b) a custom undici dispatcher at the per-request
 *     `dispatch()` level (see `egress-undici.ts`) so pooled-socket reuse — which skips
 *     `beforeConnect`/the `net` dial on the second request — is still gated.
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
  /** Suggested HTTP status for adapters that surface this on the wire (SPEC §9.5). */
  readonly status = 502;

  constructor(args: {
    destination: string;
    resolvedIp?: string | undefined;
    classification: PrivateAddressClass;
    metadata?: boolean;
  }) {
    const where =
      args.resolvedIp && args.resolvedIp !== args.destination.split(':')[0]
        ? `${args.destination} (resolved to ${args.resolvedIp})`
        : args.destination;
    const remediation = args.metadata
      ? 'Cloud instance-metadata is reachable only inside an awsCredential()/gcpCredential()/' +
        'azureCredential() frame, never via egress.allowInternal.'
      : `If this internal destination is intended, add "${args.destination}" to ` +
        'createApp({ egress: { allowInternal: [...] } }).';
    super(
      `Outbound egress to ${where} was blocked by the Kovo private-network deny floor ` +
        `(${args.classification}; SPEC §6.6 runtime defense-in-depth). ${remediation}`,
    );
    this.destination = args.destination;
    this.resolvedIp = args.resolvedIp;
    this.classification = args.classification;
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
const metadataAllowed = new AsyncLocalStorage<true>();

/**
 * Enter the metadata-allowed frame for the duration of `fn`. Module-internal: exported only
 * for the credential-factory module within this package; it is NOT part of the public API
 * surface and MUST NOT be re-exported from the package barrel.
 *
 * @internal
 */
export function runWithMetadataAccess<T>(fn: () => T): T {
  return metadataAllowed.run(true, fn);
}

/** Whether the current async context is inside a credential-factory metadata frame. */
function isMetadataAllowed(): boolean {
  return metadataAllowed.getStore() === true;
}

/** Resolved egress policy after normalizing operator config. */
export interface EgressPolicy {
  /** `host:port` (lowercased host) entries permitted to reach a private/loopback IP. */
  readonly allowInternal: ReadonlySet<string>;
  /** Broad-CIDR entries the operator passed (flagged + warned, honored as a fallback). */
  readonly allowInternalCidrs: readonly string[];
  /**
   * Internal dev-only posture: keep the floor installed and metadata blocked, but permit
   * non-metadata private/loopback/link-local destinations so local sidecars do not brick.
   */
  readonly allowPrivateNetwork: boolean;
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
   * Optional same-process tamper hardening for the transport monkeypatches.
   *
   * - `off` (default): only self-probes detect later monkeypatch drift.
   * - `warn`: installs a warning setter around `net.Socket.prototype.connect`, so ordinary
   *   late reassignment is reported immediately. Undici global-dispatcher drift is still
   *   detected by self-probes because its ESM export cannot be frozen reliably here.
   * - `freeze`: makes the net-connect descriptor non-writable against ordinary reassignment.
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
  const allowInternal = new Set<string>();
  const allowInternalCidrs: string[] = [];
  for (const raw of options?.allowInternal ?? []) {
    const entry = String(raw).trim();
    if (entry === '') continue;
    // CIDR notation: flag + warn (broad ranges widen the floor), honor as a fallback range.
    if (entry.includes('/')) {
      warn(
        `allowInternal entry "${entry}" is a CIDR range. A broad CIDR widens the private-network ` +
          'floor; prefer narrow host:port entries. Honored as a range fallback.',
      );
      allowInternalCidrs.push(entry);
      continue;
    }
    const parsed = parseHostPort(entry);
    if (!parsed) {
      warn(
        `allowInternal entry "${entry}" is not a valid host:port (e.g. "10.0.5.2:6379"); ignored.`,
      );
      continue;
    }
    // A metadata-IP allowlist entry is rejected loudly — it must never re-open the path.
    const cls = classifyIp(parsed.host);
    if (cls === 'metadata') {
      throw new EgressConfigError(METADATA_ALLOWLIST_REJECT, entry);
    }
    if (cls === 'public') {
      warn(
        `allowInternal entry "${entry}" is a public address; public egress is already unrestricted, ` +
          'so this entry is redundant.',
      );
    }
    allowInternal.add(`${parsed.host.toLowerCase()}:${parsed.port}`);
  }
  return {
    allowInternal,
    allowInternalCidrs,
    allowPrivateNetwork: policyOptions.allowPrivateNetwork === true,
  };
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
  if (entry.startsWith('[')) {
    const close = entry.indexOf(']');
    if (close < 0) return null;
    host = entry.slice(1, close);
    const rest = entry.slice(close + 1);
    if (!rest.startsWith(':')) return null;
    portStr = rest.slice(1);
  } else {
    const idx = entry.lastIndexOf(':');
    if (idx < 0) return null;
    host = entry.slice(0, idx);
    portStr = entry.slice(idx + 1);
  }
  const port = Number(portStr);
  if (host === '' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
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
  const h = host.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (h === '') return null;

  // Already-canonical IPv4/IPv6 fast path.
  if (net.isIP(h) !== 0) return canonicalizeKnownIp(h);

  // IPv4-mapped / -compat or NAT64 embedded in IPv6 text, e.g. ::ffff:169.254.169.254,
  // ::ffff:7f00:1, 64:ff9b::a9fe:a9fe — net.isIP handles the textual forms; the embedded
  // v4 is extracted by canonicalizeKnownIp below once recognized as v6.

  // Bare IPv4 in decimal/octal/hex (any of the 1–4 part forms inet_aton accepts).
  const v4 = parseLooseIpv4(h);
  if (v4 !== null) return v4;

  return null;
}

/** Re-emit a recognized IP in a canonical, classification-friendly form. */
function canonicalizeKnownIp(ip: string): string {
  const fam = net.isIP(ip);
  if (fam === 4) return ip;
  // IPv6: lower-case; leave compression as-is (classification reads prefixes, not exact text).
  return ip.toLowerCase();
}

/**
 * Parse the loose IPv4 forms `inet_aton`/`URL` historically accept: 1–4 dotted parts, each in
 * decimal, octal (`0NNN`), or hex (`0xNN`), with the final part absorbing the remaining bytes.
 * Returns canonical dotted-quad or null.
 */
export function parseLooseIpv4(input: string): string | null {
  const parts = input.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (part === '') return null;
    let value: number;
    if (/^0x[0-9a-f]+$/i.test(part)) value = parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8);
    else if (/^0$/.test(part)) value = 0;
    else if (/^[1-9][0-9]*$/.test(part)) value = parseInt(part, 10);
    else return null;
    if (!Number.isInteger(value) || value < 0) return null;
    nums.push(value);
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
    if (nums.some((x) => x > 0xff)) return null;
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
  const ip = normalizeIpLiteral(host) ?? host;
  const fam = net.isIP(ip);
  if (fam === 4) return classifyIpv4(ip);
  if (fam === 6) return classifyIpv6(ip);
  // Not an IP at all (e.g. a hostname slipped through) → fail closed.
  return 'special-use';
}

function classifyIpv4(ip: string): PrivateAddressClass {
  const octets = ip.split('.').map((o) => Number(o));
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return 'special-use';
  }
  const [a, b] = octets as [number, number, number, number];
  // Cloud instance-metadata (AWS/GCP/Azure all use 169.254.169.254; AWS also 169.254.169.123 NTP,
  // 169.254.170.2 ECS task creds, 169.254.170.23 EKS Pod Identity). Treat the whole 169.254/16
  // link-local block as metadata-sensitive: it is the SSRF credential-theft surface. (A genuine
  // non-metadata 169.254 link-local target is still reachable only via allowInternal? No — see
  // classify: link-local is its own class. We single out the documented metadata IPs here and
  // leave the rest of 169.254/16 as link-local so allowInternal can reach a bespoke link-local
  // service if truly needed, while the metadata IPs require the credential frame.)
  if (a === 169 && b === 254) {
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
  if (a === 127) return 'loopback';
  if (a === 0) return 'unspecified';
  if (a === 10) return 'private-rfc1918';
  if (a === 172 && b >= 16 && b <= 31) return 'private-rfc1918';
  if (a === 192 && b === 168) return 'private-rfc1918';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-nat'; // 100.64/10 CGNAT (RFC6598)
  if (a === 198 && (b === 18 || b === 19)) return 'special-use'; // benchmarking
  if (a === 192 && b === 0) return 'special-use'; // 192.0.0/24, 192.0.2/24 docs
  if (a === 192 && b === 88) return 'special-use'; // 6to4 relay anycast
  if (a === 198 && b === 51) return 'special-use'; // 198.51.100/24 docs
  if (a === 203 && b === 0) return 'special-use'; // 203.0.113/24 docs
  if (a >= 224) return 'special-use'; // multicast + reserved (224/4, 240/4, 255.255.255.255)
  return 'public';
}

function classifyIpv6(ipRaw: string): PrivateAddressClass {
  const ip = ipRaw.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) and -compat: classify the embedded IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? ip.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyIpv4(mapped[1]!);
  // Hex-form IPv4-mapped, e.g. ::ffff:a9fe:a9fe == 169.254.169.254.
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return classifyIpv4(v4);
  }
  // NAT64 (64:ff9b::/96, RFC6052): classify the embedded IPv4 — a metadata IP behind NAT64 is
  // still a metadata reach.
  const nat64 = ip.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64) {
    const hi = parseInt(nat64[1]!, 16);
    const lo = parseInt(nat64[2]!, 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return classifyIpv4(v4);
  }
  if (ip === '::1') return 'loopback';
  if (ip === '::') return 'unspecified';
  if (ip.startsWith('fe80:') || ip.startsWith('fe80::')) return 'link-local'; // fe80::/10
  // Azure/GCP also expose metadata over a v6 link-local; AWS IMDS v6 is fd00:ec2::254.
  if (ip === 'fd00:ec2::254') return 'metadata';
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return 'unique-local'; // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return 'link-local';
  if (ip.startsWith('ff')) return 'special-use'; // multicast ff00::/8
  return 'public';
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
  resolvedIp: string;
  policy: EgressPolicy;
}): EgressBlockedError | null {
  const { host, port, resolvedIp, policy } = args;
  const cls = classifyIp(resolvedIp);
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

  const hostKey = `${host.toLowerCase()}:${port}`;
  const ipKey = `${resolvedIp.toLowerCase()}:${port}`;
  if (policy.allowInternal.has(hostKey) || policy.allowInternal.has(ipKey)) return null;

  // CIDR fallback (operator opted into a broad range, warned at boot).
  if (policy.allowInternalCidrs.some((cidr) => ipInCidr(resolvedIp, cidr))) return null;

  return new EgressBlockedError({
    destination: `${host}:${port}`,
    resolvedIp,
    classification: cls,
  });
}

/** Minimal IPv4 CIDR membership for the broad-range fallback. IPv6 CIDR ranges are not honored. */
function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  if (!range || bitsStr === undefined) return false;
  if (net.isIP(ip) !== 4 || net.isIP(range) !== 4) return false;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string): number =>
    s.split('.').reduce((acc, o) => ((acc << 8) | (Number(o) & 0xff)) >>> 0, 0) >>> 0;
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

const ORIGINAL_CONNECT = Symbol.for('kovo.egress.originalConnect');
const ORIGINAL_HTTP_AGENT_ADD_REQUEST = Symbol.for('kovo.egress.originalHttpAgentAddRequest');
const FLOOR_INSTALLED = Symbol.for('kovo.egress.installed');
const FLOOR_WRAPPER = Symbol.for('kovo.egress.connectWrapper');
const HTTP_AGENT_FLOOR_WRAPPER = Symbol.for('kovo.egress.httpAgentWrapper');
const FLOOR_HARDENING = Symbol.for('kovo.egress.hardening');

interface ConnectOptions {
  host?: string;
  port?: number | string;
  path?: string | null;
  lookup?: typeof dns.lookup;
  [key: string]: unknown;
}

type ConnectFn = (...args: unknown[]) => net.Socket;

interface FlooredNetModule {
  [ORIGINAL_CONNECT]?: ConnectFn;
  [ORIGINAL_HTTP_AGENT_ADD_REQUEST]?: AddRequestFn;
  [FLOOR_INSTALLED]?: EgressPolicy;
  [FLOOR_WRAPPER]?: ConnectFn;
  [HTTP_AGENT_FLOOR_WRAPPER]?: AddRequestFn;
  [FLOOR_HARDENING]?: {
    mode: EgressHardeningMode;
    warn: (message: string) => void;
  };
}

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
 *   - A Unix-domain-socket connect (`path`, no host) is allowed through (no IP to classify);
 *     SSRF to a metadata IP cannot ride a UDS, so this is safe for the threat model.
 */
export function installNetConnectFloor(
  policy: EgressPolicy,
  hardening: EgressHardeningMode = 'off',
  warn: (message: string) => void = (m) => console.warn(`[kovo egress] ${m}`),
): () => void {
  const proto = net.Socket.prototype as unknown as { connect: ConnectFn };
  const flooredNet = net as unknown as FlooredNetModule;

  if (flooredNet[ORIGINAL_CONNECT]) {
    // Already installed — just swap the active policy.
    flooredNet[FLOOR_INSTALLED] = policy;
    installHttpAgentReuseFloor(flooredNet);
    applyNetConnectHardening(flooredNet, proto, hardening, warn);
    return makeUninstall(flooredNet, proto);
  }

  const original = proto.connect;
  flooredNet[ORIGINAL_CONNECT] = original;
  flooredNet[FLOOR_INSTALLED] = policy;

  const patchedConnect = function patchedConnect(this: net.Socket, ...args: unknown[]): net.Socket {
    const activePolicy = flooredNet[FLOOR_INSTALLED];
    if (!activePolicy) return original.apply(this, args) as net.Socket;

    const options = normalizeConnectOptions(args);
    if (!options || options.host === undefined || options.host === '') {
      // Port/path-only or unparseable form (e.g. a UDS connect) — nothing to classify.
      return original.apply(this, args) as net.Socket;
    }
    const host = options.host;
    const port = Number(options.port ?? 0);

    // If host is already an IP literal, classify + decide synchronously before connecting.
    const literalIp = normalizeIpLiteral(host);
    if (literalIp !== null) {
      const blocked = evaluateEgress({ host, port, resolvedIp: literalIp, policy: activePolicy });
      if (blocked) {
        // Throw on the connect call so fetch/http.get reject with the typed error.
        throw blocked;
      }
      return original.apply(this, args) as net.Socket;
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
      resolver(hostname, opts as dns.LookupOptions, (err, address, family) => {
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
        if (Array.isArray(address)) {
          for (const entry of address as LookupAddress[]) {
            const blocked = evaluateEgress({
              host,
              port,
              resolvedIp: entry.address,
              policy: activePolicy,
            });
            if (blocked) return cb(blocked, entry.address, family as unknown as number);
          }
          return cb(null, address as unknown as string, family as unknown as number);
        }
        const resolvedIp = address as string;
        const blocked = evaluateEgress({ host, port, resolvedIp, policy: activePolicy });
        if (blocked) return cb(blocked, resolvedIp, family as unknown as number);
        cb(null, address as unknown as string, family as unknown as number);
      });
    }) as typeof dns.lookup;

    return original.apply(this, args) as net.Socket;
  } as ConnectFn;

  flooredNet[FLOOR_WRAPPER] = patchedConnect;
  proto.connect = patchedConnect;
  installHttpAgentReuseFloor(flooredNet);
  applyNetConnectHardening(flooredNet, proto, hardening, warn);

  return makeUninstall(flooredNet, proto);
}

function installHttpAgentReuseFloor(flooredNet: FlooredNetModule): void {
  const agentProto = http.Agent.prototype as unknown as { addRequest: AddRequestFn };
  if (flooredNet[ORIGINAL_HTTP_AGENT_ADD_REQUEST]) return;

  const original = agentProto.addRequest;
  flooredNet[ORIGINAL_HTTP_AGENT_ADD_REQUEST] = original;

  const patchedAddRequest = function patchedAddRequest(
    this: http.Agent,
    req: http.ClientRequest,
    options: AgentRequestOptions,
  ): void {
    const activePolicy = flooredNet[FLOOR_INSTALLED];
    if (!activePolicy) return original.call(this, req, options);

    const blocked = evaluateHttpAgentRequest(this, options, activePolicy);
    if (blocked) {
      // Raw node:http/node:https keep-alive reuse skips net.Socket.prototype.connect. Deny the
      // request at the agent boundary so a socket opened before Kovo installed the SPEC §6.6
      // runtime floor cannot carry another request to a now-blocked private destination.
      throw blocked;
    }

    return original.call(this, req, options);
  };

  flooredNet[HTTP_AGENT_FLOOR_WRAPPER] = patchedAddRequest;
  agentProto.addRequest = patchedAddRequest;
}

function evaluateHttpAgentRequest(
  agent: http.Agent,
  options: AgentRequestOptions,
  policy: EgressPolicy,
): EgressBlockedError | null {
  const host = String(options.hostname ?? options.host ?? 'localhost');
  const port = Number(
    options.port ?? options.defaultPort ?? (options.protocol === 'https:' ? 443 : 80),
  );
  const literalIp = normalizeIpLiteral(host);
  if (literalIp !== null) {
    return evaluateEgress({ host, port, resolvedIp: literalIp, policy });
  }

  const getName = (agent as unknown as { getName?: (opts: AgentRequestOptions) => string }).getName;
  const name = typeof getName === 'function' ? getName.call(agent, options) : undefined;
  const freeSockets = (agent as unknown as { freeSockets?: Record<string, AgentSocket[]> })
    .freeSockets;
  const sockets = name ? freeSockets?.[name] : undefined;
  if (!sockets || sockets.length === 0) return null;

  for (const socket of sockets) {
    const resolvedIp = socket.remoteAddress;
    if (!resolvedIp) continue;
    const socketPort = Number(socket.remotePort ?? port);
    const blocked = evaluateEgress({ host, port: socketPort, resolvedIp, policy });
    if (blocked) {
      for (const pooled of sockets) pooled.destroy(blocked);
      return blocked;
    }
  }
  return null;
}

function makeUninstall(flooredNet: FlooredNetModule, proto: { connect: ConnectFn }): () => void {
  return () => {
    const original = flooredNet[ORIGINAL_CONNECT];
    if (original) {
      Object.defineProperty(proto, 'connect', {
        value: original,
        writable: true,
        configurable: true,
      });
      const originalAddRequest = flooredNet[ORIGINAL_HTTP_AGENT_ADD_REQUEST];
      if (originalAddRequest) {
        Object.defineProperty(http.Agent.prototype, 'addRequest', {
          value: originalAddRequest,
          writable: true,
          configurable: true,
        });
      }
      delete flooredNet[ORIGINAL_CONNECT];
      delete flooredNet[ORIGINAL_HTTP_AGENT_ADD_REQUEST];
      delete flooredNet[FLOOR_INSTALLED];
      delete flooredNet[FLOOR_WRAPPER];
      delete flooredNet[HTTP_AGENT_FLOOR_WRAPPER];
      delete flooredNet[FLOOR_HARDENING];
    }
  };
}

function applyNetConnectHardening(
  flooredNet: FlooredNetModule,
  proto: { connect: ConnectFn },
  mode: EgressHardeningMode,
  warn: (message: string) => void,
): void {
  const wrapper = flooredNet[FLOOR_WRAPPER];
  if (!wrapper) return;
  flooredNet[FLOOR_HARDENING] = { mode, warn };
  if (mode === 'off') {
    Object.defineProperty(proto, 'connect', {
      value: wrapper,
      writable: true,
      configurable: true,
    });
    return;
  }
  if (mode === 'freeze') {
    Object.defineProperty(proto, 'connect', {
      value: wrapper,
      writable: false,
      configurable: true,
    });
    return;
  }

  let current: ConnectFn = wrapper;
  Object.defineProperty(proto, 'connect', {
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
 *   - `connect(path[, cb])` — UDS; nothing to classify.
 *
 * Mutating the returned options object in place propagates our injected `lookup`.
 */
function normalizeConnectOptions(args: unknown[]): ConnectOptions | null {
  let first = args[0];
  // Unwrap node's normalizeArgs array form: socket.connect([options, cb]).
  if (Array.isArray(first)) {
    const inner = first[0];
    if (inner && typeof inner === 'object') return inner as ConnectOptions;
    first = inner;
  }
  if (first && typeof first === 'object') {
    return first as ConnectOptions;
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    // (port, host?, cb?) — host is the next string arg.
    const port = Number(first);
    const second = args[1];
    const host = typeof second === 'string' ? second : '127.0.0.1';
    const synthesized: ConnectOptions = { host, port };
    // Replace args so the options object (with our lookup) is what `connect` sees.
    args.splice(0, args[1] !== undefined && typeof args[1] !== 'function' ? 2 : 1, synthesized);
    return synthesized;
  }
  // (path, cb) — UDS, nothing to classify.
  return null;
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
  return (net as unknown as FlooredNetModule)[FLOOR_INSTALLED];
}

/** Inspect whether the active net-connect hook is still Kovo's wrapper (SPEC §6.6 self-probe). */
export function netConnectFloorTamperStatus(): {
  installed: boolean;
  tampered: boolean;
  hardening: EgressHardeningMode;
} {
  const proto = net.Socket.prototype as unknown as { connect: ConnectFn };
  const flooredNet = net as unknown as FlooredNetModule;
  const wrapper = flooredNet[FLOOR_WRAPPER];
  const original = flooredNet[ORIGINAL_CONNECT];
  const installed = Boolean(original && wrapper && proto.connect === wrapper);
  return {
    installed,
    tampered: Boolean(original && wrapper && proto.connect !== wrapper),
    hardening: flooredNet[FLOOR_HARDENING]?.mode ?? 'off',
  };
}
