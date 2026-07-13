/* oxlint-disable typescript/unbound-method -- VM and CommonJS controls are captured before app evaluation. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, Script, type Context } from 'node:vm';

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

/**
 * Private SQL-parser authority realm (SPEC §6.6 rule 6, §10.3, §11.2).
 *
 * `pgsql-ast-parser` delegates to Nearley and Moo. Merely capturing its exported `parse` function
 * is insufficient because those functions continue to dispatch through the application realm's
 * mutable intrinsics while parsing. Load the exact installed CommonJS sources into a private VM
 * realm during the trusted server bootstrap instead. Only the two reviewed parser dependencies are
 * resolvable inside that realm, string/Wasm code generation is disabled after the three wrappers
 * are compiled, and the returned foreign-realm AST crosses through an own-data deep snapshot before
 * any security classifier consumes it.
 *
 * This module is an audited dynamic-code sink. Its source bytes come only from package-manager
 * resolved framework dependencies, never from an app, request, database, environment value, or
 * generated artifact.
 */

type ParserModuleId = 'moo' | 'nearley' | 'pgsql-ast-parser';

interface ParserModuleSource {
  readonly fileName: string;
  readonly source: string;
}

interface CommonJsModule {
  exports: unknown;
}

type CommonJsFactory = (
  module: CommonJsModule,
  exports: unknown,
  require: (id: string) => unknown,
  fileName: string,
  directoryName: string,
) => void;

type IsolatedParse = (sql: string) => unknown;

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
const parserRequire = createRequire(import.meta.url);
const pgsqlParserPath = parserRequire.resolve('pgsql-ast-parser');
const parserDependencyRequire = createRequire(pgsqlParserPath);
const parserModuleSources = loadParserModuleSources();
const parserContext = createContext(witnessCreateNullRecord(), {
  codeGeneration: { strings: false, wasm: false },
  name: 'kovo-managed-sql-parser',
});
const isolatedParse = loadIsolatedParse(parserContext, parserModuleSources);

/** Parse SQL through the boot-created private realm and return only host-owned AST facts. */
export function parseWithIsolatedSqlParser(sql: string): Statement[] {
  if (typeof sql !== 'string') {
    throw new NativeTypeError('Kovo managed SQL parser requires a string statement.');
  }
  if (sql.length > MAX_MANAGED_SQL_INPUT_CHARACTERS) {
    throw new NativeTypeError('Kovo managed SQL statement exceeds the parser input limit.');
  }

  let foreignAst: unknown;
  try {
    foreignAst = witnessReflectApply(isolatedParse, undefined, [sql]);
  } catch {
    // Parser failures can contain the full SQL source and carets/newlines. That text can hold
    // credentials or attacker-controlled controls and is later incorporated into KV406/KV433
    // diagnostics, so the private realm exports only this fixed host-owned rejection.
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

function loadParserModuleSources(): ReadonlyMap<ParserModuleId, ParserModuleSource> {
  const sources = createWitnessMap<ParserModuleId, ParserModuleSource>();
  loadParserModuleSource(sources, 'pgsql-ast-parser', pgsqlParserPath);
  loadParserModuleSource(sources, 'moo', parserDependencyRequire.resolve('moo'));
  loadParserModuleSource(sources, 'nearley', parserDependencyRequire.resolve('nearley'));
  return sources;
}

function loadParserModuleSource(
  sources: Map<ParserModuleId, ParserModuleSource>,
  id: ParserModuleId,
  fileName: string,
): void {
  witnessMapSet(
    sources,
    id,
    witnessFreeze({
      fileName,
      source: readFileSync(fileName, 'utf8'),
    }),
  );
}

function loadIsolatedParse(
  context: Context,
  sources: ReadonlyMap<ParserModuleId, ParserModuleSource>,
): IsolatedParse {
  const moduleCache = createWitnessMap<ParserModuleId, CommonJsModule>();

  function load(id: string): unknown {
    if (!isParserModuleId(id)) {
      throw new NativeTypeError(`Kovo managed SQL parser denied unexpected dependency ${id}.`);
    }
    const cached = witnessMapGet(moduleCache, id);
    if (cached !== undefined) return cached.exports;

    const source = witnessMapGet(sources, id);
    if (source === undefined) {
      throw new NativeTypeError(`Kovo managed SQL parser source ${id} is unavailable.`);
    }
    const module: CommonJsModule = { exports: witnessCreateNullRecord() };
    witnessMapSet(moduleCache, id, module);
    const script = new Script(
      `(function (module, exports, require, __filename, __dirname) {\n${source.source}\n})`,
      { filename: source.fileName },
    );
    const factory = script.runInContext(context) as CommonJsFactory;
    witnessReflectApply(factory, module.exports, [
      module,
      module.exports,
      load,
      source.fileName,
      '',
    ]);
    return module.exports;
  }

  const parser = load('pgsql-ast-parser');
  if (typeof parser !== 'object' || parser === null) {
    throw new NativeTypeError('Kovo managed SQL parser module did not expose an object.');
  }
  const descriptor = witnessGetOwnPropertyDescriptor(parser, 'parse');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new NativeTypeError('Kovo managed SQL parser authority is unavailable.');
  }
  return descriptor.value as IsolatedParse;
}

function isParserModuleId(id: string): id is ParserModuleId {
  return id === 'moo' || id === 'nearley' || id === 'pgsql-ast-parser';
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
