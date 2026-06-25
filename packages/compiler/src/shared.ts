export function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/**
 * SPEC.md §4.8 (data-bind-prop): closed, security-reviewed allowlist of
 * property-authoritative attributes. When a reactive value targets one of these,
 * the compiler emits BOTH the SSR attribute (initial paint / no-JS) and the
 * companion `data-bind:<attr>` AND a `data-bind-prop:<prop>` stamp so the loader
 * keeps the dirty live property (e.g. `.checked` after user interaction) in sync.
 *
 * This is the only set for which the property write is emitted; nothing else is
 * eligible, and unsafe sinks (`innerHTML`/`outerHTML`/`srcdoc`/`on*`) are never
 * here (KV236). Names are the canonical authored attribute names.
 */
export const PROPERTY_AUTHORITATIVE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'checked',
  'indeterminate',
  'value',
  'scrollTop',
  'scrollLeft',
  'selected',
  'open',
]);

/** Returns whether the attribute should additionally emit a data-bind-prop stamp. */
export function isPropertyAuthoritativeAttribute(name: string): boolean {
  return PROPERTY_AUTHORITATIVE_ATTRIBUTES.has(name);
}

/** The companion live-property binding attribute name for a reactive attr. */
export function bindPropStampAttributeName(name: string): string {
  return `data-bind-prop:${name}`;
}

/**
 * Escape a string for embedding inside a double-quoted CSS string token, e.g. the
 * value of an attribute selector `[kovo-c="…"]`. CSS string syntax — not HTML
 * attribute syntax — governs this position, so the HTML escaper `escapeAttribute`
 * (which entity-encodes `&`/`"` but leaves `\`, `]`, `}`, and newlines raw) cannot
 * be reused: it would emit `&quot;` literals into the selector and leave a `"` or
 * backslash able to terminate the string or smuggle an escape, so the selector
 * would not round-trip against the runtime `kovo-c` attribute value (SPEC.md §5.2).
 *
 * Escapes `"`, `\`, and the CSS-significant control characters per the CSS string
 * grammar. Mirrors `escapeCssString` in `@kovojs/browser`
 * (packages/browser/src/fragment-targets.ts) — a deliberate LOCAL copy so the
 * compiler does not depend on the browser runtime package.
 */
export function escapeCssString(value: string): string {
  return value.replace(/[\n\r\f"\\]/g, (char) => {
    if (char === '\n') return '\\a ';
    if (char === '\r') return '\\d ';
    if (char === '\f') return '\\c ';
    return `\\${char}`;
  });
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

export function normalizeComponentFileName(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/').replace(/^[A-Za-z]:\/?/, '');
  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join('/') || 'component.tsx';
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

export interface SourcePatchWithOffsetMap {
  source: string;
  sourceOffsetMap: SourceOffsetMap;
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
  originalToIntermediate: SourceOffsetMap,
  intermediateToGenerated: SourceOffsetMap,
): SourceOffsetMap {
  const segments: SourceOffsetSegment[] = [];

  for (const generatedSegment of intermediateToGenerated.segments) {
    const intermediateStart = generatedSegment.originalStart;
    const intermediateEnd = intermediateStart + generatedSegment.length;

    for (const originalSegment of originalToIntermediate.segments) {
      const overlapStart = Math.max(intermediateStart, originalSegment.generatedStart);
      const overlapEnd = Math.min(
        intermediateEnd,
        originalSegment.generatedStart + originalSegment.length,
      );
      if (overlapStart >= overlapEnd) continue;

      segments.push({
        generatedStart: generatedSegment.generatedStart + overlapStart - intermediateStart,
        length: overlapEnd - overlapStart,
        originalStart:
          originalSegment.originalStart + overlapStart - originalSegment.generatedStart,
      });
    }
  }

  return {
    generatedLength: intermediateToGenerated.generatedLength,
    originalLength: originalToIntermediate.originalLength,
    segments: mergeAdjacentOffsetSegments(segments),
  };
}

function mergeAdjacentOffsetSegments(
  segments: readonly SourceOffsetSegment[],
): SourceOffsetSegment[] {
  const merged: SourceOffsetSegment[] = [];
  for (const segment of [...segments].sort(
    (left, right) => left.generatedStart - right.generatedStart,
  )) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.generatedStart + previous.length === segment.generatedStart &&
      previous.originalStart + previous.length === segment.originalStart
    ) {
      previous.length += segment.length;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
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
): SourcePatchWithOffsetMap {
  return {
    source: `${prefix}${applySourceReplacements(source, replacements)}`,
    sourceOffsetMap: sourceReplacementOffsetMap(source.length, replacements, prefix.length),
  };
}

export function splitDepValue(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}
