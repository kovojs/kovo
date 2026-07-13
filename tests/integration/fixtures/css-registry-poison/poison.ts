const originalArrayZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
const originalDefineProperty = Object.defineProperty;

originalDefineProperty(Array.prototype, '0', {
  configurable: true,
  set(value: unknown) {
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as { componentName?: unknown }).componentName === 'poisoned-style'
    ) {
      return;
    }
    originalDefineProperty(this, '0', {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  },
});

export function restoreCssRegistryPoison(): void {
  if (originalArrayZero === undefined)
    delete (Array.prototype as unknown as Record<string, unknown>)[0];
  else originalDefineProperty(Array.prototype, '0', originalArrayZero);
}
