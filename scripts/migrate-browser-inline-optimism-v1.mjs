#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const RESULT_SCHEMA = 'kovo-api-migration-result/v1';
const BATCH = 'browser-inline-optimism-v1';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const RETIRED_BY_SPECIFIER = new Map([
  [
    '@kovojs/browser',
    new Set([
      'MutationChangeRecord',
      'OptimisticChange',
      'OptimisticEntry',
      'OptimisticFor',
      'OptimisticPlan',
      'OptimisticQueryKey',
      'OptimisticTransform',
    ]),
  ],
  [
    '@kovojs/server',
    new Set([
      'KeyedQueryOptimisticOptions',
      'QueryOptimisticApply',
      'QueryOptimisticBinding',
      'QueryOptimisticStatus',
    ]),
  ],
]);

export function analyzeBrowserInlineOptimismV1Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const refusals = [];
  const namespaceBindings = new Map();

  for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
    const start = diagnostic.start ?? 0;
    refusals.push({
      category: 'ambiguous-binding',
      end: start + (diagnostic.length ?? 0),
      start,
    });
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      RETIRED_BY_SPECIFIER.has(statement.moduleSpecifier.text)
    ) {
      const retired = RETIRED_BY_SPECIFIER.get(statement.moduleSpecifier.text);
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceBindings.set(bindings.name.text, retired);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          const imported = specifier.propertyName?.text ?? specifier.name.text;
          if (retired.has(imported)) {
            refusals.push(anchorRefusal('app-context', specifier, sourceFile));
          }
        }
      }
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      RETIRED_BY_SPECIFIER.has(statement.moduleSpecifier.text)
    ) {
      const retired = RETIRED_BY_SPECIFIER.get(statement.moduleSpecifier.text);
      if (!statement.exportClause) {
        refusals.push(anchorRefusal('app-context', statement, sourceFile));
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          const imported = specifier.propertyName?.text ?? specifier.name.text;
          if (retired.has(imported)) {
            refusals.push(anchorRefusal('app-context', specifier, sourceFile));
          }
        }
      }
    }
  }

  const visit = (node) => {
    if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      namespaceBindings.get(node.left.text)?.has(node.right.text)
    ) {
      refusals.push(anchorRefusal('app-context', node.right, sourceFile));
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaceBindings.get(node.expression.text)?.has(node.name.text)
    ) {
      refusals.push(anchorRefusal('app-context', node.name, sourceFile));
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      namespaceBindings.get(node.expression.text)?.has(node.argumentExpression.text)
    ) {
      refusals.push(anchorRefusal('app-context', node.argumentExpression, sourceFile));
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && RETIRED_BY_SPECIFIER.has(argument.text),
      )
    ) {
      refusals.push(anchorRefusal('dynamic-import', node, sourceFile));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && RETIRED_BY_SPECIFIER.has(argument.text),
      )
    ) {
      refusals.push(anchorRefusal('dynamic-import', node, sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  refusals.sort((left, right) => left.start - right.start || left.end - right.end);
  return refusals.length === 0
    ? { source, status: 'unchanged', refusals: [] }
    : { source, status: 'refused', refusals };
}

function anchorRefusal(category, node, sourceFile) {
  return {
    category,
    end: node.end,
    start: node.getStart(sourceFile),
  };
}

export function runBrowserInlineOptimismV1Migration({
  cwd = process.cwd(),
  mode,
  sourcePaths = [],
}) {
  if (mode !== 'check' && mode !== 'write') {
    throw new TypeError('mode must be "check" or "write"');
  }
  const root = resolve(cwd);
  const files = discoverFiles(root, sourcePaths);
  const results = [];
  const summary = { rewritten: 0, unchanged: 0, refused: 0 };

  for (const file of files) {
    const before = lstatSync(file.absolutePath);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(`${file.path} must remain a regular, non-symlink source file`);
    }
    const source = readFileSync(file.absolutePath, 'utf8');
    const analysis = analyzeBrowserInlineOptimismV1Migration({
      fileName: file.path,
      source,
    });
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
    } else {
      summary.unchanged += 1;
      results.push({ path: file.path, state: 'unchanged' });
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

function main(args) {
  const [modeArg, ...sourcePaths] = args;
  if (modeArg !== '--check' && modeArg !== '--write') {
    process.stderr.write(
      'usage: node scripts/migrate-browser-inline-optimism-v1.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runBrowserInlineOptimismV1Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-browser-inline-optimism-v1: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
