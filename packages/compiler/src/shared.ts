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

export interface SourceOffsetSegment {
  generatedStart: number;
  length: number;
  originalStart: number;
}

export interface SourceOffsetMap {
  generatedLength: number;
  originalLength: number;
  segments: readonly SourceOffsetSegment[];
}

export function identitySourceOffsetMap(length: number): SourceOffsetMap {
  return {
    generatedLength: length,
    originalLength: length,
    segments: [{ generatedStart: 0, length, originalStart: 0 }],
  };
}

export function prefixedSourceOffsetMap(
  prefixLength: number,
  originalLength: number,
): SourceOffsetMap {
  return {
    generatedLength: prefixLength + originalLength,
    originalLength,
    segments: [{ generatedStart: prefixLength, length: originalLength, originalStart: 0 }],
  };
}

export function sourceReplacementOffsetMap(
  originalLength: number,
  replacements: readonly SourceReplacement[],
  prefixLength = 0,
): SourceOffsetMap {
  const segments: SourceOffsetSegment[] = [];
  let generatedCursor = prefixLength;
  let originalCursor = 0;

  for (const replacement of [...replacements].sort((left, right) => left.start - right.start)) {
    if (
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > originalLength
    ) {
      throw new Error(`Invalid source replacement span ${replacement.start}:${replacement.end}`);
    }
    if (replacement.start < originalCursor) {
      throw new Error(
        `Overlapping source replacement span ${replacement.start}:${replacement.end}`,
      );
    }

    const unchangedLength = replacement.start - originalCursor;
    if (unchangedLength > 0) {
      segments.push({
        generatedStart: generatedCursor,
        length: unchangedLength,
        originalStart: originalCursor,
      });
      generatedCursor += unchangedLength;
    }

    generatedCursor += replacement.replacement.length;
    originalCursor = replacement.end;
  }

  const tailLength = originalLength - originalCursor;
  if (tailLength > 0) {
    segments.push({
      generatedStart: generatedCursor,
      length: tailLength,
      originalStart: originalCursor,
    });
  }

  return {
    generatedLength: prefixLength + patchedSourceLength(originalLength, replacements),
    originalLength,
    segments,
  };
}

export function generatedOffsetToOriginal(
  map: SourceOffsetMap,
  generatedOffset: number | undefined,
): number | undefined {
  if (generatedOffset === undefined) return undefined;
  if (generatedOffset === map.generatedLength) return map.originalLength;

  for (const segment of map.segments) {
    if (
      generatedOffset >= segment.generatedStart &&
      generatedOffset < segment.generatedStart + segment.length
    ) {
      return segment.originalStart + generatedOffset - segment.generatedStart;
    }
  }

  return undefined;
}

function patchedSourceLength(
  originalLength: number,
  replacements: readonly SourceReplacement[],
): number {
  return replacements.reduce(
    (length, replacement) =>
      length - (replacement.end - replacement.start) + replacement.replacement.length,
    originalLength,
  );
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
