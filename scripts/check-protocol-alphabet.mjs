#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const protocolAlphabetPath = 'formal/replay/protocol-alphabet.json';
export const protocolAlphabetSchema = 'kovo-protocol-alphabet/v1';

export const PROTECTED_PROTOCOL_TABLES = Object.freeze([
  '_kovo_jobs',
  '_kovo_replay',
  '_kovo_replay_reclaimed',
]);
export const MODEL_CTES = Object.freeze([
  'advanced',
  'claimed',
  'deleted',
  'expired',
  'locked_watermark',
]);
export const MODEL_JOB_STATUSES = Object.freeze([
  'cancelled',
  'dead',
  'failed',
  'ready',
  'running',
  'succeeded',
]);
export const MODEL_REPLAY_STATES = Object.freeze(['committed', 'pending']);
export const MODEL_ACTIONS = Object.freeze([
  'jobs.cancelReady',
  'jobs.claimDue',
  'jobs.enqueueDebounce',
  'jobs.enqueueThrottle',
  'jobs.enqueueUnkeyed',
  'jobs.grantWriter',
  'jobs.heartbeat',
  'jobs.markFailed',
  'jobs.markSucceeded',
  'jobs.observe',
  'jobs.probe',
  'jobs.provision',
  'jobs.reapExpiredLeases',
  'replay.abort',
  'replay.auditPrivileges',
  'replay.auditRelation',
  'replay.auditShape',
  'replay.auditTimeless',
  'replay.auditWatermark',
  'replay.auditWatermarkShape',
  'replay.commit',
  'replay.consumeCapability',
  'replay.preflightLegacy',
  'replay.provision',
  'replay.read',
  'replay.reclaimCommitted',
  'replay.releasePending',
  'replay.reserve',
  'replay.settle',
]);

const productionSourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const excludedDirectoryPattern =
  /(?:^|\/)(?:__fixtures__|coverage|dist|fixtures?|generated|node_modules|test|tests)(?:\/|$)/u;
const excludedFilePattern =
  /(?:\.(?:bench|spec|test)\.[^.]+$|(?:^|[.-])test-support(?:[.-]|$)|\.generated\.[^.]+$|\.d\.ts$)/u;
const modelActionSet = new Set(MODEL_ACTIONS);
const protectedTablePatterns = PROTECTED_PROTOCOL_TABLES.map((table) => ({
  pattern: new RegExp(`(?:^|[^A-Za-z0-9_])${table}(?:$|[^A-Za-z0-9_])`, 'u'),
  table,
}));

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function scriptKind(file) {
  if (file.endsWith('.tsx') || file.endsWith('.jsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticPropertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function enclosingOwner(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      if ('name' in current && current.name) return current.name.getText(current.getSourceFile());
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
        return parent.name.getText(current.getSourceFile());
      }
      return '<anonymous>';
    }
  }
  return '<module>';
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

function declarationFunction(node) {
  return enclosingFunction(node);
}

function collectVariableDeclarations(sourceFile) {
  const declarations = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const existing = declarations.get(node.name.text) ?? [];
      existing.push(node);
      declarations.set(node.name.text, existing);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

function resolveVariableDeclaration(identifier, declarations) {
  const candidates = declarations.get(identifier.text) ?? [];
  const useFunction = enclosingFunction(identifier);
  let best;
  for (const candidate of candidates) {
    if (candidate.pos >= identifier.pos) continue;
    const candidateFunction = declarationFunction(candidate);
    if (candidateFunction !== undefined && candidateFunction !== useFunction) continue;
    if (best === undefined || candidate.pos > best.pos) best = candidate;
  }
  return best;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function staticExpressionEvaluator(sourceFile) {
  const declarations = collectVariableDeclarations(sourceFile);
  const importedProtocolConstants = Object.freeze({
    POSTGRES_REPLAY_MAX_ENTRIES: '1000',
    POSTGRES_REPLAY_MAX_RESPONSE_BODY_STORAGE_BYTES: '1398104',
    POSTGRES_REPLAY_MAX_RESPONSE_HEADER_BYTES: '65536',
    POSTGRES_REPLAY_TABLE: '_kovo_replay',
    POSTGRES_REPLAY_WATERMARK_TABLE: '_kovo_replay_reclaimed',
  });

  const evaluate = (source, stack = new Set()) => {
    const node = unwrapExpression(source);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
    if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    if (ts.isTemplateExpression(node)) {
      let output = node.head.text;
      for (const span of node.templateSpans) {
        const value = evaluate(span.expression, stack);
        output += typeof value === 'string' ? value : `\${${span.expression.getText(sourceFile)}}`;
        output += span.literal.text;
      }
      return output;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(node.left, stack);
      const right = evaluate(node.right, stack);
      return typeof left === 'string' && typeof right === 'string' ? left + right : undefined;
    }
    if (ts.isConditionalExpression(node)) {
      const whenTrue = evaluate(node.whenTrue, stack);
      const whenFalse = evaluate(node.whenFalse, stack);
      if (typeof whenTrue === 'string' && typeof whenFalse === 'string') {
        return whenTrue === whenFalse ? whenTrue : `{${whenTrue}|${whenFalse}}`;
      }
      return undefined;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values = [];
      for (const element of node.elements) {
        const value = evaluate(element, stack);
        if (typeof value !== 'string') return undefined;
        values.push(value);
      }
      return values;
    }
    if (ts.isIdentifier(node)) {
      if (Object.hasOwn(importedProtocolConstants, node.text)) {
        return importedProtocolConstants[node.text];
      }
      const declaration = resolveVariableDeclaration(node, declarations);
      if (!declaration?.initializer || stack.has(declaration)) return undefined;
      const nextStack = new Set(stack);
      nextStack.add(declaration);
      return evaluate(declaration.initializer, nextStack);
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const target = evaluate(node.expression, stack);
      const index = evaluate(node.argumentExpression, stack);
      if (Array.isArray(target)) {
        if (typeof index === 'string' && /^\d+$/u.test(index)) return target[Number(index)];
        return `{${target.join('|')}}`;
      }
      return undefined;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name === 'postgresJoin') {
        const values = node.arguments[0] && evaluate(node.arguments[0], stack);
        const separator = node.arguments[1] && evaluate(node.arguments[1], stack);
        return Array.isArray(values) && typeof separator === 'string'
          ? values.join(separator)
          : undefined;
      }
      if (name === 'quoteIdent') {
        const value = node.arguments[0] && evaluate(node.arguments[0], stack);
        return typeof value === 'string' ? quoteIdentifier(value) : undefined;
      }
      if (name === 'quoteQualified') {
        const schema = node.arguments[0] && evaluate(node.arguments[0], stack);
        const table = node.arguments[1] && evaluate(node.arguments[1], stack);
        return typeof schema === 'string' && typeof table === 'string'
          ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
          : undefined;
      }
    }
    return undefined;
  };

  return evaluate;
}

function protectedTables(sql) {
  return protectedTablePatterns
    .filter(({ pattern }) => pattern.test(sql))
    .map(({ table }) => table)
    .sort(asciiCompare);
}

function looksLikeSql(sql) {
  return /^(?:\{[^}]+\}\s*)?(?:ALTER|CREATE|DELETE|DROP|GRANT|INSERT|REVOKE|SELECT|UPDATE|WITH)\b/iu.test(
    sql,
  );
}

function cteNames(sql) {
  const names = new Set();
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s+AS\s+(?:MATERIALIZED\s+)?\(/giu;
  for (const match of sql.matchAll(pattern)) names.add(match[1].toLowerCase());
  return [...names].sort(asciiCompare);
}

function quotedWords(value) {
  const words = [];
  for (const match of value.matchAll(/'([a-z][a-z0-9_-]*)'/giu)) {
    words.push(match[1].toLowerCase());
  }
  return words;
}

function jobStatusLiterals(sql, tables) {
  if (!tables.includes('_kovo_jobs')) return [];
  return [...new Set(quotedWords(sql))].sort(asciiCompare);
}

function replayStateLiterals(sql, tables) {
  if (!tables.includes('_kovo_replay')) return [];
  const states = new Set();
  for (const match of sql.matchAll(/\bstate\s*=\s*'([a-z][a-z0-9_-]*)'/giu)) {
    states.add(match[1].toLowerCase());
  }
  for (const match of sql.matchAll(/\bstate\s+IN\s*\(([^)]*)\)/giu)) {
    for (const value of quotedWords(match[1])) states.add(value);
  }
  const insertPattern =
    /\bINSERT\s+INTO\s+[^\s(]+\s*\(([^)]*)\)\s*SELECT\s+(.+?)(?:\s+FROM\b|\s+WHERE\b|\s+ON\s+CONFLICT\b|$)/giu;
  for (const match of sql.matchAll(insertPattern)) {
    const columns = match[1].split(',').map((column) => column.trim().toLowerCase());
    const values = match[2].split(',').map((value) => value.trim());
    const stateIndex = columns.indexOf('state');
    if (stateIndex === -1 || stateIndex >= values.length) continue;
    for (const value of quotedWords(values[stateIndex])) states.add(value);
  }
  return [...states].sort(asciiCompare);
}

function literalUnionValues(typeNode) {
  const values = [];
  const visit = (node) => {
    if (ts.isUnionTypeNode(node)) {
      for (const type of node.types) visit(type);
      return;
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      values.push(node.literal.text);
    }
  };
  visit(typeNode);
  return values.sort(asciiCompare);
}

function taskQueueProperty(node) {
  if (!ts.isPropertyAssignment(node) || !ts.isObjectLiteralExpression(node.parent))
    return undefined;
  let declaration = node.parent.parent;
  while (
    ts.isAsExpression(declaration) ||
    ts.isSatisfiesExpression(declaration) ||
    ts.isParenthesizedExpression(declaration)
  ) {
    declaration = declaration.parent;
  }
  if (
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== 'taskQueueSql'
  ) {
    return undefined;
  }
  const property = staticPropertyName(node.name);
  return property === undefined ? undefined : `taskQueueSql.${property}`;
}

function directSqlCall(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  if (name === 'safeQuery') return node.arguments[1] && { expression: node.arguments[1], name };
  if (name === 'exec' || name === 'query') {
    return node.arguments[0] && { expression: node.arguments[0], name };
  }
  return undefined;
}

function collectProtocolFile(file, sourceText) {
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const evaluate = staticExpressionEvaluator(sourceFile);
  const candidates = [];
  const staticSqlExpressions = [];
  const statusTypes = {};

  const addCandidate = (node, expression, kind) => {
    const value = evaluate(expression);
    if (typeof value !== 'string') return;
    const sql = normalizeSql(value);
    const tables = protectedTables(sql);
    if (tables.length === 0) return;
    candidates.push({ expression, kind, node, owner: enclosingOwner(node), sql, tables });
  };

  const visit = (node) => {
    if (
      ts.isTypeAliasDeclaration(node) &&
      (node.name.text === 'DurableTaskJobStatus' || node.name.text === 'DurableTaskObservedStatus')
    ) {
      statusTypes[node.name.text] = literalUnionValues(node.type);
    }
    const queueProperty = taskQueueProperty(node);
    if (queueProperty !== undefined) {
      addCandidate(node, node.initializer, queueProperty);
    } else if (ts.isPropertyAssignment(node) && staticPropertyName(node.name) === 'text') {
      addCandidate(node, node.initializer, 'text');
    }
    const call = directSqlCall(node);
    if (call !== undefined) addCandidate(node, call.expression, call.name);
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isBinaryExpression(node) ||
      ts.isConditionalExpression(node) ||
      (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'postgresJoin')
    ) {
      const value = evaluate(node);
      if (typeof value === 'string') {
        const sql = normalizeSql(value);
        const tables = protectedTables(sql);
        if (tables.length > 0 && looksLikeSql(sql)) {
          staticSqlExpressions.push({ expression: node, sql, tables });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const knownExpressionRanges = new Set(
    candidates.map(
      (candidate) =>
        `${candidate.expression.getStart(sourceFile)}:${candidate.expression.getEnd()}`,
    ),
  );
  const maximalStaticExpressions = staticSqlExpressions.filter(
    (candidate) =>
      !staticSqlExpressions.some(
        (other) =>
          other !== candidate &&
          other.expression.getStart(sourceFile) <= candidate.expression.getStart(sourceFile) &&
          other.expression.getEnd() >= candidate.expression.getEnd() &&
          (other.expression.getStart(sourceFile) < candidate.expression.getStart(sourceFile) ||
            other.expression.getEnd() > candidate.expression.getEnd()),
      ),
  );
  for (const candidate of maximalStaticExpressions) {
    const range = `${candidate.expression.getStart(sourceFile)}:${candidate.expression.getEnd()}`;
    if (knownExpressionRanges.has(range)) continue;
    candidates.push({
      expression: candidate.expression,
      kind: 'sqlLiteral',
      node: candidate.expression,
      owner: enclosingOwner(candidate.expression),
      sql: candidate.sql,
      tables: candidate.tables,
    });
  }

  candidates.sort(
    (left, right) => left.node.getStart(sourceFile) - right.node.getStart(sourceFile),
  );
  const ordinals = new Map();
  const statements = candidates.map((candidate) => {
    let suffix = candidate.kind;
    if (!candidate.kind.startsWith('taskQueueSql.')) {
      const key = `${candidate.owner}/${candidate.kind}`;
      const ordinal = (ordinals.get(key) ?? 0) + 1;
      ordinals.set(key, ordinal);
      suffix = `${candidate.kind}[${ordinal}]`;
    }
    const site = `${file}#${candidate.owner}/${suffix}`;
    const ctes = cteNames(candidate.sql);
    const jobStatuses = jobStatusLiterals(candidate.sql, candidate.tables);
    const replayStates = replayStateLiterals(candidate.sql, candidate.tables);
    return {
      ctes,
      file,
      jobStatuses,
      owner: candidate.owner,
      replayStates,
      site,
      sql: candidate.sql,
      sqlSha256: sha256(candidate.sql),
      tables: candidate.tables,
    };
  });

  return { statements, statusTypes };
}

export function collectProtocolAlphabetFromSources(sources) {
  const statements = [];
  const statusTypes = {};
  const entries = Object.entries(sources).sort(([left], [right]) => asciiCompare(left, right));
  for (const [file, source] of entries) {
    const observed = collectProtocolFile(file, source);
    statements.push(...observed.statements);
    Object.assign(statusTypes, observed.statusTypes);
  }
  statements.sort((left, right) => asciiCompare(left.site, right.site));
  // The bounded interleaving model covers live replay/task transitions. Provisioning and posture
  // SQL still map to named actions and exact digests, but their catalog-maintenance CTEs are outside
  // the transition alphabet (Plan 3 §6's Postgres-atomicity boundary).
  const ctes = [
    ...new Set(
      statements
        .filter(
          (statement) =>
            statement.file.endsWith('/postgres-replay.ts') ||
            statement.site.includes('/taskQueueSql.'),
        )
        .flatMap((statement) => statement.ctes),
    ),
  ].sort(asciiCompare);
  const jobStatusLiterals = [
    ...new Set(statements.flatMap((statement) => statement.jobStatuses)),
  ].sort(asciiCompare);
  const replayStates = [...new Set(statements.flatMap((statement) => statement.replayStates))].sort(
    asciiCompare,
  );
  const jobStatuses = [...new Set(Object.values(statusTypes).flatMap((statuses) => statuses))].sort(
    asciiCompare,
  );
  return { ctes, jobStatusLiterals, jobStatuses, replayStates, statements, statusTypes };
}

function productionFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!excludedDirectoryPattern.test(relative)) {
        files.push(...productionFiles(path.join(directory, entry.name), relative));
      }
      continue;
    }
    if (
      entry.isFile() &&
      productionSourceExtensions.has(path.extname(entry.name)) &&
      !excludedFilePattern.test(relative)
    ) {
      files.push(relative);
    }
  }
  return files;
}

export function collectProtocolAlphabetFromRepo(root = repoRoot) {
  const packagesRoot = path.join(root, 'packages');
  const sources = {};
  for (const relative of productionFiles(packagesRoot).sort(asciiCompare)) {
    const file = `packages/${relative}`;
    sources[file] = readFileSync(path.join(root, file), 'utf8');
  }
  return collectProtocolAlphabetFromSources(sources);
}

function inferModelAction(statement) {
  const { file, owner, site } = statement;
  if (site.includes('/taskQueueSql.')) {
    return `jobs.${site.slice(site.lastIndexOf('taskQueueSql.') + 'taskQueueSql.'.length)}`;
  }
  if (file.endsWith('/task-observability.ts')) return 'jobs.observe';
  if (file.endsWith('/task-queue.ts')) {
    if (owner === 'grantDurableTaskWriterRole') return 'jobs.grantWriter';
    if (owner === 'assertDurableTaskStoreReady' || owner === 'checkDurableTaskWriterRole') {
      return 'jobs.probe';
    }
    return 'jobs.provision';
  }
  if (file.endsWith('/postgres-replay.ts')) {
    const actions = {
      abort: 'replay.abort',
      commit: 'replay.commit',
      consume: 'replay.consumeCapability',
      readRow: 'replay.read',
      releasePostgresPendingReplayFromExecutor: 'replay.releasePending',
      reserve: 'replay.reserve',
      retirePostgresCommittedReplay: 'replay.reclaimCommitted',
      settleWithoutReservation: 'replay.settle',
    };
    return actions[owner] ?? 'UNMAPPED';
  }
  if (file.endsWith('/postgres-runtime.ts')) {
    if (owner === 'provisionPostgresFrameworkReplayStore') {
      return statement.sql.includes('timeless_rows')
        ? 'replay.preflightLegacy'
        : 'replay.provision';
    }
    if (owner === 'postgresReplayStorePostureIssues') {
      if (statement.sql.includes('has_table_privilege')) return 'replay.auditPrivileges';
      if (statement.sql.includes('timeless_rows')) return 'replay.auditTimeless';
      if (statement.sql.includes('to_regclass')) {
        return statement.tables.includes('_kovo_replay_reclaimed')
          ? 'replay.auditWatermark'
          : 'replay.auditRelation';
      }
      if (statement.tables.includes('_kovo_replay_reclaimed')) {
        return 'replay.auditWatermarkShape';
      }
      return 'replay.auditShape';
    }
  }
  return 'UNMAPPED';
}

export function renderProtocolAlphabet(observed, actionBySite = {}) {
  const statements = observed.statements.map((statement) => ({
    action: actionBySite[statement.site] ?? inferModelAction(statement),
    ctes: statement.ctes,
    file: statement.file,
    jobStatuses: statement.jobStatuses,
    owner: statement.owner,
    replayStates: statement.replayStates,
    site: statement.site,
    sqlSha256: statement.sqlSha256,
    tables: statement.tables,
  }));
  return {
    schema: protocolAlphabetSchema,
    sourceScope: {
      excluded: ['generated', 'tests'],
      policy: 'kovo-authored-production-package-source/v1',
      root: 'packages',
    },
    tables: [...PROTECTED_PROTOCOL_TABLES],
    constants: {
      ctes: [...MODEL_CTES],
      jobStatuses: [...MODEL_JOB_STATUSES],
      replayStates: [...MODEL_REPLAY_STATES],
    },
    actions: [...MODEL_ACTIONS],
    statusTypes: observed.statusTypes,
    statements,
    summary: {
      actionCount: new Set(statements.map((statement) => statement.action)).size,
      cteCount: observed.ctes.length,
      statementCount: statements.length,
    },
  };
}

function compareStatement(expected, actual, findings) {
  for (const field of ['ctes', 'jobStatuses', 'replayStates', 'tables']) {
    if (!arraysEqual(expected[field], actual[field])) {
      findings.push(`${actual.site} has stale ${field}`);
    }
  }
  for (const field of ['file', 'owner', 'sqlSha256']) {
    if (expected[field] !== actual[field]) findings.push(`${actual.site} has stale ${field}`);
  }
  if (!modelActionSet.has(expected.action)) {
    findings.push(`${actual.site} maps to unknown model action ${String(expected.action)}`);
  }
}

export function validateProtocolAlphabet({ artifact, observed }) {
  const findings = [];
  if (artifact?.schema !== protocolAlphabetSchema) {
    findings.push(`schema must be ${protocolAlphabetSchema}`);
  }
  if (!arraysEqual(artifact?.tables, PROTECTED_PROTOCOL_TABLES)) {
    findings.push('protected protocol tables must match the closed table vocabulary');
  }
  if (!arraysEqual(artifact?.actions, MODEL_ACTIONS)) {
    findings.push('model actions must match the closed action vocabulary');
  }
  if (!arraysEqual(artifact?.constants?.ctes, MODEL_CTES)) {
    findings.push('model CTE constants must match the closed five-CTE vocabulary');
  }
  if (!arraysEqual(artifact?.constants?.jobStatuses, MODEL_JOB_STATUSES)) {
    findings.push('model job status constants must match the closed persisted vocabulary');
  }
  if (!arraysEqual(artifact?.constants?.replayStates, MODEL_REPLAY_STATES)) {
    findings.push('model replay state constants must match the closed persisted vocabulary');
  }

  for (const name of ['DurableTaskJobStatus', 'DurableTaskObservedStatus']) {
    if (!arraysEqual(observed.statusTypes[name], MODEL_JOB_STATUSES)) {
      findings.push(`${name} must equal the model job status constants`);
    }
    if (!arraysEqual(artifact?.statusTypes?.[name], observed.statusTypes[name])) {
      findings.push(`${name} artifact snapshot is stale`);
    }
  }
  const unknownCtes = observed.ctes.filter((cte) => !MODEL_CTES.includes(cte));
  if (unknownCtes.length > 0) {
    findings.push(`observed CTE alphabet has unmodeled member(s): ${unknownCtes.join(', ')}`);
  }
  const unknownJobStatuses = observed.jobStatusLiterals.filter(
    (status) => !MODEL_JOB_STATUSES.includes(status),
  );
  if (unknownJobStatuses.length > 0) {
    findings.push(
      `observed SQL has unmodeled job status literal(s): ${unknownJobStatuses.join(', ')}`,
    );
  }
  const unknownReplayStates = observed.replayStates.filter(
    (state) => !MODEL_REPLAY_STATES.includes(state),
  );
  if (unknownReplayStates.length > 0) {
    findings.push(
      `observed SQL has unmodeled replay state literal(s): ${unknownReplayStates.join(', ')}`,
    );
  }

  const expectedBySite = new Map(
    Array.isArray(artifact?.statements)
      ? artifact.statements.map((statement) => [statement.site, statement])
      : [],
  );
  const actualBySite = new Map(observed.statements.map((statement) => [statement.site, statement]));
  for (const statement of observed.statements) {
    const expected = expectedBySite.get(statement.site);
    if (expected === undefined) {
      findings.push(`unclassified protected SQL statement ${statement.site}`);
      continue;
    }
    compareStatement(expected, statement, findings);
  }
  for (const statement of expectedBySite.values()) {
    if (!actualBySite.has(statement.site)) {
      findings.push(`inventoried protected SQL statement is absent: ${statement.site}`);
    }
  }
  if (artifact?.summary?.statementCount !== observed.statements.length) {
    findings.push('statementCount summary is stale');
  }
  if (artifact?.summary?.cteCount !== observed.ctes.length) {
    findings.push('cteCount summary is stale');
  }
  const observedActionCount = new Set(
    Array.isArray(artifact?.statements)
      ? artifact.statements.map((statement) => statement.action)
      : [],
  ).size;
  if (artifact?.summary?.actionCount !== observedActionCount) {
    findings.push('actionCount summary is stale');
  }
  return { findings, ok: findings.length === 0 };
}

function existingActions(root) {
  try {
    const artifact = JSON.parse(readFileSync(path.join(root, protocolAlphabetPath), 'utf8'));
    return Object.fromEntries(
      (artifact.statements ?? []).map((statement) => [statement.site, statement.action]),
    );
  } catch {
    return {};
  }
}

function main() {
  const observed = collectProtocolAlphabetFromRepo();
  const artifactPath = path.join(repoRoot, protocolAlphabetPath);
  if (process.argv.includes('--write')) {
    const artifact = renderProtocolAlphabet(observed, existingActions(repoRoot));
    const unmapped = artifact.statements.filter((statement) => statement.action === 'UNMAPPED');
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    if (unmapped.length > 0) {
      throw new Error(
        `Wrote ${protocolAlphabetPath} with ${unmapped.length} unmapped statement(s):\n${unmapped
          .map((statement) => `- ${statement.site}`)
          .join('\n')}`,
      );
    }
    console.log(
      `Wrote ${protocolAlphabetPath}: ${artifact.summary.statementCount} statements, ${artifact.summary.actionCount} actions.`,
    );
    return;
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const result = validateProtocolAlphabet({ artifact, observed });
  if (!result.ok) {
    throw new Error(
      `Protocol alphabet gate failed:\n${result.findings.map((finding) => `- ${finding}`).join('\n')}`,
    );
  }
  console.log(
    `Protocol alphabet gate passed: ${artifact.summary.statementCount} protected SQL statements map to ${artifact.summary.actionCount} actions; ${observed.ctes.length}/${MODEL_CTES.length} CTE names and both persisted status alphabets are closed.`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
