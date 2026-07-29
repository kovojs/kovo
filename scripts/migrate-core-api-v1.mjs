#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as ts from 'typescript';

const RESULT_SCHEMA = 'kovo-api-migration-result/v1';
const BATCH = 'core-task-topology-v1';
const CORE_ROOT = '@kovojs/core';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);

const MOVED_SYMBOLS = new Map();
registerMoved('@kovojs/core/diagnostics', [
  'DiagnosticCode',
  'DiagnosticSeverity',
  'RegisteredDiagnostic',
]);
registerMoved('@kovojs/core/security', [
  'DeclassifyDoorId',
  'DeclassifyOwnerScope',
  'DeclassifyPolicy',
  'DeclassifyPolicyOptions',
  'DeclassifyPurpose',
  'DeclassifyPurposeFor',
  'DeclareOffWireOptions',
  'PublishToClientOptions',
  'Redacted',
  'RedactedOptions',
  'RedactedValue',
  'Secret',
  'SecretValue',
  'TrustedRevealValue',
  'Untrusted',
  'UntrustedValue',
  'declareOffWire',
  'isRedacted',
  'isSecret',
  'isUntrusted',
  'publishToClient',
  'redacted',
  'revealRedacted',
  'revealSecret',
  'revealUntrusted',
  'secret',
  'trustedReveal',
  'untrusted',
]);
registerMoved('@kovojs/core/storage', [
  'FileSystemStorageOptions',
  'MemoryStorageOptions',
  'S3CompatibleObjectClient',
  'S3CompatibleStorageOptions',
  'StorageBody',
  'StorageCapability',
  'StorageDeleteCapability',
  'StorageGetResult',
  'StorageObjectInfo',
  'StoragePutCapability',
  'StoragePutOptions',
  'StoragePutResult',
  'StorageReadCapability',
  'StorageStreamResult',
  'createFileSystemStorage',
  'createMemoryStorage',
  'createS3CompatibleStorage',
]);
registerMoved('@kovojs/core/webhooks', [
  'CustomWebhookVerifier',
  'HmacMultiSignature',
  'HmacSecret',
  'HmacSignatureEncoding',
  'HmacSignatureOptions',
  'HmacSignaturePayload',
  'HmacSignaturePayloadContext',
  'HmacSignatureTolerance',
  'HmacSignatureVerifier',
  'StandardWebhooksOptions',
  'WebhookHeaderValue',
  'WebhookHeaders',
  'WebhookPayload',
  'WebhookVerificationRequest',
  'WebhookVerifier',
  'customVerifier',
  'hmacSignature',
  'standardWebhooks',
]);

const INTERNALIZED_SYMBOLS = new Set([
  'AnyFunction',
  'CheckedComponentDefinition',
  'CheckedComponentPropsMetadata',
  'CheckedComponentQueryBindings',
  'ComponentCallArgs',
  'ComponentCallSiteAttributes',
  'ComponentPropMetadataType',
  'ComponentPropMetadataValue',
  'ComponentQueryBindingProps',
  'ComponentQueryKeys',
  'ComponentRenderInput',
  'ComponentRenderSlots',
  'ExactProps',
  'HmacSignatureInspectionConfig',
  'InvalidationSets',
  'IsAny',
  'MutationRegistry',
  'OptimisticDerivationSets',
  'QueryArgsBinding',
  'QueryRegistry',
  'RequiredKeys',
  'ResolvedHmacSignatureConfig',
  'RouteRegistry',
  'S3CompatibleDeleteObjectInput',
  'S3CompatibleGetObjectInput',
  'S3CompatibleGetObjectOutput',
  'S3CompatibleHeadObjectInput',
  'S3CompatibleListObjectsInput',
  'S3CompatibleListObjectsOutput',
  'S3CompatibleListedObject',
  'S3CompatibleObjectMetadata',
  'S3CompatiblePutObjectInput',
  'S3CompatiblePutObjectOutput',
  'SecretRevealAuditFact',
  'drainSecretRevealAuditFacts',
]);

function registerMoved(specifier, symbols) {
  for (const symbol of symbols) MOVED_SYMBOLS.set(symbol, specifier);
}

/**
 * Conservatively split direct named root imports and re-exports by task. Namespace, default,
 * dynamic, wildcard, and retired implementation-carrier uses are refused because rewriting them
 * would require binding or application intent that syntax alone cannot prove.
 */
export function analyzeCoreApiV1Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const edits = [];
  const refusals = [];
  const parseDiagnostics = sourceFile.parseDiagnostics;

  for (const diagnostic of parseDiagnostics ?? []) {
    const start = diagnostic.start ?? 0;
    refusals.push({
      category: 'ambiguous-binding',
      end: start + (diagnostic.length ?? 0),
      reason: 'The source does not parse cleanly, so binding-aware API edits cannot be proven.',
      start,
    });
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === CORE_ROOT
    ) {
      analyzeImportDeclaration(statement, sourceFile, source, edits, refusals);
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === CORE_ROOT
    ) {
      analyzeExportDeclaration(statement, sourceFile, source, edits, refusals);
      continue;
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      statement.moduleReference.expression.text === CORE_ROOT
    ) {
      refusals.push(dynamicRefusal(statement, sourceFile, 'CommonJS-style import'));
    }
  }

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some((argument) => ts.isStringLiteral(argument) && argument.text === CORE_ROOT)
    ) {
      refusals.push(dynamicRefusal(node, sourceFile, 'dynamic import'));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.some((argument) => ts.isStringLiteral(argument) && argument.text === CORE_ROOT)
    ) {
      refusals.push(dynamicRefusal(node, sourceFile, 'CommonJS require'));
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      node.argument.literal.text === CORE_ROOT
    ) {
      refusals.push(dynamicRefusal(node, sourceFile, 'import type query'));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (refusals.length > 0) {
    return {
      refusals: uniqueRefusals(refusals),
      source,
      status: 'refused',
    };
  }
  const stableEdits = uniqueEdits(edits);
  if (stableEdits.length === 0) return { source, status: 'unchanged' };
  return {
    edits: stableEdits,
    source: applyEdits(source, stableEdits),
    status: 'rewritten',
  };
}

function analyzeImportDeclaration(node, sourceFile, source, edits, refusals) {
  if (node.attributes || node.assertClause) {
    refusals.push({
      category: 'ambiguous-binding',
      end: node.getEnd(),
      reason:
        'An attributed core import may carry loader semantics that a split rewrite cannot preserve.',
      start: node.getStart(sourceFile),
    });
    return;
  }
  const clause = node.importClause;
  if (!clause) return;
  if (clause.name) {
    refusals.push({
      category: 'ambiguous-binding',
      end: clause.name.getEnd(),
      reason: 'The core root has no mechanical default-import split across task entrypoints.',
      start: clause.name.getStart(sourceFile),
    });
  }
  if (!clause.namedBindings) return;
  if (ts.isNamespaceImport(clause.namedBindings)) {
    refusals.push({
      category: 'ambiguous-binding',
      end: clause.namedBindings.getEnd(),
      reason:
        'A core namespace may read moved or internalized members dynamically, so it cannot be split safely.',
      start: clause.namedBindings.getStart(sourceFile),
    });
    return;
  }

  const groups = groupNamedSpecifiers(clause.namedBindings.elements, sourceFile, source, refusals);
  if (!groups.changed || refusals.length > 0) return;
  const quote = quoteFor(node.moduleSpecifier, source);
  const statements = [];
  for (const [specifier, members] of groups.byModule) {
    const prefix = clause.isTypeOnly ? 'import type' : 'import';
    statements.push(`${prefix} { ${members.join(', ')} } from ${quote}${specifier}${quote};`);
  }
  edits.push({
    end: node.getEnd(),
    replacement: statements.join('\n'),
    start: node.getStart(sourceFile),
  });
}

function analyzeExportDeclaration(node, sourceFile, source, edits, refusals) {
  if (
    node.attributes ||
    node.assertClause ||
    !node.exportClause ||
    !ts.isNamedExports(node.exportClause)
  ) {
    refusals.push({
      category: 'ambiguous-binding',
      end: node.getEnd(),
      reason:
        'A wildcard, namespace, or attributed core re-export cannot be split without changing downstream bindings.',
      start: node.getStart(sourceFile),
    });
    return;
  }
  const groups = groupNamedSpecifiers(node.exportClause.elements, sourceFile, source, refusals);
  if (!groups.changed || refusals.length > 0) return;
  const quote = quoteFor(node.moduleSpecifier, source);
  const statements = [];
  for (const [specifier, members] of groups.byModule) {
    const prefix = node.isTypeOnly ? 'export type' : 'export';
    statements.push(`${prefix} { ${members.join(', ')} } from ${quote}${specifier}${quote};`);
  }
  edits.push({
    end: node.getEnd(),
    replacement: statements.join('\n'),
    start: node.getStart(sourceFile),
  });
}

function groupNamedSpecifiers(elements, sourceFile, source, refusals) {
  const byModule = new Map();
  let changed = false;
  for (const element of elements) {
    const exported = element.propertyName?.text ?? element.name.text;
    if (INTERNALIZED_SYMBOLS.has(exported)) {
      refusals.push({
        category: 'app-context',
        end: element.getEnd(),
        reason: `${exported} was an inferred or implementation-inspection carrier with no supported public replacement.`,
        start: element.getStart(sourceFile),
      });
      continue;
    }
    const target = MOVED_SYMBOLS.get(exported) ?? CORE_ROOT;
    if (target !== CORE_ROOT) changed = true;
    let members = byModule.get(target);
    if (!members) {
      members = [];
      byModule.set(target, members);
    }
    members.push(source.slice(element.getStart(sourceFile), element.getEnd()));
  }
  return { byModule, changed };
}

function dynamicRefusal(node, sourceFile, spelling) {
  return {
    category: 'dynamic-import',
    end: node.getEnd(),
    reason: `A ${spelling} has namespace semantics that cannot be proven safe across task entrypoints.`,
    start: node.getStart(sourceFile),
  };
}

function quoteFor(moduleSpecifier, source) {
  return source[moduleSpecifier.getStart()] === '"' ? '"' : "'";
}

function scriptKind(fileName) {
  switch (extname(fileName).toLowerCase()) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.tsx':
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function uniqueEdits(edits) {
  const unique = new Map();
  for (const edit of edits) unique.set(`${edit.start}:${edit.end}:${edit.replacement}`, edit);
  const ordered = [...unique.values()].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      throw new Error('core API migration produced overlapping edits');
    }
  }
  return ordered;
}

function uniqueRefusals(refusals) {
  const unique = new Map();
  for (const refusal of refusals) {
    unique.set(`${refusal.category}:${refusal.start}:${refusal.end}`, refusal);
  }
  return [...unique.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function applyEdits(source, edits) {
  let result = source;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index];
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
  }
  return result;
}

export function runCoreApiV1Migration({ cwd = process.cwd(), mode, sourcePaths = [] }) {
  if (mode !== 'check' && mode !== 'write') {
    throw new TypeError('mode must be "check" or "write"');
  }
  const root = resolve(cwd);
  const files = discoverFiles(root, sourcePaths);
  const results = [];
  const summary = { rewritten: 0, unchanged: 0, refused: 0 };
  const prepared = [];

  for (const file of files) {
    const before = lstatSync(file.absolutePath);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(`${file.path} must remain a regular, non-symlink source file`);
    }
    const source = readFileSync(file.absolutePath, 'utf8');
    const analysis = analyzeCoreApiV1Migration({ fileName: file.path, source });
    prepared.push({ analysis, before, file, source });
    if (analysis.status === 'refused') {
      summary.refused += 1;
      results.push({
        path: file.path,
        state: 'refused',
        refusals: analysis.refusals.map((entry) => ({
          category: entry.category,
          anchor: {
            start: Buffer.byteLength(source.slice(0, entry.start), 'utf8'),
            end: Buffer.byteLength(source.slice(0, entry.end), 'utf8'),
          },
        })),
      });
      continue;
    }
    if (analysis.status === 'rewritten') {
      summary.rewritten += 1;
      results.push({ path: file.path, state: 'rewritten' });
      continue;
    }
    summary.unchanged += 1;
    results.push({ path: file.path, state: 'unchanged' });
  }

  // Refusals are batch-wide: never leave an application half migrated.
  if (mode === 'write' && summary.refused === 0) {
    for (const entry of prepared) {
      if (entry.analysis.status !== 'rewritten') continue;
      replaceRegularFile(
        entry.file.absolutePath,
        entry.analysis.source,
        entry.source,
        entry.before,
      );
    }
  }

  return {
    schema: RESULT_SCHEMA,
    batch: BATCH,
    mode,
    files: results,
    summary,
  };
}

function discoverFiles(root, sourcePaths) {
  const inputs = sourcePaths.length === 0 ? ['.'] : sourcePaths;
  const files = new Map();
  for (const input of inputs) {
    const absolutePath = resolve(root, input);
    const path = relativeInsideRoot(root, absolutePath, input);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`${input} must not be a symlink`);
    if (stat.isFile()) {
      addFile(files, absolutePath, path);
    } else if (stat.isDirectory()) {
      collectDirectory(files, root, absolutePath);
    } else {
      throw new Error(`${input} must be a source file or directory`);
    }
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function collectDirectory(files, root, directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectDirectory(files, root, absolutePath);
      continue;
    }
    if (entry.isFile()) {
      addFile(files, absolutePath, relativeInsideRoot(root, absolutePath, entry.name));
    }
  }
}

function addFile(files, absolutePath, nativePath) {
  if (!SOURCE_EXTENSIONS.has(extname(nativePath).toLowerCase())) return;
  const path = nativePath.split(sep).join('/');
  files.set(path, { absolutePath, path });
}

function relativeInsideRoot(root, absolutePath, input) {
  const nativePath = relative(root, absolutePath);
  if (nativePath === '..' || nativePath.startsWith(`..${sep}`) || isAbsolute(nativePath)) {
    throw new Error(`${input} resolves outside the invocation root`);
  }
  return nativePath || '.';
}

function replaceRegularFile(path, source, expectedSource, before) {
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${path} must remain a regular, non-symlink source file`);
  }
  const tempPath = resolve(
    dirname(path),
    `.${basename(path)}.kovo-core-api-v1-${String(process.pid)}-${Date.now().toString(36)}`,
  );
  let descriptor;
  try {
    descriptor = openSync(tempPath, 'wx', 0o600);
    writeFileSync(descriptor, source, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(tempPath, before.mode & 0o777);
    const current = lstatSync(path);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      readFileSync(path, 'utf8') !== expectedSource
    ) {
      throw new Error(`${path} changed while the migration was preparing its rewrite`);
    }
    renameSync(tempPath, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(tempPath, { force: true });
  }
}

function main(args) {
  const [modeArg, ...sourcePaths] = args;
  if (modeArg !== '--check' && modeArg !== '--write') {
    process.stderr.write(
      'usage: node scripts/migrate-core-api-v1.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runCoreApiV1Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 || (result.mode === 'check' && result.summary.rewritten > 0)
      ? 1
      : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-core-api-v1: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
