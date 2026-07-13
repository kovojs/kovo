/** @internal Operator-selected security posture pinned before any authored module evaluation. */
export interface KovoCommandSecurityDisposition {
  readonly invocationCwd: string;
  readonly invocationEnv: NodeJS.ProcessEnv;
  readonly paranoidStaticAdvisory: boolean;
}

/** Module-boot fallback for direct dispatcher calls; the bin supplies an even earlier capture. */
export const kovoCommandBootSecurityDisposition = captureKovoCommandSecurityDisposition();

/** @internal Capture supported-runner path authority and environment posture once at command entry. */
export function captureKovoCommandSecurityDisposition(): KovoCommandSecurityDisposition {
  const invocationEnv = snapshotKovoInvocationEnvironment(process.env);
  const value = invocationEnv.KOVO_PARANOID;
  return Object.freeze({
    invocationCwd: process.cwd(),
    invocationEnv,
    paranoidStaticAdvisory: value === '1' || value === 'true',
  });
}

/** @internal Copy operator environment authority into an immutable null-prototype data record. */
export function snapshotKovoInvocationEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const snapshot = Object.create(null) as NodeJS.ProcessEnv;
  for (const name of Object.keys(source)) {
    const before = Object.getOwnPropertyDescriptor(source, name);
    const after = Object.getOwnPropertyDescriptor(source, name);
    if (!sameEnvironmentDescriptor(before, after)) {
      throw new TypeError(`Kovo invocation environment ${name} changed while it was inspected.`);
    }
    if (before === undefined || !('value' in before) || typeof before.value !== 'string') {
      throw new TypeError(`Kovo invocation environment ${name} must be an own string.`);
    }
    Object.defineProperty(snapshot, name, {
      configurable: false,
      enumerable: true,
      value: before.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function sameEnvironmentDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    Object.is(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}
