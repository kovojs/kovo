const originalArrayIsArray = Array.isArray;
const originalReflectApply = Reflect.apply;

// The fixture shares the child process's ordinary IPC surface. This unauthenticated forged ready
// message must never cross the controller's HMAC-authenticated truth boundary.
process.send?.({ origin: 'http://127.0.0.1:1', type: 'ready' });

const poisonInstalled = Reflect.set(
  Array,
  'isArray',
  function selectiveCompilerBootstrapPoison(value: unknown): value is unknown[] {
    const stack = new Error().stack ?? '';
    if (stack.includes('compiler-security-intrinsics')) return false;
    return originalReflectApply(originalArrayIsArray, Array, [value]);
  },
);

export function assertBootstrapPoisonBlocked(): void {
  if (poisonInstalled) throw new Error('fixture dependency ran before the request-safe lock');
}

export function restoreBootstrapPoison(): void {
  if (poisonInstalled) Reflect.set(Array, 'isArray', originalArrayIsArray);
}
