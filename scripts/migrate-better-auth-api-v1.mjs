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
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const RESULT_SCHEMA = 'kovo-api-migration-result/v1';
const BATCH = 'better-auth-generated-assembly-v1';
const BETTER_AUTH_ROOT = '@kovojs/better-auth';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const scriptRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationLedger = JSON.parse(
  readFileSync(resolve(scriptRepoRoot, 'api-migrations.json'), 'utf8'),
);
const batch = migrationLedger.batches.find((entry) => entry.id === BATCH);
if (!batch) throw new Error(`${BATCH} is missing from api-migrations.json`);
const RULES = new Map(batch.rules.map((rule) => [rule.from.symbol, rule]));

/**
 * Split direct named Better Auth root imports and re-exports across the human and generated
 * entrypoints. Namespace-like access and the retired credential mutation carrier fail closed:
 * syntax alone cannot prove the generated backend or application-local replacement.
 */
export function analyzeBetterAuthApiV1Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const edits = [];
  const refusals = [];

  for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
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
      statement.moduleSpecifier.text === BETTER_AUTH_ROOT
    ) {
      analyzeImport(statement, sourceFile, source, edits, refusals);
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === BETTER_AUTH_ROOT
    ) {
      analyzeExport(statement, sourceFile, source, edits, refusals);
      continue;
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      statement.moduleReference.expression.text === BETTER_AUTH_ROOT
    ) {
      refusals.push(dynamicRefusal(statement, sourceFile, 'CommonJS-style import'));
    }
  }

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === BETTER_AUTH_ROOT,
      )
    ) {
      refusals.push(dynamicRefusal(node, sourceFile, 'dynamic import'));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === BETTER_AUTH_ROOT,
      )
    ) {
      refusals.push(dynamicRefusal(node, sourceFile, 'CommonJS require'));
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      node.argument.literal.text === BETTER_AUTH_ROOT
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

function analyzeImport(node, sourceFile, source, edits, refusals) {
  if (node.attributes || node.assertClause) {
    refusals.push(
      refusal(
        'ambiguous-binding',
        node,
        sourceFile,
        'An attributed Better Auth import may carry loader semantics that a split rewrite cannot preserve.',
      ),
    );
    return;
  }
  const clause = node.importClause;
  if (!clause) return;
  if (clause.name) {
    refusals.push(
      refusal(
        'ambiguous-binding',
        clause.name,
        sourceFile,
        'The Better Auth root has no mechanical default-import split across generated backends.',
      ),
    );
  }
  if (!clause.namedBindings) return;
  if (ts.isNamespaceImport(clause.namedBindings)) {
    refusals.push(
      refusal(
        'ambiguous-binding',
        clause.namedBindings,
        sourceFile,
        'A Better Auth namespace may read generated backend members dynamically and cannot be split safely.',
      ),
    );
    return;
  }
  const groups = groupSpecifiers(clause.namedBindings.elements, sourceFile, source, refusals);
  if (!groups.changed || refusals.length > 0) return;
  const quote = quoteFor(node.moduleSpecifier, source);
  const statements = [];
  for (const [specifier, members] of groups.byModule) {
    statements.push(
      `${clause.isTypeOnly ? 'import type' : 'import'} { ${members.join(', ')} } from ${quote}${specifier}${quote};`,
    );
  }
  edits.push({
    end: node.getEnd(),
    replacement: statements.join('\n'),
    start: node.getStart(sourceFile),
  });
}

function analyzeExport(node, sourceFile, source, edits, refusals) {
  if (
    node.attributes ||
    node.assertClause ||
    !node.exportClause ||
    !ts.isNamedExports(node.exportClause)
  ) {
    refusals.push(
      refusal(
        'ambiguous-binding',
        node,
        sourceFile,
        'A wildcard, namespace, or attributed Better Auth re-export cannot be split without changing downstream bindings.',
      ),
    );
    return;
  }
  const groups = groupSpecifiers(node.exportClause.elements, sourceFile, source, refusals);
  if (!groups.changed || refusals.length > 0) return;
  const quote = quoteFor(node.moduleSpecifier, source);
  const statements = [];
  for (const [specifier, members] of groups.byModule) {
    statements.push(
      `${node.isTypeOnly ? 'export type' : 'export'} { ${members.join(', ')} } from ${quote}${specifier}${quote};`,
    );
  }
  edits.push({
    end: node.getEnd(),
    replacement: statements.join('\n'),
    start: node.getStart(sourceFile),
  });
}

function groupSpecifiers(elements, sourceFile, source, refusals) {
  const byModule = new Map();
  let changed = false;
  for (const element of elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    const rule = RULES.get(imported);
    if (rule?.action === 'refuse') {
      refusals.push(
        refusal(
          rule.category,
          element,
          sourceFile,
          rule.reason ?? `${imported} has no mechanical public replacement.`,
        ),
      );
      continue;
    }
    const target = rule?.action === 'rewrite' ? rule.to.specifier : BETTER_AUTH_ROOT;
    const targetSymbol = rule?.action === 'rewrite' ? (rule.to.symbol ?? imported) : imported;
    if (target !== BETTER_AUTH_ROOT || targetSymbol !== imported) changed = true;
    const members = byModule.get(target) ?? [];
    members.push(
      targetSymbol === imported
        ? source.slice(element.getStart(sourceFile), element.getEnd())
        : renamedSpecifier(element, targetSymbol),
    );
    byModule.set(target, members);
  }
  return { byModule, changed };
}

function renamedSpecifier(element, targetSymbol) {
  const localName = element.name.text;
  return `${element.isTypeOnly ? 'type ' : ''}${targetSymbol}${
    localName === targetSymbol ? '' : ` as ${localName}`
  }`;
}

function refusal(category, node, sourceFile, reason) {
  return {
    category,
    end: node.getEnd(),
    reason,
    start: node.getStart(sourceFile),
  };
}

function dynamicRefusal(node, sourceFile, spelling) {
  return refusal(
    'dynamic-import',
    node,
    sourceFile,
    `A ${spelling} has namespace semantics that cannot be proven safe across generated entrypoints.`,
  );
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
      throw new Error('Better Auth API migration produced overlapping edits');
    }
  }
  return ordered;
}

function uniqueRefusals(refusals) {
  const unique = new Map();
  for (const entry of refusals) {
    unique.set(`${entry.category}:${entry.start}:${entry.end}`, entry);
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

export function runBetterAuthApiV1Migration({ cwd = process.cwd(), mode, sourcePaths = [] }) {
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
    const analysis = analyzeBetterAuthApiV1Migration({ fileName: file.path, source });
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
    const nativePath = relativeInsideRoot(root, absolutePath, input);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`${input} must not be a symlink`);
    if (stat.isFile()) addFile(files, absolutePath, nativePath);
    else if (stat.isDirectory()) collectDirectory(files, root, absolutePath);
    else throw new Error(`${input} must be a source file or directory`);
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
    } else if (entry.isFile()) {
      addFile(files, absolutePath, relativeInsideRoot(root, absolutePath, entry.name));
    }
  }
}

function addFile(files, absolutePath, nativePath) {
  if (!SOURCE_EXTENSIONS.has(extname(nativePath).toLowerCase())) return;
  const normalizedPath = nativePath.split(sep).join('/');
  files.set(normalizedPath, { absolutePath, path: normalizedPath });
}

function relativeInsideRoot(root, absolutePath, input) {
  const nativePath = relative(root, absolutePath);
  if (nativePath === '..' || nativePath.startsWith(`..${sep}`) || isAbsolute(nativePath)) {
    throw new Error(`${input} resolves outside the invocation root`);
  }
  return nativePath || '.';
}

function replaceRegularFile(filePath, source, expectedSource, before) {
  const tempPath = resolve(
    dirname(filePath),
    `.${basename(filePath)}.kovo-better-auth-api-v1-${String(process.pid)}-${Date.now().toString(36)}`,
  );
  let descriptor;
  try {
    descriptor = openSync(tempPath, 'wx', 0o600);
    writeFileSync(descriptor, source, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(tempPath, before.mode & 0o777);
    const current = lstatSync(filePath);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      readFileSync(filePath, 'utf8') !== expectedSource
    ) {
      throw new Error(`${filePath} changed while the migration was preparing its rewrite`);
    }
    renameSync(tempPath, filePath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(tempPath, { force: true });
  }
}

function main(args) {
  const [modeArg, ...sourcePaths] = args;
  if (modeArg !== '--check' && modeArg !== '--write') {
    process.stderr.write(
      'usage: node scripts/migrate-better-auth-api-v1.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runBetterAuthApiV1Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 || (result.mode === 'check' && result.summary.rewritten > 0)
      ? 1
      : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-better-auth-api-v1: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
