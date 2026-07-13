import type * as CoreGraph from '@kovojs/core/internal/graph';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';
import { resolve } from 'node:path';

import type { CliCommandResult, KovoCheckResult } from './shared.js';
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
  return (
    findNearestFile(invocationCwd, 'graph.json', { stopDir: invocationCwd }) ??
    findNearestFile(invocationCwd, '.kovo/graph.json', { stopDir: invocationCwd }) ??
    findNearestFile(invocationCwd, 'dist/.kovo/graph.json', { stopDir: invocationCwd })
  );
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
