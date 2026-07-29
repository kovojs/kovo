import type * as CoreGraph from '@kovojs/core/internal/graph';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';
import { resolve } from 'node:path';

import type { CliCommandResult, KovoCheckResult } from './shared.js';
import { assertKovoArtifactGraphProof, hasKovoArtifactGraphProof } from './graph-proof.js';
import { findNearestFile, readJsonRecord } from './tooling.js';

export function runGraphCommand(
  inputPath: string | undefined,
  run: (input: CoreGraph.KovoExplainInput) => KovoCheckResult,
  invocationCwd = process.cwd(),
): CliCommandResult {
  const input = readGraphInput(inputPath, invocationCwd);
  if (!input.ok) return { error: inputErrorMessage(input.error), exitCode: 1 };
  return run(input.value);
}

/** Select either a non-deployment review graph or an explicitly named completed artifact graph. */
export function runSelectedGraphCommand(
  inputPath: string | undefined,
  artifact: boolean,
  run: (input: CoreGraph.KovoExplainInput) => KovoCheckResult,
  invocationCwd = process.cwd(),
): CliCommandResult {
  if (artifact && inputPath === undefined) {
    return { error: 'kovo: --artifact requires a graph path.', exitCode: 2 };
  }
  const input = readGraphInput(inputPath, invocationCwd);
  if (!input.ok) return { error: inputErrorMessage(input.error), exitCode: 1 };
  try {
    if (artifact) {
      assertKovoArtifactGraphProof(input.value);
    } else if (hasKovoArtifactGraphProof(input.value)) {
      throw new TypeError(
        'A completed build graph must be selected with --artifact; rebuild or select current source proof.',
      );
    }
  } catch (error) {
    return {
      error: `kovo: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
  return run(input.value);
}

/**
 * Run a graph-only check without permitting the historical empty-object fallback.
 *
 * Bare `kovo check` now derives current source proof. Focused graph-family invocations remain
 * available for generated test/review graphs, but absence of both an explicit and conventional
 * graph is a proof failure rather than vacuous `OK` (SPEC §11.4).
 */
export function runRequiredGraphCommand(
  inputPath: string | undefined,
  run: (input: CoreGraph.KovoExplainInput) => KovoCheckResult,
  invocationCwd = process.cwd(),
  family = 'graph',
): CliCommandResult {
  const selectedPath = inputPath ?? discoverGraphInputPath(invocationCwd);
  if (selectedPath === undefined) {
    return {
      error: `kovo: check ${family} requires a graph input; pass graph.json or run bare kovo check to derive current source proof.`,
      exitCode: 1,
    };
  }
  return runGraphCommand(selectedPath, run, invocationCwd);
}

/** Required counterpart of {@link runSelectedGraphCommand}. */
export function runRequiredSelectedGraphCommand(
  inputPath: string | undefined,
  artifact: boolean,
  run: (input: CoreGraph.KovoExplainInput) => KovoCheckResult,
  invocationCwd = process.cwd(),
  family = 'graph',
): CliCommandResult {
  const selectedPath = inputPath ?? (artifact ? undefined : discoverGraphInputPath(invocationCwd));
  if (selectedPath === undefined) {
    return {
      error: artifact
        ? 'kovo: --artifact requires a graph path.'
        : `kovo: check ${family} requires a graph input; pass graph.json or run bare kovo check to derive current source proof.`,
      exitCode: artifact ? 2 : 1,
    };
  }
  return runSelectedGraphCommand(selectedPath, artifact, run, invocationCwd);
}

interface InputReadError {
  expected?: 'array' | 'object';
  field?: string;
  kind:
    | 'invalid-field-shape'
    | 'invalid-json'
    | 'invalid-shape'
    | 'invalid-value'
    | 'not-found'
    | 'read-error';
  message?: string;
  path: string;
}

type InputReadResult =
  | { ok: true; value: CoreGraph.KovoExplainInput }
  | { error: InputReadError; ok: false };

export function readGraphInput(
  path: string | undefined,
  invocationCwd = process.cwd(),
): InputReadResult {
  if (!path) {
    const discoveredPath = discoverGraphInputPath(invocationCwd);
    if (discoveredPath === undefined) return { ok: true, value: {} };
    return readGraphInput(discoveredPath, invocationCwd);
  }

  const resolvedPath = resolve(invocationCwd, path);
  const read = readJsonRecord(resolvedPath);
  if (!read.ok) return { error: read.error, ok: false };

  const validationErrors = validateKovoExplainInput(read.value);
  if (validationErrors.length > 0) {
    const validationError = validationErrors[0];
    if (validationError) {
      return { error: graphInputValidationReadError(validationError, resolvedPath), ok: false };
    }
  }

  return { ok: true, value: read.value as CoreGraph.KovoExplainInput };
}

export function discoverGraphInputPath(invocationCwd = process.cwd()): string | undefined {
  return discoverGraphInputPaths(invocationCwd)[0];
}

/** @internal Return every conventional graph artifact instead of silently choosing one. */
export function discoverGraphInputPaths(invocationCwd = process.cwd()): readonly string[] {
  const candidates = [
    findNearestFile(invocationCwd, 'graph.json', { stopDir: invocationCwd }),
    findNearestFile(invocationCwd, '.kovo/graph.json', { stopDir: invocationCwd }),
    findNearestFile(invocationCwd, 'dist/.kovo/graph.json', { stopDir: invocationCwd }),
  ];
  return Object.freeze(candidates.filter((path): path is string => path !== undefined));
}

export function inputErrorMessage(error: InputReadError): string {
  const messages: Record<InputReadError['kind'], string> = {
    'invalid-field-shape': `kovo: input JSON field ${error.field ?? '-'} must be an ${error.expected ?? 'object'}: ${error.path}`,
    'invalid-json': `kovo: input file is not valid JSON: ${error.path}`,
    'invalid-shape': `kovo: input JSON must be an object: ${error.path}`,
    'invalid-value': `kovo: input JSON invalid: ${error.path}: ${error.field ?? '$'} ${error.message ?? 'is invalid'}`,
    'not-found': `kovo: input file not found: ${error.path}`,
    'read-error': `kovo: unable to read input file: ${error.path}`,
  };
  return messages[error.kind];
}

function graphInputValidationReadError(
  error: CoreGraph.GraphInputValidationError,
  path: string,
): InputReadError {
  const arrayShape = /^([A-Za-z]+) must be an array$/.exec(error.message);
  const arrayField = arrayShape?.[1];
  if (arrayField) {
    return { expected: 'array', field: arrayField, kind: 'invalid-field-shape', path };
  }
  if (error.message === 'touchGraph must be an object') {
    return { expected: 'object', field: 'touchGraph', kind: 'invalid-field-shape', path };
  }
  if (error.path === '$') return { kind: 'invalid-shape', path };

  return { field: error.path, kind: 'invalid-value', message: error.message, path };
}
