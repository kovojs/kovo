import {
  addDatabaseEgressEndpoints,
  databaseEgressEndpointsFromUrls,
  removeDatabaseEgressEndpoints,
  isNetConnectFloorInstalled,
  installNetConnectFloor,
  netConnectFloorTamperStatus,
  resolveEgressPolicy,
  type EgressOptions,
  type EgressPolicy,
} from './egress.js';
import {
  dgramFloorTamperStatus,
  installDgramFloor,
  isDgramFloorInstalled,
} from './egress-dgram.js';
import {
  installUndiciFloor,
  isUndiciFloorInstalled,
  undiciFloorTamperStatus,
} from './egress-undici.js';
import {
  createWitnessMap,
  witnessArrayAppend,
  witnessGetOwnPropertyDescriptor,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessSetForEach,
  witnessSetHas,
  witnessSetSize,
} from './security-witness-intrinsics.js';
import { runtimeEnvironmentValue } from '@kovojs/server/internal/runtime-environment';
import { securityPromiseResolve } from './response-security-intrinsics.js';

/**
 * Bootstrap for the outbound-egress private-network deny floor (SPEC §6.6;
 * `plans/secure-framework.md` Phase 5). Installs every transport layer and runs a LOUD startup
 * self-probe.
 *
 * WHERE THIS RUNS. The single app-assembly chokepoint is `createApp` (mirroring the env /
 * refuse-to-boot precedent in `env.ts`). `createApp` installs this floor by default: production
 * and explicit operator config use empty-allowlist deny semantics, while omitted development
 * config keeps non-metadata private sidecars reachable so localhost boot stays usable. Because
 * monkeypatches do NOT cross `Worker`/`child_process` boundaries, every worker/child bootstrap
 * that serves requests MUST call this again; the self-probe below is the safety net that LOUDLY
 * logs when a process is serving without it.
 *
 * RESIDUAL FAIL-OPEN (enumerated honestly — this is a FLOOR, never a by-construction proof):
 *   1. Same-process app code can re-patch the net/datagram prototypes or call
 *      `setGlobalDispatcher` after us, removing a layer. `egress.hardening: "warn" | "freeze"`
 *      adds same-process tamper signals for the net/datagram layers, and self-probes detect all
 *      transport drift, but this is still not sandbox-level protection.
 *   2. `Worker` threads and `child_process` do not inherit the monkeypatch; each must re-install.
 *   3. Native addons / FFI that open sockets outside Node's JS transports are never seen.
 *   4. A per-`fetch(url, { dispatcher })` option bypasses the global undici dispatcher (the
 *      net.connect layer still catches its first dial, but not pooled reuse on that dispatcher).
 *   5. Provider-shape drift: a future undici/node internal that changes the `connect`/`dispatch`
 *      argument shape could silently fail open — the self-probe catches "not installed", not
 *      "installed but ineffective"; the layer tests are the guard against shape drift.
 *
 * NON-GOALS (label everywhere — SPEC §6.6 rule 3):
 *   - Not a defense against data EXFILTRATION (all public egress is allowed; stopping
 *     exfiltration needs a positive destination allowlist, a separate control).
 *   - Not a code sandbox (only defends against an SSRF coaxing trusted code to the wrong IP).
 */

let bootResult: EgressFloorInstall | undefined;
let bootPolicy: EgressPolicy | undefined;
const registeredDatabaseEndpointRefs = createWitnessMap<string, number>();

interface EgressFloorInstallOptions {
  /**
   * Internal dev-only posture for omitted `createApp({ egress })`: keep the transport floor
   * installed, but permit non-metadata private-network destinations.
   */
  allowPrivateNetwork?: boolean;
  /**
   * `createApp()` process posture: an already-installed app floor may be repaired or reinstalled,
   * but a later app aggregate must not replace it with broader/different process-global authority.
   */
  preserveExistingAppPolicy?: boolean;
}

/** Boot refusal for a missing, partial, tampered, or unaudited-disabled egress floor. */
export class EgressFloorBootError extends Error {
  override readonly name = 'EgressFloorBootError';
}

/** What an egress-floor install reports back to the bootstrap caller. */
export interface EgressFloorInstall {
  /** Whether the synchronous `net.connect` enforcement layer is active. */
  netConnectInstalled: boolean;
  /** Whether the synchronous connected-datagram enforcement layer is active. */
  dgramInstalled: boolean;
  /** Whether the undici dispatcher enforcement layer is active. */
  undiciInstalled: boolean;
  /** Uninstall every transport layer (tests / teardown). */
  uninstall(): void;
}

/**
 * Synchronously install all egress floor layers and resolve+validate the policy. A config error
 * (e.g. a metadata IP in `allowInternal`) throws synchronously here and refuses boot, mirroring
 * the env refuse-to-boot precedent. The public wrapper remains promise-returning for callers that
 * already await worker/child bootstrap installs.
 *
 * @param options - The `egress` config from `createApp` (the allowInternal allowlist).
 * @param warn - Sink for config + self-probe warnings (defaults to `console.warn`).
 */
export function installEgressFloor(
  options: EgressOptions | undefined,
  warn: (message: string) => void = (m) => console.warn(`[kovo egress] ${m}`),
): Promise<EgressFloorInstall> {
  return securityPromiseResolve(installEgressFloorSync(options, warn));
}

/**
 * Synchronous install used by `createApp` so production boot can verify all layers before
 * returning an app aggregate. Public `installEgressFloor()` remains promise-returning for the
 * existing worker/child bootstrap surface.
 *
 * @internal
 */
export function installEgressFloorSync(
  options: EgressOptions | undefined,
  warn: (message: string) => void = (m) => console.warn(`[kovo egress] ${m}`),
  installOptions: EgressFloorInstallOptions = {},
): EgressFloorInstall {
  // Resolve + validate synchronously: a bad config (metadata in allowInternal) throws now and
  // refuses boot. Raw node:http and node:dgram are floored before app assembly returns.
  const policy = resolveEgressPolicy(options, warn, {
    ...installOptions,
    databaseEndpoints: registeredDatabaseEndpoints(),
  });
  if (
    installOptions.preserveExistingAppPolicy === true &&
    bootPolicy !== undefined &&
    (!sameEgressFloorPolicy(bootPolicy, policy) ||
      netConnectFloorTamperStatus().hardening !== (options?.hardening ?? 'off'))
  ) {
    throw new EgressFloorBootError(
      'createApp() refused to replace an existing app egress posture with a different ' +
        'process-global policy. Kovo apps that require different outbound authority must run in ' +
        'separate processes (SPEC §6.6).',
    );
  }
  const uninstallNet = installNetConnectFloor(policy, options?.hardening ?? 'off', warn);
  const uninstallDgram = installDgramFloor(policy, options?.hardening ?? 'off', warn);
  const uninstallUndici = installUndiciFloor(policy);

  const result: EgressFloorInstall = {
    netConnectInstalled: isNetConnectFloorInstalled(),
    dgramInstalled: isDgramFloorInstalled(),
    undiciInstalled: isUndiciFloorInstalled(),
    uninstall() {
      uninstallUndici();
      uninstallDgram();
      uninstallNet();
      if (bootResult === result) {
        bootResult = undefined;
        bootPolicy = undefined;
      }
    },
  };
  bootResult = result;
  bootPolicy = policy;

  // LOUD self-probe (SPEC §6.6): if any layer is missing after install, say so
  // unmissably. A missing floor is a security regression, not a silent fallback.
  selfProbe(warn);
  return result;
}

function sameEgressFloorPolicy(left: EgressPolicy, right: EgressPolicy): boolean {
  return (
    left.allowPrivateNetwork === right.allowPrivateNetwork &&
    sameEgressStringSet(left.allowInternal, right.allowInternal) &&
    sameEgressStringSet(left.allowDatabaseEndpoints, right.allowDatabaseEndpoints) &&
    sameEgressStringSet(left.allowDestinations, right.allowDestinations) &&
    sameEgressStringArray(left.allowInternalCidrs, right.allowInternalCidrs)
  );
}

function sameEgressStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (witnessSetSize(left) !== witnessSetSize(right)) return false;
  let same = true;
  witnessSetForEach(left, (value) => {
    if (!witnessSetHas(right, value)) same = false;
  });
  return same;
}

function sameEgressStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = databaseEndpointAt(left, index, 'egress CIDR posture');
    const rightValue = databaseEndpointAt(right, index, 'egress CIDR posture');
    if (leftValue !== rightValue) return false;
  }
  return true;
}

/**
 * Startup self-probe. Call this from any process/worker that serves requests. It does NOT
 * install the floor — it LOUDLY reports whether the floor is installed so a worker bootstrap
 * that forgot to re-install is caught at startup rather than at the first SSRF.
 */
export function selfProbe(
  warn: (message: string) => void = (m) => console.warn(`[kovo egress] ${m}`),
  options: {
    /**
     * Label for the process boundary being probed. Use `worker` or `child-process` in
     * adapter/starter bootstraps so missing re-install diagnostics name the real boundary.
     */
    boundary?: 'process' | 'worker' | 'child-process';
    /** Throw instead of warn when the probe finds a missing/partial/tampered floor. */
    failure?: 'warn' | 'throw';
  } = {},
): { netConnectInstalled: boolean; dgramInstalled: boolean; undiciInstalled: boolean } {
  const netStatus = netConnectFloorTamperStatus();
  const dgramStatus = dgramFloorTamperStatus();
  const undiciStatus = undiciFloorTamperStatus();
  const net = netStatus.installed;
  const dgram = dgramStatus.installed;
  const undici = undiciStatus.installed;
  const boundary = options.boundary ?? 'process';
  const emit = (message: string): void => {
    if (options.failure === 'throw') throw new Error(`[kovo egress] ${message}`);
    warn(message);
  };
  if (!net && !dgram && !undici) {
    emit(
      'SELF-PROBE: the outbound-egress private-network deny floor is NOT installed in this ' +
        `${boundary}. SSRF to cloud metadata / internal services is UNGATED here. If this is a ` +
        'Worker/child process, re-run createApp({ egress }) or installEgressFloor() in that ' +
        'bootstrap (SPEC §6.6; the floor does not cross worker boundaries).',
    );
  } else if (!net || !dgram || !undici) {
    emit(
      `SELF-PROBE: the egress floor is only PARTIALLY installed (net.connect=${net}, ` +
        `dgram=${dgram}, undici=${undici}). One transport path is ungated — a single layer ` +
        'fails open (undici pooled reuse bypasses net.connect; raw node:http bypasses undici; ' +
        'node:dgram bypasses both).',
    );
  }
  if (netStatus.tampered) {
    emit(
      'SELF-PROBE: TAMPER detected: net.Socket.prototype.connect no longer points at the ' +
        'Kovo egress wrapper. Re-install installEgressFloor() before serving requests. ' +
        'This is a runtime defense-in-depth signal, not sandbox protection (SPEC §6.6).',
    );
  }
  if (dgramStatus.tampered) {
    emit(
      'SELF-PROBE: TAMPER detected: dgram.Socket.prototype.connect/send no longer point at ' +
        'the Kovo egress wrappers. Re-install installEgressFloor() before serving requests. ' +
        'This is a runtime defense-in-depth signal, not sandbox protection (SPEC §6.6).',
    );
  }
  if (undiciStatus.tampered) {
    emit(
      'SELF-PROBE: TAMPER detected: undici.getGlobalDispatcher() no longer returns the Kovo ' +
        'egress dispatcher. A late setGlobalDispatcher() removed the fetch layer; re-install ' +
        'installEgressFloor() before serving requests. This is a runtime defense-in-depth ' +
        'signal, not sandbox protection (SPEC §6.6).',
    );
  }
  return { netConnectInstalled: net, dgramInstalled: dgram, undiciInstalled: undici };
}

/** The active egress floor install for this process, if any. */
export function activeEgressFloor(): EgressFloorInstall | undefined {
  return bootResult;
}

/**
 * Register a framework-owned Postgres runtime URL with the process-local egress floor.
 *
 * Runtime database connections are still only exempt by exact `host:port`; cloud metadata and
 * unrelated private-network targets remain blocked by `evaluateEgress()` before this exemption
 * is considered (SPEC §6.6, §10.3 DEC-C).
 *
 * @internal
 */
export function registerEgressDatabaseUrl(databaseUrl: string | undefined): () => void {
  const endpoints = databaseEgressEndpointsFromUrls([databaseUrl]);
  if (endpoints.length === 0) return () => {};

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = databaseEndpointAt(endpoints, index, 'registered database endpoints');
    const next = (witnessMapGet(registeredDatabaseEndpointRefs, endpoint) ?? 0) + 1;
    witnessMapSet(registeredDatabaseEndpointRefs, endpoint, next);
  }
  if (bootPolicy !== undefined) addDatabaseEgressEndpoints(bootPolicy, endpoints);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const removable: string[] = [];
    for (let index = 0; index < endpoints.length; index += 1) {
      const endpoint = databaseEndpointAt(endpoints, index, 'registered database endpoints');
      const next = (witnessMapGet(registeredDatabaseEndpointRefs, endpoint) ?? 0) - 1;
      if (next > 0) {
        witnessMapSet(registeredDatabaseEndpointRefs, endpoint, next);
        continue;
      }
      witnessMapDelete(registeredDatabaseEndpointRefs, endpoint);
      const envDatabaseEndpoints = databaseEgressEndpointsFromUrls([
        runtimeEnvironmentValue('KOVO_DATABASE_URL'),
      ]);
      if (!databaseEndpointListHas(envDatabaseEndpoints, endpoint)) {
        witnessArrayAppend(removable, endpoint, 'Removable database egress endpoints');
      }
    }
    if (bootPolicy !== undefined) removeDatabaseEgressEndpoints(bootPolicy, removable);
  };
}

function registeredDatabaseEndpoints(): string[] {
  const endpoints: string[] = [];
  witnessMapForEach(registeredDatabaseEndpointRefs, (_references, endpoint) => {
    witnessArrayAppend(endpoints, endpoint, 'Registered database egress endpoint snapshot');
  });
  return endpoints;
}

function databaseEndpointListHas(endpoints: readonly string[], expected: string): boolean {
  for (let index = 0; index < endpoints.length; index += 1) {
    if (databaseEndpointAt(endpoints, index, 'database egress endpoint list') === expected) {
      return true;
    }
  }
  return false;
}

function databaseEndpointAt(endpoints: readonly string[], index: number, label: string): string {
  const descriptor = witnessGetOwnPropertyDescriptor(endpoints, index);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string'
  ) {
    throw new TypeError(`Kovo ${label} must contain dense own string entries.`);
  }
  return descriptor.value;
}
