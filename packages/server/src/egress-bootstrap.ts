import {
  isNetConnectFloorInstalled,
  installNetConnectFloor,
  netConnectFloorTamperStatus,
  resolveEgressPolicy,
  type EgressOptions,
} from './egress.js';

type UndiciFloorModule = typeof import('./egress-undici.js');

let undiciFloorModule: UndiciFloorModule | undefined;

async function loadUndiciFloorModule(): Promise<UndiciFloorModule> {
  undiciFloorModule ??= await import('./egress-undici.js');
  return undiciFloorModule;
}

/**
 * Bootstrap for the outbound-egress private-network deny floor (SPEC §6.6;
 * `plans/secure-framework.md` Phase 5). Installs BOTH enforcement layers and runs a LOUD
 * startup self-probe.
 *
 * WHERE THIS RUNS. The single app-assembly chokepoint is `createApp` (mirroring the env /
 * refuse-to-boot precedent in `env.ts`). `createApp` calls {@link installEgressFloor} when an
 * `egress` config is present (opt-in: the floor has high false-positive cost — every internal
 * service or localhost DB hard-fails until allowlisted — so it is NOT default-on; the operator
 * opts in by passing `egress`). Because monkeypatches do NOT cross `Worker`/`child_process`
 * boundaries, every worker/child bootstrap that serves requests MUST call this again; the
 * self-probe below is the safety net that LOUDLY logs when a process is serving without it.
 *
 * RESIDUAL FAIL-OPEN (enumerated honestly — this is a FLOOR, never a by-construction proof):
 *   1. Same-process app code can re-patch `net.Socket.prototype.connect` or call
 *      `setGlobalDispatcher` after us, removing either layer. `egress.hardening: "warn" |
 *      "freeze"` adds same-process tamper signals for the net layer, and self-probes detect
 *      both net and undici drift, but this is still not sandbox-level protection.
 *   2. `Worker` threads and `child_process` do not inherit the monkeypatch; each must re-install.
 *   3. Native addons / FFI that open sockets outside `net` are never seen by either layer.
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

/** What an egress-floor install reports back to the bootstrap caller. */
export interface EgressFloorInstall {
  /** Whether the synchronous `net.connect` enforcement layer is active. */
  netConnectInstalled: boolean;
  /** Whether the undici dispatcher enforcement layer is active. */
  undiciInstalled: boolean;
  /** Uninstall both layers (tests / teardown). */
  uninstall(): void;
}

/**
 * Synchronously install the egress floor's net.connect layer and resolve+validate the policy,
 * then kick off the asynchronous undici-dispatcher layer (not awaited). Returns immediately so
 * `createApp` stays synchronous. A config error (e.g. a metadata IP in `allowInternal`) throws
 * synchronously here and refuses boot, mirroring the env refuse-to-boot precedent. The returned
 * promise resolves once BOTH layers are settled (tests await it; callers may ignore it).
 *
 * @param options - The `egress` config from `createApp` (the allowInternal allowlist).
 * @param warn - Sink for config + self-probe warnings (defaults to `console.warn`).
 */
export function installEgressFloor(
  options: EgressOptions | undefined,
  warn: (message: string) => void = (m) => console.warn(`[kovo egress] ${m}`),
): Promise<EgressFloorInstall> {
  // Resolve + validate synchronously: a bad config (metadata in allowInternal) throws now and
  // refuses boot. Layer (b) is also installed synchronously so raw node:http is floored before
  // the undici import resolves.
  const policy = resolveEgressPolicy(options, warn);
  const uninstallNet = installNetConnectFloor(policy, options?.hardening ?? 'off', warn);

  return (async (): Promise<EgressFloorInstall> => {
    let uninstallUndici: () => void = () => {};
    let undiciInstalled = false;
    try {
      const undiciFloor = await loadUndiciFloorModule();
      uninstallUndici = await undiciFloor.installUndiciFloor(policy);
      undiciInstalled = undiciFloor.isUndiciFloorInstalled();
    } catch (error) {
      warn(
        `undici dispatcher layer failed to install (${
          error instanceof Error ? error.message : String(error)
        }); the net.connect layer is still active, but pooled-socket fetch reuse is NOT gated. ` +
          'This is a partial floor — investigate.',
      );
    }

    const result: EgressFloorInstall = {
      netConnectInstalled: isNetConnectFloorInstalled(),
      undiciInstalled,
      uninstall() {
        uninstallUndici();
        uninstallNet();
        if (bootResult === result) bootResult = undefined;
      },
    };
    bootResult = result;

    // LOUD self-probe (SPEC §6.6): if EITHER layer is missing after an explicit install request,
    // say so unmissably. A missing floor is a security regression, not a silent fallback.
    selfProbe(warn);
    return result;
  })();
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
): { netConnectInstalled: boolean; undiciInstalled: boolean } {
  const netStatus = netConnectFloorTamperStatus();
  const undiciStatus = undiciFloorModule?.undiciFloorTamperStatus() ?? {
    installed: false,
    tampered: false,
  };
  const net = netStatus.installed;
  const undici = undiciStatus.installed;
  const boundary = options.boundary ?? 'process';
  const emit = (message: string): void => {
    if (options.failure === 'throw') throw new Error(`[kovo egress] ${message}`);
    warn(message);
  };
  if (!net && !undici) {
    emit(
      'SELF-PROBE: the outbound-egress private-network deny floor is NOT installed in this ' +
        `${boundary}. SSRF to cloud metadata / internal services is UNGATED here. If this is a ` +
        'Worker/child process, re-run createApp({ egress }) or installEgressFloor() in that ' +
        'bootstrap (SPEC §6.6; the floor does not cross worker boundaries).',
    );
  } else if (!net || !undici) {
    emit(
      `SELF-PROBE: the egress floor is only PARTIALLY installed (net.connect=${net}, ` +
        `undici=${undici}). One transport path is ungated — a single layer fails open ` +
        '(undici pooled reuse bypasses net.connect; raw node:http bypasses undici).',
    );
  }
  if (netStatus.tampered) {
    emit(
      'SELF-PROBE: TAMPER detected: net.Socket.prototype.connect no longer points at the ' +
        'Kovo egress wrapper. Re-install installEgressFloor() before serving requests. ' +
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
  return { netConnectInstalled: net, undiciInstalled: undici };
}

/** The active egress floor install for this process, if any. */
export function activeEgressFloor(): EgressFloorInstall | undefined {
  return bootResult;
}
