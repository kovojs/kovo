/**
 * Install a test-local namespace beneath the production mutation-broadcast channel name.
 *
 * SPEC §9.1/§9.3/§14 fixes the generated runtime's public channel name and requires its
 * constructor/name witness to stay intact. Browser test files execute concurrently in one origin,
 * so using the fixed name directly lets one fixture's security witness or application envelope
 * reach another fixture. This wrapper preserves the logical name observed by Kovo while giving
 * the native platform channel a unique, test-owned transport name.
 *
 * @internal Browser-test infrastructure only.
 */
export function installMutationBroadcastTestNamespace(
  scope: Window & typeof globalThis,
  namespace: string,
): typeof BroadcastChannel {
  const descriptor = Object.getOwnPropertyDescriptor(scope, 'BroadcastChannel');
  const NativeBroadcastChannel = scope.BroadcastChannel;
  const nativeNameDescriptor = findPropertyDescriptor(NativeBroadcastChannel.prototype, 'name');
  if (!descriptor || !('value' in descriptor) || !nativeNameDescriptor?.get) {
    throw new Error('browser test could not namespace BroadcastChannel');
  }

  const logicalNames = new WeakMap<object, string>();
  const nativeName = Reflect.get(nativeNameDescriptor, 'get') as (this: BroadcastChannel) => string;
  class TestBroadcastChannel extends NativeBroadcastChannel {
    constructor(name: string) {
      super(`${namespace}:${name}`);
      logicalNames.set(this, name);
    }
  }
  Object.defineProperty(TestBroadcastChannel.prototype, 'name', {
    configurable: true,
    enumerable: nativeNameDescriptor.enumerable ?? true,
    get(this: BroadcastChannel): string {
      const logicalName = logicalNames.get(this);
      if (logicalName !== undefined) return logicalName;
      return Reflect.apply(nativeName, this, []) as string;
    },
  });
  Object.defineProperty(scope, 'BroadcastChannel', {
    ...descriptor,
    value: TestBroadcastChannel,
  });
  return TestBroadcastChannel;
}

/** @internal Browser-test descriptor lookup across Web IDL prototype chains. */
export function findPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) return descriptor;
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}
