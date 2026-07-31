/* oxlint-disable typescript/unbound-method -- VM and CommonJS controls are captured before app evaluation. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, Script, type Context } from 'node:vm';

import {
  createWitnessMap,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessMapGet,
  witnessMapSet,
  witnessReflectApply,
} from './security-witness-intrinsics.js';
import { parseAndSnapshotManagedSql } from './sql-parser-authority-snapshot.js';

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
export function parseWithIsolatedSqlParser(sql: string) {
  return parseAndSnapshotManagedSql(isolatedParse, sql);
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
