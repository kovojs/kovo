import { types as nodeUtilTypes } from 'node:util';

import { securityClassifier } from '@kovojs/core/internal/security-markers';
import { snapshotAuditReason } from './audit-justification.js';
import {
  createWitnessWeakSet,
  witnessFreeze,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

export type PrincipalPosture =
  | { kind: 'anonymous' }
  | { kind: 'proven'; principal: string }
  | { kind: 'unresolved' };

/**
 * Package-private, immutable authorization evidence. Built-in guards consume this snapshot rather
 * than re-reading caller-owned session objects after the principal decision (SPEC §6.5/§6.6).
 */
export interface RequestPrincipalSnapshot {
  readonly kind: PrincipalPosture['kind'];
  readonly principal: string | undefined;
  readonly rateLimitKey: string | undefined;
  readonly roles: readonly string[] | undefined;
}

declare const nonRequestPrincipalPostureBrand: unique symbol;

export type NonRequestIngressKind = 'endpoint' | 'task' | 'webhook';
export type PrincipalAccessOperation = 'read' | 'write';

interface NonRequestPrincipalAudit {
  readonly ingress: NonRequestIngressKind;
  readonly operation: PrincipalAccessOperation;
  readonly surface: string;
}

export type NonRequestPrincipalPosture =
  | {
      readonly [nonRequestPrincipalPostureBrand]: {
        readonly scope: 'framework-owned-non-request-principal-posture';
      };
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'act-as';
      readonly principal: string;
    }
  | {
      readonly [nonRequestPrincipalPostureBrand]: {
        readonly scope: 'framework-owned-non-request-principal-posture';
      };
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'system';
      readonly reason: string;
    };

type NonRequestPrincipalPostureInput =
  | {
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'act-as';
      readonly principal: string;
    }
  | {
      readonly audit: NonRequestPrincipalAudit;
      readonly kind: 'system';
      readonly reason: string;
    };

/*
 * Boot-pinned auth carrier controls. Application code shares the server realm, so inherited
 * fields, accessors, and unregistered Proxy traps are not identity evidence. Keep this membrane
 * local to the auth boundary; the framework-owned bootstrap evaluates it before authored modules,
 * so later replacements cannot change the controls guards actually use.
 */
const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativeProxy = globalThis.Proxy;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeWeakMap = globalThis.WeakMap;
const nativeArrayIsArray = NativeArray.isArray;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectHasOwnProperty = NativeObject.prototype.hasOwnProperty;
const nativeObjectIs = NativeObject.is;
const nativeReflectApply = NativeReflect.apply;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeUtilIsProxy = nodeUtilTypes.isProxy;
const nativeWeakMapGet = NativeWeakMap.prototype.get;
const nativeWeakMapSet = NativeWeakMap.prototype.set;

function authApply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function authHasOwn(value: object, property: PropertyKey): boolean {
  return authApply(nativeObjectHasOwnProperty, value, [property]);
}

function authCarrierControlsAreSound(): boolean {
  try {
    if (authApply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (authApply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    if (authApply<string>(nativeStringTrim, ' principal ', []) !== 'principal') return false;
    if (authApply<string>(nativeStringToLowerCase, 'AdMiN', []) !== 'admin') return false;

    const marker = {};
    const record = authApply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
      null,
    ]);
    authApply(nativeObjectDefineProperty, NativeObject, [record, 'marker', { value: marker }]);
    const descriptor = authApply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [record, 'marker'],
    );
    if (
      descriptor === undefined ||
      !authHasOwn(descriptor, 'value') ||
      !authApply(nativeObjectIs, NativeObject, [descriptor.value, marker])
    ) {
      return false;
    }
    if (authApply(nativeObjectFreeze, NativeObject, [record]) !== record) return false;

    const plain = {};
    const proxy = new NativeProxy({}, {});
    if (authApply(nativeUtilIsProxy, nodeUtilTypes, [plain]) !== false) return false;
    if (authApply(nativeUtilIsProxy, nodeUtilTypes, [proxy]) !== true) return false;

    const map = new NativeWeakMap<object, object>();
    authApply(nativeWeakMapSet, map, [plain, marker]);
    return authApply(nativeWeakMapGet, map, [plain]) === marker;
  } catch {
    return false;
  }
}

const authCarrierControlsSound = authCarrierControlsAreSound();
const requestPrincipalSnapshots = new NativeWeakMap<object, RequestPrincipalSnapshot>();
const frameworkSessionPrincipalSnapshots = new NativeWeakMap<object, RequestPrincipalSnapshot>();
const nonRequestPrincipalPostures = createWitnessWeakSet<object>();

function assertAuthCarrierControls(): void {
  if (!authCarrierControlsSound) {
    throw new NativeTypeError(
      'Kovo auth principal controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
}

type StableOwnData =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'data'; readonly value: unknown };

function sameOwnDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (!authHasOwn(left, 'value') || !authHasOwn(right, 'value')) return false;
  return (
    authApply<boolean>(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function stableOwnData(value: object, property: PropertyKey): StableOwnData {
  assertAuthCarrierControls();
  try {
    if (authApply(nativeUtilIsProxy, nodeUtilTypes, [value])) return { kind: 'ambiguous' };
    const before = authApply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [value, property],
    );
    const after = authApply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [value, property],
    );
    if (!sameOwnDataDescriptor(before, after)) return { kind: 'ambiguous' };
    return before === undefined ? { kind: 'absent' } : { kind: 'data', value: before.value };
  } catch {
    return { kind: 'ambiguous' };
  }
}

function authObjectLike(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function cloneStableRoles(value: unknown): readonly string[] | undefined {
  assertAuthCarrierControls();
  if (!authObjectLike(value) || authApply(nativeUtilIsProxy, nodeUtilTypes, [value])) {
    return undefined;
  }
  if (!authApply(nativeArrayIsArray, NativeArray, [value])) return undefined;
  const length = stableOwnData(value, 'length');
  if (
    length.kind !== 'data' ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value > 1_000
  ) {
    return undefined;
  }
  const roles: string[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = stableOwnData(value, index);
    if (entry.kind !== 'data' || typeof entry.value !== 'string') return undefined;
    authApply(nativeObjectDefineProperty, NativeObject, [
      roles,
      index,
      {
        configurable: true,
        enumerable: true,
        value: entry.value,
        writable: false,
      },
    ]);
  }
  return authApply(nativeObjectFreeze, NativeObject, [roles]) as readonly string[];
}

function mintRequestPrincipalSnapshot(
  kind: PrincipalPosture['kind'],
  principal?: string,
  roles?: readonly string[],
  rateLimitKey?: string,
): RequestPrincipalSnapshot {
  const snapshot = authApply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
    null,
  ]);
  authApply(nativeObjectDefineProperty, NativeObject, [snapshot, 'kind', { value: kind }]);
  authApply(nativeObjectDefineProperty, NativeObject, [
    snapshot,
    'principal',
    { value: principal },
  ]);
  authApply(nativeObjectDefineProperty, NativeObject, [
    snapshot,
    'rateLimitKey',
    {
      value: rateLimitKey,
    },
  ]);
  authApply(nativeObjectDefineProperty, NativeObject, [snapshot, 'roles', { value: roles }]);
  return authApply(nativeObjectFreeze, NativeObject, [snapshot]) as RequestPrincipalSnapshot;
}

function snapshotFromSessionValue(sessionValue: unknown): RequestPrincipalSnapshot {
  if (sessionValue === null || sessionValue === undefined) {
    return mintRequestPrincipalSnapshot('anonymous');
  }
  if (!authObjectLike(sessionValue)) {
    const rateLimitKey = isProvenPrincipal(sessionValue) ? `session:${sessionValue}` : undefined;
    return mintRequestPrincipalSnapshot('unresolved', undefined, undefined, rateLimitKey);
  }
  if (authApply(nativeUtilIsProxy, nodeUtilTypes, [sessionValue])) {
    return mintRequestPrincipalSnapshot('unresolved');
  }

  const sessionId = stableOwnData(sessionValue, 'id');
  const user = stableOwnData(sessionValue, 'user');
  if (sessionId.kind === 'ambiguous' || user.kind === 'ambiguous') {
    return mintRequestPrincipalSnapshot('unresolved');
  }
  const sessionRateLimitKey =
    sessionId.kind === 'data' && isProvenPrincipal(sessionId.value)
      ? `session:${sessionId.value}`
      : undefined;
  if (user.kind !== 'data' || !authObjectLike(user.value)) {
    const primitiveUserKey =
      user.kind === 'data' && isProvenPrincipal(user.value) ? `principal:${user.value}` : undefined;
    return mintRequestPrincipalSnapshot(
      'unresolved',
      undefined,
      undefined,
      sessionRateLimitKey ?? primitiveUserKey,
    );
  }
  if (authApply(nativeUtilIsProxy, nodeUtilTypes, [user.value])) {
    return mintRequestPrincipalSnapshot('unresolved', undefined, undefined, sessionRateLimitKey);
  }

  const id = stableOwnData(user.value, 'id');
  const roleData = stableOwnData(user.value, 'roles');
  if (id.kind !== 'data' || !isProvenPrincipal(id.value)) {
    return mintRequestPrincipalSnapshot('unresolved', undefined, undefined, sessionRateLimitKey);
  }
  const roles = roleData.kind === 'data' ? cloneStableRoles(roleData.value) : undefined;
  return mintRequestPrincipalSnapshot(
    'proven',
    id.value,
    roles,
    sessionRateLimitKey ?? `principal:${id.value}`,
  );
}

function classifyRequestPrincipal(request: object): RequestPrincipalSnapshot {
  if (authApply(nativeUtilIsProxy, nodeUtilTypes, [request])) {
    return mintRequestPrincipalSnapshot('unresolved');
  }
  const session = stableOwnData(request, 'session');
  const sessionId = stableOwnData(request, 'sessionId');
  if (session.kind === 'ambiguous' || sessionId.kind === 'ambiguous') {
    return mintRequestPrincipalSnapshot('unresolved');
  }
  if (session.kind === 'data') {
    const snapshot = snapshotFromSessionValue(session.value);
    if (
      snapshot.kind === 'anonymous' &&
      sessionId.kind === 'data' &&
      sessionId.value !== null &&
      sessionId.value !== undefined
    ) {
      return mintRequestPrincipalSnapshot('unresolved');
    }
    return snapshot;
  }
  return sessionId.kind === 'data' && sessionId.value !== null && sessionId.value !== undefined
    ? mintRequestPrincipalSnapshot('unresolved')
    : mintRequestPrincipalSnapshot('anonymous');
}

/** @internal Return one classify-and-pin snapshot for the lifetime of a request carrier. */
export function requestPrincipalSnapshot(request: unknown): RequestPrincipalSnapshot {
  assertAuthCarrierControls();
  if (!authObjectLike(request)) return mintRequestPrincipalSnapshot('anonymous');
  const existing = authApply<RequestPrincipalSnapshot | undefined>(
    nativeWeakMapGet,
    requestPrincipalSnapshots,
    [request],
  );
  if (existing !== undefined) return existing;
  const snapshot = classifyRequestPrincipal(request);
  authApply(nativeWeakMapSet, requestPrincipalSnapshots, [request, snapshot]);
  return snapshot;
}

/** @internal Register the sessionProvider outcome on the framework-owned request Proxy. */
export function registerFrameworkSessionPrincipalSnapshot(
  carrier: object,
  sessionValue: unknown,
): void {
  assertAuthCarrierControls();
  const snapshot = snapshotFromSessionValue(sessionValue);
  authApply(nativeWeakMapSet, requestPrincipalSnapshots, [carrier, snapshot]);
  authApply(nativeWeakMapSet, frameworkSessionPrincipalSnapshots, [carrier, snapshot]);
}

/** @internal Carry already-pinned auth evidence across framework-owned request Proxy layers. */
export function inheritFrameworkPrincipalSnapshot(carrier: object, source: unknown): void {
  assertAuthCarrierControls();
  const snapshot = requestPrincipalSnapshot(source);
  authApply(nativeWeakMapSet, requestPrincipalSnapshots, [carrier, snapshot]);
  if (authObjectLike(source)) {
    const frameworkSnapshot = authApply<RequestPrincipalSnapshot | undefined>(
      nativeWeakMapGet,
      frameworkSessionPrincipalSnapshots,
      [source],
    );
    if (frameworkSnapshot !== undefined) {
      authApply(nativeWeakMapSet, frameworkSessionPrincipalSnapshots, [carrier, frameworkSnapshot]);
    }
  }
}

/** @internal Return principal evidence specifically installed by the framework session lifecycle. */
export function frameworkSessionPrincipalPostureFromRequest(
  request: unknown,
): PrincipalPosture | undefined {
  assertAuthCarrierControls();
  if (!authObjectLike(request)) return undefined;
  const snapshot = authApply<RequestPrincipalSnapshot | undefined>(
    nativeWeakMapGet,
    frameworkSessionPrincipalSnapshots,
    [request],
  );
  if (snapshot === undefined) return undefined;
  return snapshot.kind === 'proven' && snapshot.principal !== undefined
    ? { kind: 'proven', principal: snapshot.principal }
    : { kind: snapshot.kind === 'proven' ? 'unresolved' : snapshot.kind };
}

/** @internal SPEC §6.5/§6.6: auth decisions must only key on a positively resolved principal. */
export const isProvenPrincipal = securityClassifier(
  'server.auth.proven-principal',
  function (value: unknown): value is string {
    if (typeof value !== 'string') return false;
    assertAuthCarrierControls();
    const trimmed = authApply<string>(nativeStringTrim, value, []);
    if (trimmed === '' || trimmed !== value) return false;
    const normalized = authApply<string>(nativeStringToLowerCase, trimmed, []);
    return normalized !== 'anonymous' && normalized !== 'unknown' && normalized !== 'unresolved';
  },
);

/** @internal */
export const principalPostureFromRequest = securityClassifier(
  'server.auth.request-principal-posture',
  function (request: unknown): PrincipalPosture {
    const snapshot = requestPrincipalSnapshot(request);
    return snapshot.kind === 'proven' && snapshot.principal !== undefined
      ? { kind: 'proven', principal: snapshot.principal }
      : { kind: snapshot.kind === 'proven' ? 'unresolved' : snapshot.kind };
  },
);

/** @internal */
export function provenPrincipalFromRequest(request: unknown): string | undefined {
  const posture = principalPostureFromRequest(request);
  return posture.kind === 'proven' ? posture.principal : undefined;
}

/** @internal SPEC §10.3 DEC-G: mint an audited non-request principal for task/webhook work. */
export function actAsNonRequestPrincipal(
  principal: unknown,
  audit: NonRequestPrincipalAudit,
): NonRequestPrincipalPosture {
  if (!isProvenPrincipal(principal)) {
    throw new TypeError('actAs(id) requires a proven non-empty principal id (SPEC §10.3 DEC-G).');
  }
  return mintNonRequestPrincipalPosture({
    audit,
    kind: 'act-as',
    principal,
  });
}

/** @internal SPEC §10.3 DEC-G: mint an audited system read/write declaration. */
export function declareSystemPrincipal(
  reason: unknown,
  audit: NonRequestPrincipalAudit,
): NonRequestPrincipalPosture {
  const closedReason = snapshotAuditReason(
    reason,
    'declareSystemRead/Write(reason) (SPEC §10.3 DEC-G)',
  );
  const trimmedReason = authApply<string>(nativeStringTrim, closedReason, []);
  if (closedReason !== trimmedReason) {
    throw new TypeError(
      'declareSystemRead/Write(reason) requires a non-empty audited reason (SPEC §10.3 DEC-G).',
    );
  }
  return mintNonRequestPrincipalPosture({
    audit,
    kind: 'system',
    reason: closedReason,
  });
}

/**
 * @internal Runtime brand check for framework-owned DB/runtime adapters. This is the seam managed
 * DB workers should consume before setting `kovo.principal` or a system bypass posture.
 */
export function assertNonRequestPrincipalPosture(
  value: unknown,
): asserts value is NonRequestPrincipalPosture {
  if (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakSetHas(nonRequestPrincipalPostures, value)
  ) {
    return;
  }
  throw new Error(
    'Non-request owner-table access requires a framework-minted actAs(id) or declareSystemRead/Write(reason) posture (SPEC §10.3 DEC-G).',
  );
}

/** @internal SPEC §10.3 DEC-G/C7: the brand check is the only door to DB principal elevation. */
export function principalFromNonRequestPrincipalPosture(value: unknown): string | undefined {
  assertNonRequestPrincipalPosture(value);
  return value.kind === 'act-as' ? value.principal : undefined;
}

/** @internal */
export function nonRequestPrincipalPostureDiagnostic(value: NonRequestPrincipalPosture): string {
  if (value.kind === 'act-as') {
    return `${value.audit.ingress}:${value.audit.surface}:${value.audit.operation}:actAs(${value.principal})`;
  }
  return `${value.audit.ingress}:${value.audit.surface}:${value.audit.operation}:system(${value.reason})`;
}

function mintNonRequestPrincipalPosture(
  value: NonRequestPrincipalPostureInput,
): NonRequestPrincipalPosture {
  const minted = witnessFreeze(value) as NonRequestPrincipalPosture;
  witnessWeakSetAdd(nonRequestPrincipalPostures, minted);
  return minted;
}
