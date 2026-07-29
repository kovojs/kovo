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
import ts from 'typescript';

const RESULT_SCHEMA = 'kovo-api-migration-result/v1';
const BATCH = 'browser-authoring-v1';
const BROWSER_SPECIFIER = '@kovojs/browser';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);

export function analyzeBrowserAuthoringV1Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  const refusals = [];
  const directBindings = new Map();
  const namespaces = new Set();

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
      statement.moduleSpecifier.text === BROWSER_SPECIFIER
    ) {
      const clause = statement.importClause;
      if (clause?.name) refusals.push(anchorRefusal('ambiguous-binding', clause.name, sourceFile));
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          const imported = specifier.propertyName?.text ?? specifier.name.text;
          if (imported === 'TrustedOutputMetadataInput') {
            refusals.push(anchorRefusal('app-context', specifier, sourceFile));
          } else if (
            imported === 'derive' ||
            imported === 'trustedHtml' ||
            imported === 'trustedUrl'
          ) {
            directBindings.set(specifier.name.text, imported);
          }
        }
      }
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === BROWSER_SPECIFIER &&
      (!statement.exportClause ||
        (ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.some(
            (element) =>
              (element.propertyName?.text ?? element.name.text) === 'TrustedOutputMetadataInput',
          )))
    ) {
      refusals.push(anchorRefusal('app-context', statement, sourceFile));
    }
  }

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === BROWSER_SPECIFIER,
      )
    ) {
      refusals.push(anchorRefusal('dynamic-import', node, sourceFile));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === BROWSER_SPECIFIER,
      )
    ) {
      refusals.push(anchorRefusal('dynamic-import', node, sourceFile));
    }

    if (ts.isCallExpression(node)) {
      const api = browserAuthoringCallIdentity(node.expression, directBindings, namespaces);
      if (api === 'trustedHtml' || api === 'trustedUrl') {
        analyzeTrustedOutputCall(node, sourceFile, edits, refusals);
      } else if (api === 'derive') {
        analyzeDeriveCall(node, sourceFile, refusals);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  refusals.sort((left, right) => left.start - right.start || left.end - right.end);
  if (refusals.length > 0) return { source, status: 'refused', refusals };
  if (edits.length === 0) return { source, status: 'unchanged', refusals: [] };
  return { source: applyTextEdits(source, edits), status: 'rewritten', refusals: [] };
}

function browserAuthoringCallIdentity(expression, directBindings, namespaces) {
  if (ts.isIdentifier(expression)) return directBindings.get(expression.text);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    namespaces.has(expression.expression.text) &&
    (expression.name.text === 'derive' ||
      expression.name.text === 'trustedHtml' ||
      expression.name.text === 'trustedUrl')
  ) {
    return expression.name.text;
  }
  return undefined;
}

function analyzeTrustedOutputCall(call, sourceFile, edits, refusals) {
  if (call.arguments.length !== 2) {
    refusals.push(anchorRefusal('trust-decision', call, sourceFile));
    return;
  }
  const metadata = unwrap(call.arguments[1]);
  if (ts.isStringLiteralLike(metadata) || ts.isNoSubstitutionTemplateLiteral(metadata)) {
    if (metadata.text.trim() === '' || metadata.text.trim() !== metadata.text) {
      refusals.push(anchorRefusal('trust-decision', metadata, sourceFile));
      return;
    }
    edits.push({
      end: metadata.end,
      start: metadata.getStart(sourceFile),
      text: `{ reason: ${sourceFile.text.slice(metadata.getStart(sourceFile), metadata.end)} }`,
    });
    return;
  }
  if (!isExactStaticMetadata(metadata)) {
    refusals.push(anchorRefusal('trust-decision', metadata, sourceFile));
  }
}

function isExactStaticMetadata(node) {
  if (!ts.isObjectLiteralExpression(node)) return false;
  let reason = false;
  let source = false;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = propertyName(property.name);
    if (name !== 'reason' && name !== 'source') return false;
    const value = unwrap(property.initializer);
    if (
      (!ts.isStringLiteralLike(value) && !ts.isNoSubstitutionTemplateLiteral(value)) ||
      value.text.trim() === '' ||
      value.text.trim() !== value.text
    ) {
      return false;
    }
    if (name === 'reason') {
      if (reason) return false;
      reason = true;
    } else {
      if (source) return false;
      source = true;
    }
  }
  return reason;
}

function analyzeDeriveCall(call, sourceFile, refusals) {
  if (call.arguments.length !== 2) {
    refusals.push(anchorRefusal('ambiguous-binding', call, sourceFile));
    return;
  }
  const inputs = unwrap(call.arguments[0]);
  if (ts.isArrayLiteralExpression(inputs)) {
    for (const element of inputs.elements) {
      if (
        ts.isSpreadElement(element) ||
        ts.isStringLiteralLike(unwrap(element)) ||
        ts.isNoSubstitutionTemplateLiteral(unwrap(element))
      ) {
        refusals.push(anchorRefusal('app-context', element, sourceFile));
      }
    }
    return;
  }
  if (ts.isObjectLiteralExpression(inputs)) {
    for (const property of inputs.properties) {
      if (!ts.isPropertyAssignment(property)) {
        refusals.push(anchorRefusal('ambiguous-binding', property, sourceFile));
        continue;
      }
      const value = unwrap(property.initializer);
      if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        refusals.push(anchorRefusal('app-context', property, sourceFile));
      }
    }
    return;
  }
  refusals.push(anchorRefusal('ambiguous-binding', inputs, sourceFile));
}

function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function anchorRefusal(category, node, sourceFile) {
  return {
    category,
    end: node.end,
    start: node.getStart(sourceFile),
  };
}

function applyTextEdits(source, edits) {
  let output = source;
  for (const edit of edits.sort(
    (left, right) => right.start - left.start || right.end - left.end,
  )) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  return output;
}

export function runBrowserAuthoringV1Migration({ cwd = process.cwd(), mode, sourcePaths = [] }) {
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
    const analysis = analyzeBrowserAuthoringV1Migration({ fileName: file.path, source });
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
    } else if (analysis.status === 'rewritten') {
      summary.rewritten += 1;
      results.push({ path: file.path, state: 'rewritten' });
    } else {
      summary.unchanged += 1;
      results.push({ path: file.path, state: 'unchanged' });
    }
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
  return { schema: RESULT_SCHEMA, batch: BATCH, mode, files: results, summary };
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
  const tempPath = resolve(
    dirname(path),
    `.${basename(path)}.kovo-browser-authoring-v1-${String(process.pid)}-${Date.now().toString(36)}`,
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
      'usage: node scripts/migrate-browser-authoring-v1.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runBrowserAuthoringV1Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 || (result.mode === 'check' && result.summary.rewritten > 0)
      ? 1
      : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-browser-authoring-v1: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
