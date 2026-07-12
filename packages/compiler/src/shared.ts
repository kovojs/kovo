import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import {
  compilerCreateSet,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringLocaleCompare,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringToLowerCase,
  compilerStringTrim,
} from './compiler-security-intrinsics.js';

export function escapeAttribute(value: string): string {
  return compilerStringReplaceAll(
    compilerStringReplaceAll(value, '&', '&amp;'),
    '"',
    '&quot;',
  );
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
  return compilerSetHas(PROPERTY_AUTHORITATIVE_ATTRIBUTES, name);
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
  return compilerRegExpReplace(/[\n\r\f"\\]/g, value, (char) => {
    if (char === '\n') return '\\a ';
    if (char === '\r') return '\\d ';
    if (char === '\f') return '\\c ';
    return `\\${char}`;
  });
}

export function indent(value: string): string {
  const lines = compilerStringSplit(value, '\n');
  let output = '';
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) output += '\n';
    output += `  ${lines[index] ?? ''}`;
  }
  return output;
}

export function dedupeBy<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
): Value[] {
  const seen = compilerCreateSet<string>();
  const result: Value[] = [];
  const snapshot = compilerSnapshotDenseArray(values, 'Compiler dedupe values');
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index]!;
    const key = keyFor(value);
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    result[result.length] = value;
  }
  return result;
}

export function uniqueSorted(values: readonly string[]): string[] {
  return stableSortedCopy(
    dedupeBy(values, (value) => value),
    compilerStringLocaleCompare,
    'strings',
  );
}

export function kebabCase(value: string): string {
  const separated = compilerRegExpReplace(/([a-z0-9])([A-Z])/g, value, (_match, left, right) =>
    `${left}-${right}`,
  );
  return compilerStringToLowerCase(compilerRegExpReplace(/_/g, separated, '-'));
}

export function looseKebabCase(value: string): string {
  const separated = compilerRegExpReplace(/([a-z0-9])([A-Z])/g, value, (_match, left, right) =>
    `${left}-${right}`,
  );
  return compilerStringToLowerCase(compilerRegExpReplace(/[_\s]+/g, separated, '-'));
}

export function attributeKebabCase(value: string): string {
  const separated = compilerRegExpReplace(/([a-z0-9])([A-Z])/g, value, (_match, left, right) =>
    `${left}-${right}`,
  );
  const normalized = compilerRegExpReplace(/[^A-Za-z0-9]+/g, separated, '-');
  return compilerStringToLowerCase(compilerRegExpReplace(/^-|-$/g, normalized, ''));
}

export function sanitizeIdentifier(value: string): string {
  const sanitized = compilerRegExpReplace(/[^A-Za-z0-9_$]/g, value, '_');
  return compilerRegExpTest(/^[A-Za-z_$]/, sanitized) ? sanitized : `_${sanitized}`;
}

export function outputWriteFact(fact: GeneratedOutputWriteFact): GeneratedOutputWriteFact {
  return fact;
}

export function replaceExtension(fileName: string, extension: string): string {
  return compilerRegExpReplace(/\.[^.]+$/, fileName, extension);
}

export function normalizeComponentFileName(fileName: string): string {
  const normalized = compilerRegExpReplace(
    /^[A-Za-z]:\/?/,
    compilerStringReplaceAll(fileName, '\\', '/'),
    '',
  );
  const segments: string[] = [];
  const sourceSegments = compilerStringSplit(normalized, '/');
  for (let index = 0; index < sourceSegments.length; index += 1) {
    const segment = sourceSegments[index]!;
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0) segments.length -= 1;
      continue;
    }
    segments[segments.length] = segment;
  }

  return joinStrings(segments, '/') || 'component.tsx';
}

export interface SourceReplacement {
  end: number;
  replacement: string;
  start: number;
}

export interface SourceReplacementOwner {
  phase: string;
  writer: string;
}

export interface SourceReplacementRecord extends SourceReplacementOwner {
  generatedEnd: number;
  generatedStart: number;
  originalEnd: number;
  originalStart: number;
  replacement: string;
}

export interface SourceReplacementConflictDiagnostic extends SourceReplacementOwner {
  conflicting?: SourceReplacementOwner & {
    originalEnd: number;
    originalStart: number;
  };
  generatedEnd?: number;
  generatedStart?: number;
  kind: 'invalid-span' | 'overlap';
  message: string;
  originalEnd: number;
  originalStart: number;
}

interface SourceReplacementEntry extends SourceReplacementOwner, SourceReplacement {}

export interface SourceReplacementPlan {
  diagnostics: readonly SourceReplacementConflictDiagnostic[];
  records: readonly SourceReplacementRecord[];
  replacements: readonly SourceReplacement[];
}

export class SourceReplacementConflictError extends Error {
  readonly diagnostics: readonly SourceReplacementConflictDiagnostic[];

  constructor(diagnostics: readonly SourceReplacementConflictDiagnostic[]) {
    super(sourceReplacementDiagnosticsMessage(diagnostics));
    this.name = 'SourceReplacementConflictError';
    this.diagnostics = diagnostics;
  }
}

export class SourceReplacementAccumulator {
  private readonly entries: SourceReplacementEntry[] = [];

  add(owner: SourceReplacementOwner, replacements: readonly SourceReplacement[]): void {
    const snapshot = compilerSnapshotDenseArray(
      replacements,
      'Compiler source replacements',
    );
    for (let index = 0; index < snapshot.length; index += 1) {
      const replacement = snapshot[index]!;
      this.entries[this.entries.length] = { ...owner, ...replacement };
    }
  }

  clear(): void {
    this.entries.length = 0;
  }

  plan(originalLength: number, prefixLength = 0): SourceReplacementPlan {
    return sourceReplacementPlan(originalLength, this.entries, prefixLength);
  }
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

  const sortedReplacements = stableSortedCopy(
    replacements,
    (left, right) => left.start - right.start,
    'source replacements',
  );
  for (let index = 0; index < sortedReplacements.length; index += 1) {
    const replacement = sortedReplacements[index]!;
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
      segments[segments.length] = {
        generatedStart: generatedCursor,
        length: unchangedLength,
        originalStart: originalCursor,
      };
      generatedCursor += unchangedLength;
    }

    generatedCursor += replacement.replacement.length;
    originalCursor = replacement.end;
  }

  const tailLength = originalLength - originalCursor;
  if (tailLength > 0) {
    segments[segments.length] = {
      generatedStart: generatedCursor,
      length: tailLength,
      originalStart: originalCursor,
    };
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

  const segments = compilerSnapshotDenseArray(map.segments, 'Compiler source offset segments');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
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
  const generatedSegments = compilerSnapshotDenseArray(
    intermediateToGenerated.segments,
    'Compiler generated source offset segments',
  );
  const originalSegments = compilerSnapshotDenseArray(
    originalToIntermediate.segments,
    'Compiler original source offset segments',
  );

  for (let generatedIndex = 0; generatedIndex < generatedSegments.length; generatedIndex += 1) {
    const generatedSegment = generatedSegments[generatedIndex]!;
    const intermediateStart = generatedSegment.originalStart;
    const intermediateEnd = intermediateStart + generatedSegment.length;

    for (let originalIndex = 0; originalIndex < originalSegments.length; originalIndex += 1) {
      const originalSegment = originalSegments[originalIndex]!;
      const overlapStart =
        intermediateStart > originalSegment.generatedStart
          ? intermediateStart
          : originalSegment.generatedStart;
      const originalSegmentEnd = originalSegment.generatedStart + originalSegment.length;
      const overlapEnd =
        intermediateEnd < originalSegmentEnd ? intermediateEnd : originalSegmentEnd;
      if (overlapStart >= overlapEnd) continue;

      segments[segments.length] = {
        generatedStart: generatedSegment.generatedStart + overlapStart - intermediateStart,
        length: overlapEnd - overlapStart,
        originalStart:
          originalSegment.originalStart + overlapStart - originalSegment.generatedStart,
      };
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
  const sortedSegments = stableSortedCopy(
    segments,
    (left, right) => left.generatedStart - right.generatedStart,
    'source offset segments',
  );
  for (let index = 0; index < sortedSegments.length; index += 1) {
    const segment = sortedSegments[index]!;
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.generatedStart + previous.length === segment.generatedStart &&
      previous.originalStart + previous.length === segment.originalStart
    ) {
      previous.length += segment.length;
      continue;
    }
    merged[merged.length] = { ...segment };
  }
  return merged;
}

function patchedSourceLength(
  originalLength: number,
  replacements: readonly SourceReplacement[],
): number {
  let length = originalLength;
  const snapshot = compilerSnapshotDenseArray(
    replacements,
    'Compiler source replacements',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const replacement = snapshot[index]!;
    length = length - (replacement.end - replacement.start) + replacement.replacement.length;
  }
  return length;
}

export function applySourceReplacements(
  source: string,
  replacements: readonly SourceReplacement[],
): string {
  let previousStart = source.length;
  let output = source;

  const sortedReplacements = stableSortedCopy(
    replacements,
    (left, right) => right.start - left.start,
    'source replacements',
  );
  for (let index = 0; index < sortedReplacements.length; index += 1) {
    const replacement = sortedReplacements[index]!;
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
    output = `${compilerStringSlice(output, 0, replacement.start)}${replacement.replacement}${compilerStringSlice(
      output,
      replacement.end,
    )}`;
    previousStart = replacement.start;
  }

  return output;
}

export function applySourceReplacementPlan(source: string, plan: SourceReplacementPlan): string {
  if (plan.diagnostics.length > 0) throw new SourceReplacementConflictError(plan.diagnostics);
  return applySourceReplacements(source, plan.replacements);
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

export function applySourceReplacementPlanWithOffsetMap(
  source: string,
  plan: SourceReplacementPlan,
  prefix = '',
): SourcePatchWithOffsetMap {
  if (plan.diagnostics.length > 0) throw new SourceReplacementConflictError(plan.diagnostics);
  return {
    source: `${prefix}${applySourceReplacements(source, plan.replacements)}`,
    sourceOffsetMap: sourceReplacementOffsetMap(source.length, plan.replacements, prefix.length),
  };
}

function sourceReplacementPlan(
  originalLength: number,
  replacements: readonly SourceReplacementEntry[],
  prefixLength: number,
): SourceReplacementPlan {
  const diagnostics: SourceReplacementConflictDiagnostic[] = [];
  const records: SourceReplacementRecord[] = [];
  const sorted = stableSortedCopy(
    replacements,
    (left, right) => left.start - right.start,
    'source replacement entries',
  );
  let generatedCursor = prefixLength;
  let originalCursor = 0;
  let previous: SourceReplacementRecord | undefined;

  for (let index = 0; index < sorted.length; index += 1) {
    const replacement = sorted[index]!;
    const invalid =
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > originalLength;
    if (invalid) {
      diagnostics[diagnostics.length] = sourceReplacementDiagnostic('invalid-span', replacement);
      continue;
    }

    if (replacement.start < originalCursor) {
      diagnostics[diagnostics.length] = sourceReplacementDiagnostic(
        'overlap',
        replacement,
        previous,
      );
      continue;
    }

    generatedCursor += replacement.start - originalCursor;
    const record: SourceReplacementRecord = {
      generatedEnd: generatedCursor + replacement.replacement.length,
      generatedStart: generatedCursor,
      originalEnd: replacement.end,
      originalStart: replacement.start,
      phase: replacement.phase,
      replacement: replacement.replacement,
      writer: replacement.writer,
    };
    records[records.length] = record;
    previous = record;
    generatedCursor = record.generatedEnd;
    originalCursor = replacement.end;
  }

  return {
    diagnostics,
    records,
    replacements: copyReplacementFacts(sorted),
  };
}

function sourceReplacementDiagnostic(
  kind: SourceReplacementConflictDiagnostic['kind'],
  replacement: SourceReplacementEntry,
  conflicting?: SourceReplacementRecord,
): SourceReplacementConflictDiagnostic {
  const originalSpan = `${replacement.start}:${replacement.end}`;
  const conflict = conflicting
    ? ` conflicts with phase=${conflicting.phase} writer=${conflicting.writer} span=${conflicting.originalStart}:${conflicting.originalEnd}`
    : '';
  return {
    ...(conflicting
      ? {
          conflicting: {
            originalEnd: conflicting.originalEnd,
            originalStart: conflicting.originalStart,
            phase: conflicting.phase,
            writer: conflicting.writer,
          },
        }
      : {}),
    kind,
    message: `Source replacement ${kind} phase=${replacement.phase} writer=${replacement.writer} span=${originalSpan}${conflict}`,
    originalEnd: replacement.end,
    originalStart: replacement.start,
    phase: replacement.phase,
    writer: replacement.writer,
  };
}

function sourceReplacementDiagnosticsMessage(
  diagnostics: readonly SourceReplacementConflictDiagnostic[],
): string {
  let message = '';
  const snapshot = compilerSnapshotDenseArray(
    diagnostics,
    'Compiler source replacement diagnostics',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const diagnostic = snapshot[index]!;
    if (message.length > 0) message += '\n';
    message += diagnostic.message;
  }
  return message;
}

export function splitDepValue(value: string): string[] {
  const parts = compilerStringSplit(compilerRegExpReplace(/[\s,]+/g, value, '\n'), '\n');
  const result: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const dependency = compilerStringTrim(part);
    if (dependency.length > 0) result[result.length] = dependency;
  }
  return result;
}

function stableSortedCopy<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
  label: string,
): Value[] {
  const sorted = compilerSnapshotDenseArray(values, `Compiler ${label}`);
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let insertion = index;
    while (insertion > 0 && compare(sorted[insertion - 1]!, value) > 0) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted;
}

function joinStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index] ?? '';
  }
  return output;
}

function copyReplacementFacts(
  replacements: readonly SourceReplacementEntry[],
): SourceReplacement[] {
  const copied: SourceReplacement[] = [];
  const snapshot = compilerSnapshotDenseArray(
    replacements,
    'Compiler source replacement entries',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const { end, replacement, start } = snapshot[index]!;
    copied[copied.length] = { end, replacement, start };
  }
  return copied;
}
