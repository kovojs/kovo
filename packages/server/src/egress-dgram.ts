import dgram from 'node:dgram';

import {
  EgressBlockedError,
  evaluateEgress,
  isNodeAcceptedUnnormalizedIpLiteral,
  normalizeFastPathIpLiteral,
  type EgressOptions,
  type EgressPolicy,
} from './egress.js';
import {
  egressApply,
  egressNumber,
  egressNumberIsInteger,
  egressObjectDefineProperty,
  egressObjectIs,
  egressReflectGet,
} from './egress-intrinsics.js';
import {
  createWitnessWeakMap,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

/**
 * Datagram enforcement for the SPEC §6.6 outbound-egress floor.
 *
 * Node's unconnected `dgram.send()` performs destination lookup inside a socket-owned resolver.
 * `createSocket({ lookup })` can replace that resolver and can rewrite even an IP literal after a
 * framework pre-check. There is no public API for pinning the resolved address into that sink, so
 * unconnected sends fail closed. Connected UDP is supportable: the kernel pins one peer, and the
 * wrapper validates that actual peer immediately before every send.
 */

type DgramSend = (this: dgram.Socket, ...args: unknown[]) => void;
type DgramConnect = (this: dgram.Socket, ...args: unknown[]) => void;
type DgramRemoteAddress = (this: dgram.Socket) => dgram.RemoteInfo;
type EgressHardeningMode = NonNullable<EgressOptions['hardening']>;

interface DgramConnectionIntent {
  readonly host: string;
  readonly port: number;
}

interface DgramFloorState {
  hardening: {
    mode: EgressHardeningMode;
    warn: (message: string) => void;
  };
  installOwner: object;
  policy: EgressPolicy;
  wrapperConnect: DgramConnect;
  wrapperSend: DgramSend;
}

const socketPrototype = dgram.Socket.prototype as unknown as {
  connect: DgramConnect;
  remoteAddress: DgramRemoteAddress;
  send: DgramSend;
};
const bootConnect = socketPrototype.connect;
const bootRemoteAddress = socketPrototype.remoteAddress;
const bootSend = socketPrototype.send;
const connectionIntents = createWitnessWeakMap<dgram.Socket, DgramConnectionIntent>();

let dgramFloorState: DgramFloorState | undefined;

export interface DgramFloorTamperStatus {
  installed: boolean;
  tampered: boolean;
}

export function installDgramFloor(
  policy: EgressPolicy,
  hardening: EgressHardeningMode = 'off',
  warn: (message: string) => void = (message) => console.warn(`[kovo egress] ${message}`),
): () => void {
  const installOwner = {};
  if (dgramFloorState !== undefined) {
    dgramFloorState.policy = policy;
    dgramFloorState.installOwner = installOwner;
    applyDgramHardening(dgramFloorState, hardening, warn);
    return makeUninstall(dgramFloorState, installOwner);
  }

  let state: DgramFloorState;
  const wrapperConnect = function dgramConnectFloor(this: dgram.Socket, ...args: unknown[]): void {
    const intent = normalizeConnectionIntent(args);
    if (intent === undefined) {
      return egressApply(bootConnect, this, args);
    }

    const literalIp = normalizeFastPathIpLiteral(intent.host);
    if (literalIp !== null) {
      const blocked = evaluateEgress({
        host: intent.host,
        port: intent.port,
        resolvedIp: literalIp,
        policy: state.policy,
      });
      if (blocked !== null) throw blocked;
    } else if (isNodeAcceptedUnnormalizedIpLiteral(intent.host)) {
      throw new EgressBlockedError({
        classification: 'special-use',
        destination: `${intent.host}:${intent.port}`,
        resolvedIp: intent.host,
      });
    }

    witnessWeakMapSet(connectionIntents, this, intent);
    return egressApply(bootConnect, this, args);
  } as DgramConnect;

  const wrapperSend = function dgramSendFloor(this: dgram.Socket, ...args: unknown[]): void {
    const remote = connectedRemoteAddress(this);
    if (remote === undefined) throw unconnectedDatagramBlocked();

    const intent = witnessWeakMapGet(connectionIntents, this);
    const host = intent?.port === remote.port ? intent.host : remote.address;
    const resolvedIp = normalizeFastPathIpLiteral(remote.address);
    if (resolvedIp === null || isNodeAcceptedUnnormalizedIpLiteral(remote.address)) {
      throw new EgressBlockedError({
        classification: 'special-use',
        destination: `${host}:${remote.port}`,
        resolvedIp: remote.address,
      });
    }
    const blocked = evaluateEgress({
      host,
      port: remote.port,
      resolvedIp,
      policy: state.policy,
    });
    if (blocked !== null) throw blocked;
    return egressApply(bootSend, this, args);
  } as DgramSend;

  state = {
    hardening: { mode: hardening, warn },
    installOwner,
    policy,
    wrapperConnect,
    wrapperSend,
  };
  dgramFloorState = state;
  applyDgramHardening(state, hardening, warn);
  return makeUninstall(state, installOwner);
}

export function dgramFloorTamperStatus(): DgramFloorTamperStatus {
  const state = dgramFloorState;
  if (state === undefined) return { installed: false, tampered: false };
  const installed =
    socketPrototype.connect === state.wrapperConnect && socketPrototype.send === state.wrapperSend;
  return { installed, tampered: !installed };
}

export function isDgramFloorInstalled(): boolean {
  return dgramFloorTamperStatus().installed;
}

function normalizeConnectionIntent(args: readonly unknown[]): DgramConnectionIntent | undefined {
  const rawPort = args[0];
  if (typeof rawPort !== 'number' && typeof rawPort !== 'string') return undefined;
  const port = egressNumber(rawPort);
  if (!egressNumberIsInteger(port) || port < 1 || port > 65_535) return undefined;

  const rawHost = args[1];
  if (rawHost !== undefined && typeof rawHost !== 'string' && typeof rawHost !== 'function') {
    return undefined;
  }
  const host = typeof rawHost === 'string' && rawHost !== '' ? rawHost : 'localhost';
  return { host, port };
}

function connectedRemoteAddress(
  socket: dgram.Socket,
): { address: string; port: number } | undefined {
  let remote: dgram.RemoteInfo;
  try {
    remote = egressApply(bootRemoteAddress, socket, []);
  } catch (error) {
    if (stableErrorCode(error) === 'ERR_SOCKET_DGRAM_NOT_CONNECTED') return undefined;
    throw error;
  }
  const address = stableRemoteValue(remote, 'address');
  const port = stableRemoteValue(remote, 'port');
  if (
    typeof address !== 'string' ||
    typeof port !== 'number' ||
    !egressNumberIsInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new EgressBlockedError({
      classification: 'special-use',
      destination: 'invalid-datagram-peer',
    });
  }
  return { address, port };
}

function stableRemoteValue(remote: dgram.RemoteInfo, property: 'address' | 'port'): unknown {
  const before = egressReflectGet(remote, property, remote);
  const after = egressReflectGet(remote, property, remote);
  if (!egressObjectIs(before, after)) {
    throw new EgressBlockedError({
      classification: 'special-use',
      destination: 'unstable-datagram-peer',
    });
  }
  return before;
}

function stableErrorCode(error: unknown): unknown {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null)
    return undefined;
  const before = egressReflectGet(error, 'code', error);
  const after = egressReflectGet(error, 'code', error);
  return egressObjectIs(before, after) ? before : undefined;
}

function unconnectedDatagramBlocked(): EgressBlockedError {
  return new EgressBlockedError({
    classification: 'special-use',
    destination: 'unconnected-datagram',
    reason: 'unconnected-datagram',
  });
}

function makeUninstall(state: DgramFloorState, installOwner: object): () => void {
  return () => {
    if (dgramFloorState !== state || state.installOwner !== installOwner) return;
    egressObjectDefineProperty(socketPrototype, 'connect', {
      configurable: true,
      value: bootConnect,
      writable: true,
    });
    egressObjectDefineProperty(socketPrototype, 'send', {
      configurable: true,
      value: bootSend,
      writable: true,
    });
    dgramFloorState = undefined;
  };
}

function applyDgramHardening(
  state: DgramFloorState,
  mode: EgressHardeningMode,
  warn: (message: string) => void,
): void {
  state.hardening = { mode, warn };
  installHardenedMethod('connect', state.wrapperConnect, mode, warn);
  installHardenedMethod('send', state.wrapperSend, mode, warn);
}

function installHardenedMethod(
  property: 'connect' | 'send',
  wrapper: DgramConnect | DgramSend,
  mode: EgressHardeningMode,
  warn: (message: string) => void,
): void {
  if (mode === 'off' || mode === 'freeze') {
    egressObjectDefineProperty(socketPrototype, property, {
      configurable: true,
      value: wrapper,
      writable: mode === 'off',
    });
    return;
  }

  let current = wrapper;
  egressObjectDefineProperty(socketPrototype, property, {
    configurable: true,
    get() {
      return current;
    },
    set(next: DgramConnect | DgramSend) {
      if (next !== wrapper) {
        warn(
          `TAMPER: dgram.Socket.prototype.${property} was reassigned after Kovo installed the ` +
            'egress floor. The datagram layer is no longer trusted in this process; re-install ' +
            'installEgressFloor() before serving requests. This warning is runtime ' +
            'defense-in-depth, not sandbox protection (SPEC §6.6).',
        );
      }
      current = next;
    },
  });
}
