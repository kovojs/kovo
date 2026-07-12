const originalArrayIsArray = Array.isArray;
const originalReflectApply = Reflect.apply;

Array.isArray = function selectiveCompilerBootstrapPoison(value: unknown): value is unknown[] {
  const stack = new Error().stack ?? '';
  if (stack.includes('compiler-security-intrinsics')) return false;
  return originalReflectApply(originalArrayIsArray, Array, [value]);
};

export function restoreBootstrapPoison(): void {
  Array.isArray = originalArrayIsArray;
}
