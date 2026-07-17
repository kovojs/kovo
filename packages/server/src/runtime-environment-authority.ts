import {
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessObjectKeys,
  witnessReflectApply,
  witnessStringToLowerCase,
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

interface RuntimeEnvironmentAuthority {
  /** Original operator spellings, preserved for app env-schema snapshots. */
  readonly snapshot: RuntimeEnvironment;
  /** Windows-only case-folded name -> original name index for host-equivalent lookup. */
  readonly windowsNames: RuntimeEnvironment | undefined;
}

let pinnedRuntimeEnvironment: RuntimeEnvironmentAuthority | undefined;

const bootProcess =
  typeof process === 'undefined' || process === null || typeof process !== 'object'
    ? undefined
    : process;
const bootLoadEnvFile = bootProcessValue('loadEnvFile');
const bootEnvironmentNamesAreCaseInsensitive = bootProcessValue('platform') === 'win32';

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
  pinnedRuntimeEnvironment = createEnvironmentAuthority(
    liveProcessEnvironment(),
    bootEnvironmentNamesAreCaseInsensitive,
  );
}

/** Read one operator environment value from the bootstrap snapshot. @internal */
export function runtimeEnvironmentValue(name: string): string | undefined {
  const authority =
    pinnedRuntimeEnvironment ??
    createEnvironmentAuthority(liveProcessEnvironment(), bootEnvironmentNamesAreCaseInsensitive);
  return environmentAuthorityValue(authority, name);
}

/**
 * Return an immutable framework-owned copy for app env-schema validation. The pinned trust-root
 * object itself is never exposed to an app-provided schema implementation.
 * @internal
 */
export function runtimeEnvironmentSnapshot(): RuntimeEnvironment {
  return snapshotEnvironment(pinnedRuntimeEnvironment?.snapshot ?? liveProcessEnvironment());
}

/**
 * Inject an operator source/platform posture without depending on the test host OS. This module is
 * implementation-private and the seam is deliberately not re-exported from the package's internal
 * runtime-environment subpath.
 *
 * @internal test-only
 */
export function __testPinServerRuntimeEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  windowsCaseInsensitive: boolean,
): void {
  if (pinnedRuntimeEnvironment !== undefined) {
    throw new TypeError('Kovo test operator environment is already pinned.');
  }
  pinnedRuntimeEnvironment = createEnvironmentAuthority(source, windowsCaseInsensitive);
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

function createEnvironmentAuthority(
  source: Readonly<Record<string, string | undefined>> | undefined,
  windowsCaseInsensitive: boolean,
): RuntimeEnvironmentAuthority {
  const snapshot = snapshotEnvironment(source);
  return witnessFreeze({
    snapshot,
    windowsNames: windowsCaseInsensitive ? indexWindowsEnvironmentNames(snapshot) : undefined,
  });
}

function indexWindowsEnvironmentNames(snapshot: RuntimeEnvironment): RuntimeEnvironment {
  const index = witnessCreateNullRecord<string>();
  const names = witnessObjectKeys(snapshot);
  for (let position = 0; position < names.length; position += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(names, position);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError('Kovo operator environment names must be dense own strings.');
    }
    const name = descriptor.value;
    const foldedName = witnessStringToLowerCase(name);
    const existing = stableOwnEnvironmentValue(index, foldedName);
    if (existing !== undefined && existing !== name) {
      throw new TypeError(
        `Kovo operator environment contains case-colliding Windows names ${existing} and ${name} (SPEC §6.6 rule 6).`,
      );
    }
    witnessDefineProperty(index, foldedName, {
      configurable: false,
      enumerable: true,
      value: name,
      writable: false,
    });
  }
  return witnessFreeze(index);
}

function environmentAuthorityValue(
  authority: RuntimeEnvironmentAuthority,
  name: string,
): string | undefined {
  const originalName =
    authority.windowsNames === undefined
      ? name
      : stableOwnEnvironmentValue(authority.windowsNames, witnessStringToLowerCase(name));
  if (originalName === undefined) return undefined;
  return stableOwnEnvironmentValue(authority.snapshot, originalName);
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
