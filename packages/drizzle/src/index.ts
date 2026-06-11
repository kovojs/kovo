export type { DiagnosticCode } from '@jiso/core';
import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';

export interface JisoTableAnnotation {
  domain: string;
  key?: string;
}

export function jiso(annotation: JisoTableAnnotation): JisoTableAnnotation {
  return annotation;
}

export interface TouchSite {
  branch?: string;
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  via: string;
}

export interface ReadSite {
  branch?: string;
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  source: string;
  via: string;
}

export interface UnresolvedWriteSite {
  code: 'FW406';
  domain?: string;
  message: string;
  site: string;
}

export interface TouchGraphEntry {
  reads?: readonly ReadSite[];
  touches: readonly TouchSite[];
  unresolved: readonly UnresolvedWriteSite[];
}

export type TouchGraph = Readonly<Record<string, TouchGraphEntry>>;

export interface DomainRegistryInput {
  table: JisoTableAnnotation & { name: string };
}

export interface WriteSummaryInput {
  branch?: string;
  operation: string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  table: JisoTableAnnotation & { name: string };
  writeKey?: string;
}

export interface ReadSummaryInput {
  branch?: string;
  operation: 'insert-select' | 'update-from' | (string & {});
  predicate?: 'eq' | 'non-eq';
  readKey?: string;
  site: string;
  table: JisoTableAnnotation & { name: string };
}

export interface UnresolvedSummaryInput {
  domain?: string;
  operation: string;
  site: string;
}

export interface TouchGraphDiagnostic {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

export interface SourceFileInput {
  fileName: string;
  source: string;
}

interface ExtractedTable {
  annotation: JisoTableAnnotation & { name: string };
}

export function serializeDomainRegistry(tables: readonly DomainRegistryInput[]): string {
  const rows = [...tables].sort((left, right) => left.table.name.localeCompare(right.table.name));
  const domains = [...new Set(rows.map((row) => row.table.domain))].sort();
  const domainKey = domains.map((domain) => JSON.stringify(domain)).join(' | ') || 'never';
  const lines = [`export type DomainKey = ${domainKey};`, '', 'export const tableDomains = {'];

  for (const row of rows) {
    lines.push(`  ${JSON.stringify(row.table.name)}: ${JSON.stringify(row.table.domain)},`);
  }

  lines.push('} as const satisfies Record<string, DomainKey>;');
  return `${lines.join('\n')}\n`;
}

export function createTouchGraphEntry(input: {
  reads?: readonly ReadSummaryInput[];
  unresolved?: readonly UnresolvedSummaryInput[];
  writes?: readonly WriteSummaryInput[];
}): TouchGraphEntry {
  return {
    reads: [...(input.reads ?? [])]
      .map((read) => ({
        ...(read.branch === undefined ? {} : { branch: read.branch }),
        domain: read.table.domain,
        keys: read.readKey ?? null,
        ...(read.predicate === undefined ? {} : { predicate: read.predicate }),
        site: read.site,
        source: read.operation,
        via: read.table.name,
      }))
      .sort(compareReadSites),
    touches: [...(input.writes ?? [])]
      .map((write) => ({
        ...(write.branch === undefined ? {} : { branch: write.branch }),
        domain: write.table.domain,
        keys: write.writeKey ?? null,
        ...(write.predicate === undefined ? {} : { predicate: write.predicate }),
        site: write.site,
        via: write.table.name,
      }))
      .sort(compareTouchSites),
    unresolved: [...(input.unresolved ?? [])].map((site) => ({
      code: 'FW406',
      ...(site.domain === undefined ? {} : { domain: site.domain }),
      message: diagnosticDefinitions.FW406.message,
      site: site.site,
    })),
  };
}

export function serializeTouchGraph(graph: TouchGraph): string {
  const lines = ['export const touchGraph = {'];

  for (const [writeName, entry] of Object.entries(graph).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${JSON.stringify(writeName)}: {`);
    lines.push('    touches: [');
    for (const touch of entry.touches) {
      lines.push(
        `      { domain: ${JSON.stringify(touch.domain)}, via: ${JSON.stringify(touch.via)}, site: ${JSON.stringify(touch.site)}, keys: ${JSON.stringify(touch.keys)}${touch.branch === undefined ? '' : `, branch: ${JSON.stringify(touch.branch)}`}${touch.predicate === undefined ? '' : `, predicate: ${JSON.stringify(touch.predicate)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('    reads: [');
    for (const read of entry.reads ?? []) {
      lines.push(
        `      { domain: ${JSON.stringify(read.domain)}, via: ${JSON.stringify(read.via)}, site: ${JSON.stringify(read.site)}, keys: ${JSON.stringify(read.keys)}, source: ${JSON.stringify(read.source)}${read.branch === undefined ? '' : `, branch: ${JSON.stringify(read.branch)}`}${read.predicate === undefined ? '' : `, predicate: ${JSON.stringify(read.predicate)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('    unresolved: [');
    for (const unresolved of entry.unresolved) {
      lines.push(
        `      { code: 'FW406', site: ${JSON.stringify(unresolved.site)}, message: ${JSON.stringify(unresolved.message)}${unresolved.domain === undefined ? '' : `, domain: ${JSON.stringify(unresolved.domain)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('} as const;');
  return `${lines.join('\n')}\n`;
}

export function diagnosticsForTouchGraph(graph: TouchGraph): TouchGraphDiagnostic[] {
  return Object.values(graph).flatMap((entry) => [
    ...entry.unresolved.map((unresolved) => ({
      code: unresolved.code,
      message: unresolved.message,
      severity: diagnosticDefinitions[unresolved.code].severity,
      site: unresolved.site,
    })),
    ...entry.touches
      .filter((touch) => touch.predicate === 'non-eq')
      .map((touch) => ({
        code: 'FW409' as const,
        message: diagnosticDefinitions.FW409.message,
        severity: diagnosticDefinitions.FW409.severity,
        site: touch.site,
      })),
    ...(entry.reads ?? [])
      .filter((read) => read.predicate === 'non-eq')
      .map((read) => ({
        code: 'FW409' as const,
        message: diagnosticDefinitions.FW409.message,
        severity: diagnosticDefinitions.FW409.severity,
        site: read.site,
      })),
  ]);
}

export function extractTouchGraphFromSource(files: readonly SourceFileInput[]): TouchGraph {
  const tables = new Map<string, ExtractedTable[]>();
  const unresolvedIdentifiers = new Set<string>();
  const graph: Record<string, TouchGraphEntry> = {};

  for (const file of files) {
    for (const table of extractTables(file.source)) {
      appendTable(tables, table.identifier, {
        annotation: {
          domain: table.domain,
          ...(table.key ? { key: table.key } : {}),
          name: table.name,
        },
      });
    }
  }
  for (const file of files) {
    for (const alias of exportTableAliases(file.source)) {
      appendTableEntries(tables, alias.local, tables.get(alias.imported) ?? []);
    }
  }
  for (const file of files) {
    for (const identifier of extractUnresolvedConditionalIdentifiers(file.source, tables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  for (const file of files) {
    const fileTables = tablesForFile(file.source, tables);
    const functions = extractFunctions(file.source);
    const functionsByName = new Map(functions.map((fn) => [fn.name, fn]));
    const localFunctionNames = new Set(functionsByName.keys());
    const callsByName = new Map(
      functions.map((fn) => [
        fn.name,
        extractLocalFunctionCalls(fn.body).filter((call) => functionsByName.has(call)),
      ]),
    );
    const summaries = new Map(
      functions.map((fn) => [
        fn.name,
        directSummaryForFunction(fn, file, fileTables, unresolvedIdentifiers, localFunctionNames),
      ]),
    );

    let changed = true;
    while (changed) {
      changed = false;

      for (const fn of functions) {
        const summary = summaries.get(fn.name);
        if (!summary) continue;

        for (const call of callsByName.get(fn.name) ?? []) {
          const calleeSummary = summaries.get(call);
          if (!calleeSummary) continue;

          if (mergeSummary(summary, calleeSummary)) changed = true;
        }
      }
    }

    for (const fn of functions) {
      const { reads, unresolved, writes } = summaries.get(fn.name) ?? {
        reads: [],
        unresolved: [],
        writes: [],
      };
      if (reads.length > 0 || writes.length > 0 || unresolved.length > 0) {
        graph[fn.name] = createTouchGraphEntry({ reads, unresolved, writes });
      }
    }
  }

  return graph;
}

interface ExtractedTableDeclaration {
  domain: string;
  identifier: string;
  key?: string;
  name: string;
}

interface ExtractedFunction {
  body: string;
  bodyStart: number;
  name: string;
  params: string;
}

interface ExtractedWriteCall {
  index: number;
  operation: string;
  readSources: ExtractedReadSource[];
  statement: string;
  tableExpression: string;
}

interface ExtractedReadSource {
  operation: 'insert-select' | 'update-from';
  tableExpression: string;
}

interface ExtractedPredicateSummary {
  key?: string;
  predicate?: 'non-eq';
}

interface FunctionTouchSummary {
  reads: ReadSummaryInput[];
  unresolved: UnresolvedSummaryInput[];
  writes: WriteSummaryInput[];
}

function directSummaryForFunction(
  fn: ExtractedFunction,
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
  localFunctionNames: ReadonlySet<string>,
): FunctionTouchSummary {
  const reads: ReadSummaryInput[] = [];
  const writes: WriteSummaryInput[] = [];
  const unresolved: UnresolvedSummaryInput[] = [];
  const receiverNames = drizzleReceiverNames(fn.params, fn.body);

  for (const call of extractDrizzleWriteCalls(fn.body, receiverNames)) {
    const site = `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        const writePredicate = extractPredicateSummary(
          call.statement,
          call.tableExpression,
          table.annotation,
          tables,
        );
        writes.push({
          operation: call.operation,
          site,
          table: table.annotation,
          ...(writePredicate.predicate ? { predicate: writePredicate.predicate } : {}),
          ...(writePredicate.key ? { writeKey: writePredicate.key } : {}),
        });
      }
      for (const readSource of call.readSources) {
        const readTables = tables.get(readSource.tableExpression) ?? [];
        if (readTables.length > 0) {
          for (const readTable of readTables) {
            const readPredicate = extractPredicateSummary(
              call.statement,
              readSource.tableExpression,
              readTable.annotation,
              tables,
            );
            reads.push({
              operation: readSource.operation,
              ...(readPredicate.predicate ? { predicate: readPredicate.predicate } : {}),
              ...(readPredicate.key ? { readKey: readPredicate.key } : {}),
              site,
              table: readTable.annotation,
            });
          }
          if (unresolvedIdentifiers.has(readSource.tableExpression)) {
            unresolved.push({
              operation: readSource.operation,
              site,
            });
          }
          continue;
        }

        unresolved.push({
          operation: readSource.operation,
          site,
        });
      }
      if (unresolvedIdentifiers.has(call.tableExpression)) {
        unresolved.push({
          operation: call.operation,
          site,
        });
      }
      continue;
    }

    unresolved.push({
      operation: call.operation,
      site,
    });
  }

  for (const call of extractExternalDbArgumentCalls(fn.body, receiverNames, localFunctionNames)) {
    unresolved.push({
      operation: call.name,
      site: `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`,
    });
  }

  return { reads, unresolved, writes };
}

function mergeSummary(target: FunctionTouchSummary, source: FunctionTouchSummary): boolean {
  let changed = false;

  changed = pushUnique(target.reads, source.reads, readSummaryKey) || changed;
  changed = pushUnique(target.unresolved, source.unresolved, unresolvedSummaryKey) || changed;
  changed = pushUnique(target.writes, source.writes, writeSummaryKey) || changed;

  return changed;
}

function pushUnique<T>(target: T[], source: readonly T[], keyFor: (item: T) => string): boolean {
  const keys = new Set(target.map(keyFor));
  let changed = false;

  for (const item of source) {
    const key = keyFor(item);
    if (keys.has(key)) continue;

    keys.add(key);
    target.push(item);
    changed = true;
  }

  return changed;
}

function readSummaryKey(read: ReadSummaryInput): string {
  return [
    read.operation,
    read.table.name,
    read.site,
    read.readKey ?? '',
    read.predicate ?? '',
    read.branch ?? '',
  ].join('\0');
}

function unresolvedSummaryKey(unresolved: UnresolvedSummaryInput): string {
  return [unresolved.operation, unresolved.site, unresolved.domain ?? ''].join('\0');
}

function writeSummaryKey(write: WriteSummaryInput): string {
  return [
    write.operation,
    write.table.name,
    write.site,
    write.writeKey ?? '',
    write.predicate ?? '',
    write.branch ?? '',
  ].join('\0');
}

function extractTables(source: string): ExtractedTableDeclaration[] {
  const tables: ExtractedTableDeclaration[] = [];
  const byIdentifier = new Map<string, ExtractedTableDeclaration[]>();
  const declarations =
    /(?:export\s+)?const\s+(?<identifier>[A-Za-z_$][\w$]*)\s*=\s*(?<initializer>[\s\S]*?);/g;

  const matches = [...source.matchAll(declarations)];

  for (const match of matches) {
    const declaration = tableDeclarationFromMatch(match);
    if (!declaration) continue;

    const { identifier, initializer } = declaration;
    const domain = stringProperty(initializer, 'domain');
    if (!domain) continue;

    const key = stringProperty(initializer, 'key');

    const table = {
      domain,
      identifier,
      ...(key ? { key } : {}),
      name: stringArgument(initializer) ?? identifier,
    };
    tables.push(table);
    appendTable(byIdentifier, identifier, table);
  }

  for (const match of matches) {
    const declaration = tableDeclarationFromMatch(match);
    if (!declaration || (byIdentifier.get(declaration.identifier)?.length ?? 0) > 0) continue;

    for (const target of aliasTargets(declaration.initializer)) {
      for (const table of byIdentifier.get(target) ?? []) {
        const alias = {
          domain: table.domain,
          identifier: declaration.identifier,
          ...(table.key ? { key: table.key } : {}),
          name: table.name,
        };
        tables.push(alias);
        appendTable(byIdentifier, alias.identifier, alias);
      }
    }
  }

  return tables;
}

function tablesForFile(
  source: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Map<string, ExtractedTable[]> {
  const scoped = new Map([...tables].map(([identifier, entries]) => [identifier, [...entries]]));

  for (const namespace of namespaceImportAliases(source)) {
    for (const [identifier, entries] of tables) {
      appendTableEntries(scoped, `${namespace}.${identifier}`, entries);
    }
  }
  for (const alias of importExportTableAliases(source)) {
    appendTableEntries(scoped, alias.local, tables.get(alias.imported) ?? []);
  }

  return scoped;
}

function namespaceImportAliases(source: string): string[] {
  const aliases: string[] = [];
  const pattern = /import\s+\*\s+as\s+(?<alias>[A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g;

  for (const match of source.matchAll(pattern)) {
    const alias = match.groups?.alias;
    if (alias) aliases.push(alias);
  }

  return aliases;
}

function importExportTableAliases(source: string): { imported: string; local: string }[] {
  const aliases: { imported: string; local: string }[] = [];
  const pattern =
    /\b(?:import|export)\s*\{\s*(?<specifiers>[^}]+)\s*\}(?:\s*from\s*["'][^"']+["'])?/g;

  for (const match of source.matchAll(pattern)) {
    const specifiers = match.groups?.specifiers;
    if (!specifiers) continue;

    for (const specifier of specifiers.split(',')) {
      const parts = /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/.exec(
        specifier.trim(),
      )?.groups;
      const imported = parts?.imported;
      const local = parts?.local;
      if (imported && local && imported !== local) aliases.push({ imported, local });
    }
  }

  return aliases;
}

function exportTableAliases(source: string): { imported: string; local: string }[] {
  const aliases: { imported: string; local: string }[] = [];
  const pattern = /\bexport\s*\{\s*(?<specifiers>[^}]+)\s*\}(?:\s*from\s*["'][^"']+["'])?/g;

  for (const match of source.matchAll(pattern)) {
    const specifiers = match.groups?.specifiers;
    if (!specifiers) continue;

    for (const specifier of specifiers.split(',')) {
      const parts = /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/.exec(
        specifier.trim(),
      )?.groups;
      const imported = parts?.imported;
      const local = parts?.local;
      if (imported && local && imported !== local) aliases.push({ imported, local });
    }
  }

  return aliases;
}

function tableDeclarationFromMatch(
  match: RegExpMatchArray,
): { identifier: string; initializer: string } | undefined {
  const groups = match.groups;
  if (!groups) return undefined;

  const identifier = groups.identifier;
  const initializer = groups.initializer;
  return identifier && initializer ? { identifier, initializer } : undefined;
}

function aliasTargets(initializer: string): string[] {
  const trimmed = initializer.trim();
  const direct = /^(?<identifier>[A-Za-z_$][\w$]*)$/.exec(trimmed)?.groups?.identifier;
  if (direct) return [direct];

  const alias = /^alias\s*\(\s*(?<identifier>[A-Za-z_$][\w$]*)\s*,/.exec(trimmed)?.groups
    ?.identifier;
  if (alias) return [alias];

  return conditionalBranches(trimmed).filter(Boolean);
}

function extractUnresolvedConditionalIdentifiers(
  source: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const unresolved: string[] = [];
  const declarations =
    /(?:export\s+)?const\s+(?<identifier>[A-Za-z_$][\w$]*)\s*=\s*(?<initializer>[\s\S]*?);/g;

  for (const match of source.matchAll(declarations)) {
    const declaration = tableDeclarationFromMatch(match);
    if (!declaration) continue;

    const targets = conditionalBranches(declaration.initializer);
    if (targets.length === 0) continue;

    const resolvedCount = targets.filter((target) => (tables.get(target)?.length ?? 0) > 0).length;
    if (resolvedCount > 0 && resolvedCount < targets.length)
      unresolved.push(declaration.identifier);
  }

  return unresolved;
}

function conditionalBranches(initializer: string): string[] {
  const groups = /^[\s\S]+?\?\s*(?<whenTrue>[^:]+?)\s*:\s*(?<whenFalse>[\s\S]+)$/.exec(
    initializer.trim(),
  )?.groups;
  if (!groups) return [];

  return [groups.whenTrue, groups.whenFalse]
    .map((branch) => branch?.trim())
    .flatMap((branch) => (/^[A-Za-z_$][\w$]*$/.test(branch ?? '') ? [branch as string] : ['']));
}

function extractFunctions(source: string): ExtractedFunction[] {
  const functions: ExtractedFunction[] = [];
  const declarations =
    /(?:export\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\s*\((?<params>[^)]*)\)\s*\{/g;

  for (const match of source.matchAll(declarations)) {
    const groups = match.groups;
    if (!groups || match.index === undefined) continue;

    const name = groups.name;
    if (!name) continue;

    const openBrace = match.index + match[0].length - 1;
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace === -1) continue;

    functions.push({
      body: source.slice(openBrace + 1, closeBrace),
      bodyStart: openBrace + 1,
      name,
      params: groups.params ?? '',
    });
  }

  return functions;
}

function extractLocalFunctionCalls(source: string): string[] {
  const calls: string[] = [];
  const callPattern = /\b(?<name>[A-Za-z_$][\w$]*)\s*\(/g;
  const ignored = new Set([
    'delete',
    'eq',
    'for',
    'function',
    'if',
    'insert',
    'jiso',
    'pgTable',
    'return',
    'select',
    'switch',
    'update',
    'while',
  ]);

  for (const match of source.matchAll(callPattern)) {
    const name = match.groups?.name;
    if (!name || ignored.has(name)) continue;

    const previous = source.slice(0, match.index).trimEnd().at(-1);
    if (previous === '.') continue;

    calls.push(name);
  }

  return [...new Set(calls)];
}

function extractDrizzleWriteCalls(
  source: string,
  receiverNames: ReadonlySet<string> = new Set(['db', 'tx']),
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];
  const callPattern =
    /(?<receiver>[A-Za-z_$][\w$]*)\s*\.\s*(?<operation>insert|update|delete)\s*\(\s*(?<tableExpression>[^)]+?)\s*\)/g;

  for (const match of source.matchAll(callPattern)) {
    const groups = match.groups;
    if (!groups || match.index === undefined) continue;

    const receiver = groups.receiver;
    const operation = groups.operation;
    const tableExpression = groups.tableExpression;
    if (!receiver || !receiverNames.has(receiver) || !operation || !tableExpression) continue;
    const statement = source.slice(match.index, statementEnd(source, match.index));

    calls.push({
      index: match.index,
      operation,
      readSources: extractReadSources(statement, operation),
      statement,
      tableExpression: tableExpression.trim(),
    });
  }

  return calls;
}

interface ExternalDbArgumentCall {
  index: number;
  name: string;
}

function extractExternalDbArgumentCalls(
  source: string,
  receiverNames: ReadonlySet<string>,
  localFunctionNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const ignored = new Set([
    'delete',
    'eq',
    'for',
    'function',
    'if',
    'insert',
    'jiso',
    'pgTable',
    'return',
    'select',
    'switch',
    'update',
    'while',
  ]);
  const pattern = /\b(?<name>[A-Za-z_$][\w$]*)\s*\((?<args>[^)]*)\)/g;

  for (const match of source.matchAll(pattern)) {
    const name = match.groups?.name;
    const args = match.groups?.args;
    if (!name || !args || match.index === undefined) continue;
    if (ignored.has(name) || localFunctionNames.has(name)) continue;

    const previous = source.slice(0, match.index).trimEnd().at(-1);
    if (previous === '.') continue;

    const passedReceivers = splitTopLevelArgs(args).some((arg) => receiverNames.has(arg.trim()));
    if (passedReceivers) calls.push({ index: match.index, name });
  }

  return calls;
}

function drizzleReceiverNames(params: string, body = ''): Set<string> {
  const names = new Set(['db', 'tx']);

  for (const param of splitTopLevelArgs(params)) {
    const trimmed = param.trim();
    const identifier = /^(?<name>[A-Za-z_$][\w$]*)\b/.exec(trimmed)?.groups?.name;
    if (identifier && isLikelyDrizzleReceiver(identifier)) names.add(identifier);

    for (const match of trimmed.matchAll(/\b(?<name>db|tx)\b/g)) {
      const name = match.groups?.name;
      if (name) names.add(name);
    }
  }
  for (const match of body.matchAll(
    /\b(?:const|let)\s*\{\s*(?:db|tx)\s*:\s*(?<alias>[A-Za-z_$][\w$]*)\s*\}/g,
  )) {
    const alias = match.groups?.alias;
    if (alias) names.add(alias);
  }

  return names;
}

function isLikelyDrizzleReceiver(name: string): boolean {
  return /^(db|tx|trx|database|client|conn|connection|writer|transaction)$/.test(name);
}

function extractReadSources(source: string, operation: string): ExtractedReadSource[] {
  const sourceOperation =
    operation === 'insert' && /\.select\s*\(/.test(source)
      ? 'insert-select'
      : operation === 'update' && /\.from\s*\(/.test(source)
        ? 'update-from'
        : null;
  if (!sourceOperation) return [];

  const sources: ExtractedReadSource[] = [];
  const sourcePattern =
    /\.(?:from|join|innerJoin|leftJoin|rightJoin|fullJoin)\s*\(\s*(?<tableExpression>[A-Za-z_$][\w$]*|[^,)]+)\s*(?:,|\))/g;

  for (const match of source.matchAll(sourcePattern)) {
    const tableExpression = match.groups?.tableExpression?.trim();
    if (!tableExpression) continue;

    sources.push({
      operation: sourceOperation,
      tableExpression,
    });
  }

  return sources;
}

function statementEnd(source: string, start: number): number {
  const end = source.indexOf(';', start);
  return end === -1 ? source.length : end;
}

function extractPredicateSummary(
  statement: string,
  tableIdentifier: string,
  table: JisoTableAnnotation,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): ExtractedPredicateSummary {
  const key = extractParameterizedKey(statement, tableIdentifier, table, tables);
  if (key) return { key };

  return hasNonEqPredicate(statement, tableIdentifier, table) ? { predicate: 'non-eq' } : {};
}

function extractParameterizedKey(
  statement: string,
  tableIdentifier: string,
  table: JisoTableAnnotation,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | undefined {
  if (!table.key) return undefined;

  for (const match of statement.matchAll(
    /eq\s*\(\s*(?<left>[^,]+?)\s*,\s*(?<right>[^)]+?)\s*\)/g,
  )) {
    const left = match.groups?.left?.trim();
    const right = match.groups?.right?.trim();
    if (!left || !right) continue;

    if (left === `${tableIdentifier}.${table.key}`) return argumentKey(right, tables);
    if (right === `${tableIdentifier}.${table.key}`) return argumentKey(left, tables);
  }

  return undefined;
}

function hasNonEqPredicate(
  statement: string,
  tableIdentifier: string,
  table: JisoTableAnnotation,
): boolean {
  if (!table.key) return false;

  const where = /\.where\s*\(\s*(?<predicate>[^;]+?)\s*\)/.exec(statement)?.groups?.predicate;
  if (!where || !where.includes(`${tableIdentifier}.${table.key}`)) return false;
  if (/^eq\s*\(/.test(where)) return false;
  return true;
}

function argumentKey(
  expression: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | undefined {
  const member = /^(?<base>[A-Za-z_$][\w$]*)\.(?<property>[A-Za-z_$][\w$]*)$/.exec(expression);
  if (member?.groups) {
    if ((tables.get(member.groups.base ?? '')?.length ?? 0) > 0) return undefined;
    return member.groups.property ? `arg:${member.groups.property}` : undefined;
  }

  return /^[A-Za-z_$][\w$]*$/.test(expression) ? `arg:${expression}` : undefined;
}

function appendTable<Table>(tables: Map<string, Table[]>, identifier: string, table: Table): void {
  tables.set(identifier, [...(tables.get(identifier) ?? []), table]);
}

function appendTableEntries<Table>(
  tables: Map<string, Table[]>,
  identifier: string,
  entries: readonly Table[],
): void {
  const current = tables.get(identifier) ?? [];
  const next = [...current];
  const keys = new Set(current.map((entry) => JSON.stringify(entry)));

  for (const entry of entries) {
    const key = JSON.stringify(entry);
    if (keys.has(key)) continue;

    keys.add(key);
    next.push(entry);
  }

  tables.set(identifier, next);
}

function splitTopLevelArgs(source: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (char !== ',' || depth !== 0) continue;

    args.push(source.slice(start, index));
    start = index + 1;
  }

  args.push(source.slice(start));
  return args.filter((arg) => arg.trim().length > 0);
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0;

  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function stringArgument(source: string): string | undefined {
  return /\(\s*["'](?<value>[^"']+)["']/.exec(source)?.groups?.value;
}

function stringProperty(source: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*:\\s*["'](?<value>[^"']+)["']`);
  return pattern.exec(source)?.groups?.value;
}

function compareTouchSites(left: TouchSite, right: TouchSite): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.via.localeCompare(right.via) ||
    (left.branch ?? '').localeCompare(right.branch ?? '') ||
    (left.predicate ?? '').localeCompare(right.predicate ?? '') ||
    left.site.localeCompare(right.site)
  );
}

function compareReadSites(left: ReadSite, right: ReadSite): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.via.localeCompare(right.via) ||
    left.source.localeCompare(right.source) ||
    (left.branch ?? '').localeCompare(right.branch ?? '') ||
    (left.predicate ?? '').localeCompare(right.predicate ?? '') ||
    left.site.localeCompare(right.site)
  );
}
