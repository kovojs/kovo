import type { DiagnosticCode, RegisteredDiagnostic } from '@kovojs/core';
import type { DiagnosticConstructionOptions } from '@kovojs/core/internal/diagnostics';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
  deriveRegisteredDiagnostic,
} from '@kovojs/core/internal/diagnostics';

import { generatedOffsetToOriginal, type SourceOffsetMap } from './shared.js';

/**
 * @internal A teaching diagnostic the compiler emits during lowering (KV### code, severity,
 * message, source site, optional fix help). Carried inside {@link CompileResult}; in-repo
 * consumers read it but it is not part of the app-author surface (SPEC.md §5.2 rule 5).
 */
export interface CompilerDiagnostic extends RegisteredDiagnostic<DiagnosticCode> {
  fileName: string;
  help?: string;
  length?: number;
  /**
   * Exact authored-source range, expressed as zero-based UTF-16 offsets with an exclusive end.
   *
   * `fileName`/`start`/`length` remain the compiler's line-oriented compatibility view while
   * tool transports project this range into `kovo-diagnostic/v1` without reading or reparsing
   * source (SPEC §5.2/§11).
   */
  source?: CompilerDiagnosticSourceAnchor;
  start?: SourcePosition;
}

/** @internal 1-based line/column source position carried by a {@link CompilerDiagnostic}. */
export interface SourcePosition {
  column: number;
  line: number;
}

/** @internal Exact authored-source anchor carried by compiler-owned diagnostics. */
export interface CompilerDiagnosticSourceAnchor {
  readonly end: number;
  readonly file: string;
  readonly start: number;
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
 * error. {@link diagnosticAt} is byte-equivalent to the legacy
 * `diagnosticFor(fileName, code, source, start, length)` call (mapping `start` through the bound
 * offset map first when one is present).
 */
const diagnosticFactoryBrand: unique symbol = Symbol('kovo.diagnostic-factory');

export interface DiagnosticFactory {
  /** Module-private nominal/runtime witness; only createDiagnosticFactory can mint this value. */
  readonly [diagnosticFactoryBrand]: true;
  /** The file name stamped onto every diagnostic this factory builds. */
  readonly fileName: string;
}

interface DiagnosticFactoryState {
  readonly offsetMap: SourceOffsetMap | undefined;
  readonly positionFor: (offset: number) => SourcePosition;
}

const diagnosticFactoryStates = new WeakMap<DiagnosticFactory, DiagnosticFactoryState>();

export function diagnosticFor(
  fileName: string,
  code: DiagnosticCode,
  source?: string,
  offset?: number,
  length?: number,
  detail?: string,
): CompilerDiagnostic {
  const sourceLocation =
    source === undefined || offset === undefined
      ? undefined
      : {
          source: diagnosticSourceAnchor(fileName, source, offset, length),
          start: offsetToPosition(source, offset),
        };
  return createRegisteredDiagnostic(
    code,
    {
      fileName,
      ...(sourceLocation !== undefined
        ? {
            ...(length === undefined ? {} : { length }),
            ...sourceLocation,
          }
        : {}),
    },
    { ...(detail === undefined ? {} : { detail }), includeHelp: true },
  );
}

/**
 * @internal Create a {@link DiagnosticFactory} bound to `fileName` and the diagnostic `source`.
 * When `offsetMap` is supplied (pre-lowering / generated-offset validators),
 * {@link diagnosticAt}'s `span.start` is treated as a generated offset and mapped to the original
 * source through the same
 * {@link generatedOffsetToOriginal} call the legacy validators applied by hand before calling
 * `diagnosticFor`, so positions stay byte-identical.
 */
export function createDiagnosticFactory(
  fileName: string,
  source: string,
  offsetMap?: SourceOffsetMap,
): DiagnosticFactory {
  const factory = Object.freeze(
    Object.defineProperty({ fileName }, diagnosticFactoryBrand, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    }),
  ) as DiagnosticFactory;
  const state = Object.freeze({ offsetMap, positionFor: createOffsetToPosition(source) });
  diagnosticFactoryStates.set(factory, state);
  return factory;
}

/**
 * @internal Emit through a runtime-owned {@link DiagnosticFactory} capability. The module-private
 * WeakMap identity check is the security boundary: a structural lookalike, cast, clone, Proxy, or
 * parameter annotation cannot mint the capability, and the frozen public shell cannot be rebound.
 */
export function diagnosticAt(
  factory: DiagnosticFactory,
  code: DiagnosticCode,
  span?: DiagnosticSpan,
  detail?: string,
): CompilerDiagnostic {
  const state = diagnosticFactoryStates.get(factory);
  if (state === undefined) {
    throw new TypeError('DiagnosticFactory must be created by createDiagnosticFactory.');
  }
  const rawStart = span?.start;
  const offset =
    state.offsetMap === undefined ? rawStart : generatedOffsetToOriginal(state.offsetMap, rawStart);
  const length = span?.length;
  const rawEnd =
    rawStart === undefined ? undefined : length === undefined ? rawStart : rawStart + length;
  const end =
    state.offsetMap === undefined
      ? rawEnd
      : rawEnd === rawStart
        ? offset
        : generatedOffsetToOriginal(state.offsetMap, rawEnd === undefined ? undefined : rawEnd - 1);
  const exclusiveEnd = end === undefined || rawEnd === rawStart ? end : end + 1;
  const sourceAnchor =
    offset === undefined || exclusiveEnd === undefined
      ? undefined
      : freezeDiagnosticSourceAnchor(factory.fileName, offset, exclusiveEnd);
  return createRegisteredDiagnostic(
    code,
    {
      fileName: factory.fileName,
      ...(offset !== undefined
        ? {
            ...(length === undefined ? {} : { length }),
            ...(sourceAnchor === undefined ? {} : { source: sourceAnchor }),
            start: state.positionFor(offset),
          }
        : {}),
    },
    { ...(detail === undefined ? {} : { detail }), includeHelp: true },
  );
}

/**
 * @internal Re-mint a compiler diagnostic when a producer needs contextual message/help text.
 * Object spread destroys the constructor-owned identity recorded by the core diagnostic registry;
 * this helper first proves the source identity, then routes the derived value back through the
 * validating constructor (SPEC §2/§11). Code and severity remain registry-owned.
 */
export function contextualizeCompilerDiagnostic(
  diagnostic: CompilerDiagnostic,
  options: Pick<DiagnosticConstructionOptions, 'help' | 'message'>,
): CompilerDiagnostic {
  assertRegisteredDiagnostic(diagnostic, 'Compiler diagnostic context source');
  const help = options.help ?? diagnostic.help;
  return deriveRegisteredDiagnostic(
    diagnostic,
    {
      fileName: diagnostic.fileName,
      ...(diagnostic.length === undefined ? {} : { length: diagnostic.length }),
      ...(diagnostic.source === undefined
        ? {}
        : {
            source: freezeDiagnosticSourceAnchor(
              diagnostic.source.file,
              diagnostic.source.start,
              diagnostic.source.end,
            ),
          }),
      ...(diagnostic.start === undefined
        ? {}
        : { start: { column: diagnostic.start.column, line: diagnostic.start.line } }),
    },
    {
      ...(help === undefined ? {} : { help }),
      message: options.message ?? diagnostic.message,
    },
  );
}

function diagnosticSourceAnchor(
  fileName: string,
  source: string,
  start: number,
  length: number | undefined,
): CompilerDiagnosticSourceAnchor {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > source.length ||
    (length !== undefined &&
      (!Number.isSafeInteger(length) || length < 0 || length > source.length - start))
  ) {
    throw new TypeError('Compiler diagnostic source span must be within authored source.');
  }
  return freezeDiagnosticSourceAnchor(fileName, start, start + (length ?? 0));
}

function freezeDiagnosticSourceAnchor(
  file: string,
  start: number,
  end: number,
): CompilerDiagnosticSourceAnchor {
  if (
    typeof file !== 'string' ||
    file.length === 0 ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    throw new TypeError('Compiler diagnostic source anchor must be a finite increasing range.');
  }
  return Object.freeze({ end, file, start });
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
