import {
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessObjectKeys,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

/**
 * Framework-owned operator-environment trust root (SPEC §6.6 rule 6).
 *
 * The supported server entry evaluates `security-bootstrap.ts` before the authored app graph and
 * pins `process.env` here. Runtime security decisions consume that immutable snapshot, so app
 * top-level or request code cannot turn production floors off, replace an operator-selected DB or
 * metadata authority, or rotate a signing secret by mutating the shared process object.
 *
 * Explicit API inputs remain authoritative: `createApp` mode/test seams, HTTPS cookie posture,
 * egress policy overrides, and registered runtime DB endpoints still express deliberate adapter or
 * request-time changes. Rewriting `process.env` after bootstrap is not an operator rotation API.
 */

type RuntimeEnvironment = Readonly<Record<PropertyKey, string>>;

let pinnedRuntimeEnvironment: RuntimeEnvironment | undefined;

const bootProcess =
  typeof process === 'undefined' || process === null || typeof process !== 'object'
    ? undefined
    : process;
const bootLoadEnvFile = bootProcessValue('loadEnvFile');

/**
 * Load the conventional local `.env` file through the boot-captured Node host hook, then pin the
 * operator environment before authored ESM evaluates. Missing `.env` is the only ignored failure;
 * malformed/unreadable operator configuration fails closed.
 *
 * @internal
 */
export function loadAndPinServerRuntimeEnvironment(): void {
  if (pinnedRuntimeEnvironment !== undefined) return;
  if (bootProcess !== undefined && typeof bootLoadEnvFile === 'function') {
    try {
      witnessReflectApply(bootLoadEnvFile, bootProcess, []);
    } catch (error) {
      if (!isMissingEnvironmentFileError(error)) throw error;
    }
  }
  pinServerRuntimeEnvironment();
}

/** Pin the operator environment once, before authored modules evaluate. @internal */
export function pinServerRuntimeEnvironment(): void {
  if (pinnedRuntimeEnvironment !== undefined) return;
  pinnedRuntimeEnvironment = snapshotEnvironment(liveProcessEnvironment());
}

/** Read one operator environment value from the bootstrap snapshot. @internal */
export function runtimeEnvironmentValue(name: string): string | undefined {
  const source = pinnedRuntimeEnvironment ?? liveProcessEnvironment();
  if (source === undefined) return undefined;
  return stableOwnEnvironmentValue(source, name);
}

/**
 * Return an immutable framework-owned copy for app env-schema validation. The pinned trust-root
 * object itself is never exposed to an app-provided schema implementation.
 * @internal
 */
export function runtimeEnvironmentSnapshot(): RuntimeEnvironment {
  return snapshotEnvironment(pinnedRuntimeEnvironment ?? liveProcessEnvironment());
}

function liveProcessEnvironment(): Record<string, string | undefined> | undefined {
  if (typeof process === 'undefined' || process.env === null || typeof process.env !== 'object') {
    return undefined;
  }
  return process.env;
}

function bootProcessValue(property: PropertyKey): unknown {
  if (bootProcess === undefined) return undefined;
  const before = witnessGetOwnPropertyDescriptor(bootProcess, property);
  const after = witnessGetOwnPropertyDescriptor(bootProcess, property);
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError(`Kovo process.${String(property)} changed during framework bootstrap.`);
  }
  return before === undefined || !('value' in before) ? undefined : before.value;
}

function isMissingEnvironmentFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const before = witnessGetOwnPropertyDescriptor(error, 'code');
  const after = witnessGetOwnPropertyDescriptor(error, 'code');
  return sameDataDescriptor(before, after) && before !== undefined && before.value === 'ENOENT';
}

function snapshotEnvironment(
  source: Readonly<Record<string, string | undefined>> | undefined,
): RuntimeEnvironment {
  const snapshot = witnessCreateNullRecord<string>();
  if (source === undefined) return witnessFreeze(snapshot);

  const names = witnessObjectKeys(source);
  for (let index = 0; index < names.length; index += 1) {
    const nameDescriptor = witnessGetOwnPropertyDescriptor(names, index);
    if (
      nameDescriptor === undefined ||
      !('value' in nameDescriptor) ||
      typeof nameDescriptor.value !== 'string'
    ) {
      throw new TypeError('Kovo operator environment names must be dense own strings.');
    }
    const name = nameDescriptor.value;
    const value = stableOwnEnvironmentValue(source, name);
    if (value === undefined) {
      throw new TypeError(`Kovo operator environment value ${name} changed during bootstrap.`);
    }
    witnessDefineProperty(snapshot, name, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return witnessFreeze(snapshot);
}

function stableOwnEnvironmentValue(
  source: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const before = witnessGetOwnPropertyDescriptor(source, name);
  const after = witnessGetOwnPropertyDescriptor(source, name);
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError(`Kovo operator environment value ${name} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || typeof before.value !== 'string') {
    throw new TypeError(`Kovo operator environment value ${name} must be an own string.`);
  }
  return before.value;
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}
