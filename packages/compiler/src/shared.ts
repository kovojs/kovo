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

export interface SourceReplacement {
  end: number;
  replacement: string;
  start: number;
}

export function applySourceReplacements(
  source: string,
  replacements: readonly SourceReplacement[],
): string {
  let previousStart = source.length;
  let output = source;

  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    if (
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > source.length
    ) {
      throw new Error(`Invalid source replacement span ${replacement.start}:${replacement.end}`);
    }
    if (replacement.end > previousStart) {
      throw new Error(
        `Overlapping source replacement span ${replacement.start}:${replacement.end}`,
      );
    }
    output = `${output.slice(0, replacement.start)}${replacement.replacement}${output.slice(replacement.end)}`;
    previousStart = replacement.start;
  }

  return output;
}

export function removeJsxAttribute(attributes: string, start: number, end: number): string {
  let removeStart = start;
  while (removeStart > 0 && /\s/.test(attributes[removeStart - 1] ?? '')) {
    removeStart -= 1;
  }

  return `${attributes.slice(0, removeStart)}${attributes.slice(end)}`;
}

export function removeJsxAttributes(
  attributes: string,
  ranges: readonly { end: number; start: number }[],
): string {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce((next, range) => removeJsxAttribute(next, range.start, range.end), attributes);
}

export function splitDepValue(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}
