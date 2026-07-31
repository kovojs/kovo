/* oxlint-disable typescript/unbound-method -- Parser controls are captured before app evaluation. */
import type { Statement } from 'pgsql-ast-parser';

import {
  createWitnessMap,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessMapSet,
  witnessOwnKeys,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

type ManagedSqlParse = (sql: string) => unknown;

interface ParserSnapshotBudget {
  arrayEntries: number;
  keys: number;
  nodes: number;
  stringCharacters: number;
}

const MAX_MANAGED_SQL_INPUT_CHARACTERS = 262_144;
const MAX_PARSER_AST_DEPTH = 96;
const MAX_PARSER_AST_NODES = 65_536;
const MAX_PARSER_AST_KEYS = 131_072;
const MAX_PARSER_AST_RECORD_KEYS = 128;
const MAX_PARSER_AST_ARRAY_LENGTH = 16_384;
const MAX_PARSER_AST_ARRAY_ENTRIES = 65_536;
const MAX_PARSER_AST_STRING_LENGTH = 131_072;
const MAX_PARSER_AST_STRING_CHARACTERS = 262_144;

const NativeTypeError = globalThis.TypeError;

/**
 * Invoke a boot-captured SQL parser and reconstruct its result as bounded host-owned data.
 *
 * Node supplies a private-VM parser while Workers supplies a parser captured only after the
 * generated Worker locked the request-safe realm. Neither parser object nor its error crosses this
 * boundary (SPEC §6.6 rule 6, §10.3, §11.2).
 */
export function parseAndSnapshotManagedSql(
  parser: ManagedSqlParse,
  sql: string,
): Statement[] {
  if (typeof sql !== 'string') {
    throw new NativeTypeError('Kovo managed SQL parser requires a string statement.');
  }
  if (sql.length > MAX_MANAGED_SQL_INPUT_CHARACTERS) {
    throw new NativeTypeError('Kovo managed SQL statement exceeds the parser input limit.');
  }

  let foreignAst: unknown;
  try {
    foreignAst = witnessReflectApply(parser, undefined, [sql]);
  } catch {
    // Parser failures can contain the full SQL source and carets/newlines. That text can hold
    // credentials or attacker-controlled controls and is later incorporated into KV406/KV433
    // diagnostics, so the authority exports only this fixed host-owned rejection.
    throw new NativeTypeError('Kovo managed SQL parser rejected the statement.');
  }

  const snapshot = snapshotParserValue(
    foreignAst,
    createWitnessMap(),
    { arrayEntries: 0, keys: 0, nodes: 0, stringCharacters: 0 },
    0,
  );
  if (!witnessIsArray(snapshot)) {
    throw new NativeTypeError('Kovo managed SQL parser returned a non-array statement ledger.');
  }
  return snapshot as Statement[];
}

function snapshotParserValue(
  value: unknown,
  seen: Map<object, unknown>,
  budget: ParserSnapshotBudget,
  depth: number,
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_PARSER_AST_NODES) {
    throw new NativeTypeError('Kovo managed SQL parser AST exceeds the node limit.');
  }
  if (depth > MAX_PARSER_AST_DEPTH) {
    throw new NativeTypeError('Kovo managed SQL parser AST exceeds the depth limit.');
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_PARSER_AST_STRING_LENGTH) {
      throw new NativeTypeError('Kovo managed SQL parser AST string exceeds the length limit.');
    }
    budget.stringCharacters += value.length;
    if (budget.stringCharacters > MAX_PARSER_AST_STRING_CHARACTERS) {
      throw new NativeTypeError('Kovo managed SQL parser AST exceeds the string budget.');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new NativeTypeError('Kovo managed SQL parser returned a non-data AST value.');
  }

  const existing = witnessMapGet(seen, value);
  if (existing !== undefined) return existing;

  if (witnessIsArray(value)) {
    if (value.length > MAX_PARSER_AST_ARRAY_LENGTH) {
      throw new NativeTypeError('Kovo managed SQL parser AST list exceeds the length limit.');
    }
    budget.arrayEntries += value.length;
    if (budget.arrayEntries > MAX_PARSER_AST_ARRAY_ENTRIES) {
      throw new NativeTypeError('Kovo managed SQL parser AST exceeds the list-entry budget.');
    }
    budget.keys += value.length;
    if (budget.keys > MAX_PARSER_AST_KEYS) {
      throw new NativeTypeError('Kovo managed SQL parser AST exceeds the key budget.');
    }
    const snapshot: unknown[] = [];
    witnessMapSet(seen, value, snapshot);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new NativeTypeError(
          'Kovo managed SQL parser returned a sparse or accessor AST list.',
        );
      }
      witnessDefineProperty(snapshot, index, {
        configurable: true,
        enumerable: true,
        value: snapshotParserValue(descriptor.value, seen, budget, depth + 1),
        writable: true,
      });
    }
    return witnessFreeze(snapshot);
  }

  const snapshot = witnessCreateNullRecord<unknown>();
  witnessMapSet(seen, value, snapshot);
  const keys = witnessOwnKeys(value);
  if (keys.length > MAX_PARSER_AST_RECORD_KEYS) {
    throw new NativeTypeError('Kovo managed SQL parser AST record exceeds the key limit.');
  }
  budget.keys += keys.length;
  if (budget.keys > MAX_PARSER_AST_KEYS) {
    throw new NativeTypeError('Kovo managed SQL parser AST exceeds the key budget.');
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') {
      throw new NativeTypeError('Kovo managed SQL parser returned a symbol-bearing AST record.');
    }
    const descriptor = witnessGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new NativeTypeError('Kovo managed SQL parser returned an accessor AST record.');
    }
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: descriptor.enumerable === true,
      value: snapshotParserValue(descriptor.value, seen, budget, depth + 1),
      writable: true,
    });
  }
  return witnessFreeze(snapshot);
}
