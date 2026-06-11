export function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

export function indent(value: string): string {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

export function dedupeBy<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
): Value[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

export function replaceExtension(fileName: string, extension: string): string {
  return fileName.replace(/\.[^.]+$/, extension);
}

export function splitDepValue(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}
