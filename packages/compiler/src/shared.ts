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

export interface SourcePatchResult {
  source: string;
  sourceOffsetMap: SourceOffsetMap;
}

export interface OpeningTagSource {
  selfClosing?: boolean;
  start: number;
}

export interface OpeningTagAttributeSource {
  end: number;
  start: number;
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

export function composeSourceOffsetMaps(
  first: SourceOffsetMap,
  second: SourceOffsetMap,
): SourceOffsetMap {
  const segments: SourceOffsetSegment[] = [];

  for (const secondSegment of second.segments) {
    const secondStart = secondSegment.originalStart;
    const secondEnd = secondStart + secondSegment.length;

    for (const firstSegment of first.segments) {
      const firstStart = firstSegment.generatedStart;
      const firstEnd = firstStart + firstSegment.length;
      const overlapStart = Math.max(secondStart, firstStart);
      const overlapEnd = Math.min(secondEnd, firstEnd);

      if (overlapStart >= overlapEnd) continue;

      appendSourceOffsetSegment(segments, {
        generatedStart: secondSegment.generatedStart + overlapStart - secondStart,
        length: overlapEnd - overlapStart,
        originalStart: firstSegment.originalStart + overlapStart - firstStart,
      });
    }
  }

  return {
    generatedLength: second.generatedLength,
    originalLength: first.originalLength,
    segments,
  };
}

function appendSourceOffsetSegment(
  segments: SourceOffsetSegment[],
  segment: SourceOffsetSegment,
): void {
  const previous = segments.at(-1);
  if (
    previous &&
    previous.generatedStart + previous.length === segment.generatedStart &&
    previous.originalStart + previous.length === segment.originalStart
  ) {
    previous.length += segment.length;
    return;
  }

  segments.push(segment);
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

export function applySourceReplacementsWithOffsetMap(
  source: string,
  replacements: readonly SourceReplacement[],
  prefix = '',
): SourcePatchResult {
  return {
    source: `${prefix}${applySourceReplacements(source, replacements)}`,
    sourceOffsetMap: sourceReplacementOffsetMap(source.length, replacements, prefix.length),
  };
}

export function openingTagAttributeRange(
  tagSource: string,
  hostElement: OpeningTagSource,
  attribute: OpeningTagAttributeSource,
  options: { includeLeadingWhitespace?: boolean } = {},
): { end: number; start: number } {
  let start = attribute.start - hostElement.start;
  const end = attribute.end - hostElement.start;
  if (options.includeLeadingWhitespace) {
    while (start > 0 && /\s/.test(tagSource[start - 1] ?? '')) start -= 1;
  }

  return { end, start };
}

export function replaceOpeningTagAttribute(
  tagSource: string,
  hostElement: OpeningTagSource,
  attribute: OpeningTagAttributeSource,
  name: string,
  value: string,
): string {
  return applySourceReplacements(tagSource, [
    {
      ...openingTagAttributeRange(tagSource, hostElement, attribute),
      replacement: `${name}="${escapeAttribute(value)}"`,
    },
  ]);
}

export function insertOpeningTagAttribute(
  tagSource: string,
  hostElement: Pick<OpeningTagSource, 'selfClosing'> | null,
  name: string,
  value: string,
): string {
  const escaped = escapeAttribute(value);
  if (!hostElement) return `${tagSource.slice(0, -1).trimEnd()} ${name}="${escaped}">`;
  if (hostElement.selfClosing) {
    return `${tagSource.slice(0, -2).trimEnd()} ${name}="${escaped}" />`;
  }

  return `${tagSource.slice(0, -1).trimEnd()} ${name}="${escaped}">`;
}

export function splitDepValue(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}
