import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { generatedOffsetToOriginal, type SourceOffsetMap } from './shared.js';

/**
 * @internal A teaching diagnostic the compiler emits during lowering (KV### code, severity,
 * message, source site, optional fix help). Carried inside {@link CompileResult}; in-repo
 * consumers read it but it is not part of the app-author surface (SPEC.md §5.2 rule 5).
 */
export interface CompilerDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  fileName: string;
  help?: string;
  length?: number;
  start?: SourcePosition;
}

/** @internal 1-based line/column source position carried by a {@link CompilerDiagnostic}. */
export interface SourcePosition {
  column: number;
  line: number;
}

/**
 * @internal A source span the validator pipeline locates a diagnostic at. `start`/`length` are
 * offsets into the same string the owning {@link DiagnosticFactory} closes over (SPEC.md §5.2
 * teaching diagnostics). Either may be `undefined` for a diagnostic that has no precise site.
 */
export interface DiagnosticSpan {
  start?: number | undefined;
  length?: number | undefined;
}

/**
 * @internal Builds {@link CompilerDiagnostic}s already bound to the correct `(source, offsetMap)`
 * pair (SPEC.md §5.2). FN9: validators take a factory + typed model instead of a bare `source`
 * string, so a span can only ever be resolved against the source it was measured in — the prior
 * hand-paired `source`/`offsetMap` arguments could silently mislocate a diagnostic with no type
 * error. `at()` is byte-equivalent to the legacy `diagnosticFor(fileName, code, source, start,
 * length)` call (mapping `start` through the bound offset map first when one is present).
 */
export interface DiagnosticFactory {
  /** The file name stamped onto every diagnostic this factory builds. */
  readonly fileName: string;
  /**
   * Build a diagnostic for `code` located at `span`. When `detail` is supplied it is appended to
   * the definition message as `` `${message} ${detail}` `` — the dominant per-site message pattern.
   * Callers that need a bespoke `help`/`message` still spread the result and override those fields.
   */
  at(code: DiagnosticCode, span?: DiagnosticSpan, detail?: string): CompilerDiagnostic;
}

export function diagnosticFor(
  fileName: string,
  code: DiagnosticCode,
  source?: string,
  offset?: number,
  length?: number,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions[code];
  const help = 'help' in definition ? definition.help : undefined;
  return {
    code,
    fileName,
    ...(help === undefined ? {} : { help }),
    ...(source !== undefined && offset !== undefined
      ? {
          ...(length === undefined ? {} : { length }),
          start: offsetToPosition(source, offset),
        }
      : {}),
    message: definition.message,
    severity: definition.severity,
  };
}

/**
 * @internal Create a {@link DiagnosticFactory} bound to `fileName` and the diagnostic `source`.
 * When `offsetMap` is supplied (pre-lowering / generated-offset validators), `at()`'s `span.start`
 * is treated as a generated offset and mapped to the original source through the same
 * {@link generatedOffsetToOriginal} call the legacy validators applied by hand before calling
 * `diagnosticFor`, so positions stay byte-identical.
 */
export function createDiagnosticFactory(
  fileName: string,
  source: string,
  offsetMap?: SourceOffsetMap,
): DiagnosticFactory {
  const positionFor = createOffsetToPosition(source);
  return {
    fileName,
    at(code, span, detail) {
      const definition = diagnosticDefinitions[code];
      const help = 'help' in definition ? definition.help : undefined;
      const rawStart = span?.start;
      const offset =
        offsetMap === undefined ? rawStart : generatedOffsetToOriginal(offsetMap, rawStart);
      const length = span?.length;
      const message =
        detail === undefined ? definition.message : `${definition.message} ${detail}`;
      return {
        code,
        fileName,
        ...(help === undefined ? {} : { help }),
        ...(offset !== undefined
          ? {
              ...(length === undefined ? {} : { length }),
              start: positionFor(offset),
            }
          : {}),
        message,
        severity: definition.severity,
      };
    },
  };
}

export function offsetToPosition(source: string, offset: number): SourcePosition {
  const prefix = source.slice(0, Math.max(0, offset));
  const lineBreaks = prefix.match(/\n/g);
  const line = (lineBreaks?.length ?? 0) + 1;
  const lastLineBreak = prefix.lastIndexOf('\n');
  const column = offset - lastLineBreak;

  return { column, line };
}

/**
 * @internal Memoized {@link offsetToPosition} for a single source string. Builds a sorted
 * line-start index once and binary-searches it per offset (O(log n) vs the O(n) prefix scan in
 * {@link offsetToPosition}). Provably byte-identical: for a clamped `offset >= 0`, the number of
 * `\n` before `offset` equals the count of recorded line-start offsets at or below `offset` minus
 * one (line 1 always starts at 0), and the previous `\n` index is `lineStart - 1` (`-1` for line
 * 1, matching `lastIndexOf` returning `-1` when there is no preceding newline).
 */
function createOffsetToPosition(source: string): (offset: number) => SourcePosition {
  // lineStarts[i] is the offset at which 1-based line (i + 1) begins. Line 1 starts at 0; every
  // subsequent entry is the index immediately after a '\n'.
  const lineStarts: number[] = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }

  return (offset) => {
    const clamped = Math.max(0, offset);
    // Largest i with lineStarts[i] <= clamped. lineStarts is strictly increasing.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= clamped) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    const lineStart = lineStarts[low] ?? 0;
    const line = low + 1;
    // Legacy: column = offset - lastIndexOf('\n', within prefix). The previous '\n' sits at
    // lineStart - 1 (or -1 for line 1), so column = offset - (lineStart - 1) using the *unclamped*
    // offset to preserve the legacy arithmetic for negative offsets.
    const column = offset - (lineStart - 1);
    return { column, line };
  };
}
