const windowsEnvironmentNames = Symbol('Kovo Windows invocation environment names');

type KovoInvocationEnvironmentSnapshot = NodeJS.ProcessEnv & {
  readonly [windowsEnvironmentNames]?: Readonly<Record<string, string>>;
};

const hostEnvironmentNamesAreCaseInsensitive = process.platform === 'win32';
const nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const nativeObjectCreate = Object.create;
const nativeObjectDefineProperty = Object.defineProperty;
const nativeObjectFreeze = Object.freeze;
const nativeObjectIs = Object.is;
const nativeObjectKeys = Object.keys;
const nativeReflectApply = Reflect.apply;
const nativeStringToLowerCase = String.prototype.toLowerCase;

/**
 * Copy command-entry operator authority while retaining the host's environment-name semantics.
 * String keys keep their operator-provided spelling so the snapshot can be forwarded unchanged to
 * child processes; Windows-equivalent lookup is held in private non-string metadata.
 *
 * @internal
 */
export function snapshotKovoInvocationEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  namesAreCaseInsensitive: boolean = hostEnvironmentNamesAreCaseInsensitive,
): NodeJS.ProcessEnv {
  const snapshot = nativeObjectCreate(null) as KovoInvocationEnvironmentSnapshot;
  const names = nativeObjectKeys(source);
  const foldedNames = namesAreCaseInsensitive
    ? (nativeObjectCreate(null) as Record<string, string>)
    : undefined;

  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (typeof name !== 'string') {
      throw new TypeError('Kovo invocation environment names must be dense own strings.');
    }
    const value = stableOwnEnvironmentValue(source, name);
    if (value === undefined) {
      throw new TypeError(`Kovo invocation environment ${name} changed while it was inspected.`);
    }
    nativeObjectDefineProperty(snapshot, name, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });

    if (foldedNames !== undefined) {
      const foldedName = foldEnvironmentName(name);
      const existing = stableOwnEnvironmentValue(foldedNames, foldedName);
      if (existing !== undefined && existing !== name) {
        throw new TypeError(
          `Kovo invocation environment contains case-colliding Windows names ${existing} and ${name} (SPEC §6.6 rule 6).`,
        );
      }
      nativeObjectDefineProperty(foldedNames, foldedName, {
        configurable: false,
        enumerable: true,
        value: name,
        writable: false,
      });
    }
  }

  if (foldedNames !== undefined) {
    nativeObjectDefineProperty(snapshot, windowsEnvironmentNames, {
      configurable: false,
      enumerable: false,
      value: nativeObjectFreeze(foldedNames),
      writable: false,
    });
  }
  return nativeObjectFreeze(snapshot);
}

/** Read a command-entry value with the same name semantics as its source host. @internal */
export function kovoInvocationEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const metadata = nativeGetOwnPropertyDescriptor(
    environment as KovoInvocationEnvironmentSnapshot,
    windowsEnvironmentNames,
  );
  if (metadata !== undefined && (!('value' in metadata) || typeof metadata.value !== 'object')) {
    throw new TypeError('Kovo invocation environment host-name index must be immutable data.');
  }
  const foldedNames = metadata?.value as Readonly<Record<string, string>> | undefined;
  const originalName =
    foldedNames === undefined
      ? name
      : stableOwnEnvironmentValue(foldedNames, foldEnvironmentName(name));
  if (originalName === undefined) return undefined;
  return stableOwnEnvironmentValue(environment, originalName);
}

function foldEnvironmentName(name: string): string {
  return nativeReflectApply(nativeStringToLowerCase, name, []) as string;
}

function stableOwnEnvironmentValue(
  source: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const before = nativeGetOwnPropertyDescriptor(source, name);
  const after = nativeGetOwnPropertyDescriptor(source, name);
  if (!sameEnvironmentDescriptor(before, after)) {
    throw new TypeError(`Kovo invocation environment ${name} changed while it was inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || typeof before.value !== 'string') {
    throw new TypeError(`Kovo invocation environment ${name} must be an own string.`);
  }
  return before.value;
}

function sameEnvironmentDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    nativeObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}
