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
const BATCH = 'drizzle-typed-annotations-v1';
const DRIZZLE_ROOT = '@kovojs/drizzle';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const RETIRED_RUNTIME_METADATA = new Set([
  'extractKovoRuntimeDbMetadata',
  'KovoRuntimeDbColumnSource',
  'KovoRuntimeDbMetadata',
  'KovoRuntimeDbTable',
  'KovoRuntimeKeySource',
  'KovoRuntimeOwnerSource',
  'KovoRuntimeOwnerViaSource',
]);
const RETIRED_RUNTIME_SQL_SEMANTICS = new Set(['KovoRuntimeAuthorizationClassification']);
const COLUMN_FIELDS = new Set([
  'atomic',
  'confidentialAtRest',
  'governed',
  'key',
  'owner',
  'secret',
  'version',
]);

export function analyzeDrizzleApiV1Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const edits = [];
  const refusals = [];
  const kovoBindings = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== DRIZZLE_ROOT
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name) refusals.push(refusal('ambiguous-binding', clause.name, sourceFile));
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (
        [...RETIRED_RUNTIME_SQL_SEMANTICS].some((name) =>
          source.includes(`${bindings.name.text}.${name}`),
        )
      ) {
        refusals.push(refusal('sql-semantics', bindings, sourceFile));
      }
      if (
        RETIRED_RUNTIME_METADATA.size > 0 &&
        [...RETIRED_RUNTIME_METADATA].some((name) =>
          source.includes(`${bindings.name.text}.${name}`),
        )
      ) {
        refusals.push(refusal('app-context', bindings, sourceFile));
      }
      continue;
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === 'kovo') kovoBindings.add(element.name.text);
      if (RETIRED_RUNTIME_SQL_SEMANTICS.has(imported)) {
        refusals.push(refusal('sql-semantics', element, sourceFile));
      } else if (RETIRED_RUNTIME_METADATA.has(imported)) {
        refusals.push(refusal('app-context', element, sourceFile));
      }
    }
  }

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      kovoBindings.has(node.expression.text)
    ) {
      analyzeKovoCall(node, sourceFile, edits, refusals);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === DRIZZLE_ROOT,
      )
    ) {
      refusals.push(refusal('dynamic-import', node, sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const stableRefusals = uniqueRefusals(refusals);
  if (stableRefusals.length > 0) {
    return { refusals: stableRefusals, source, status: 'refused' };
  }
  if (edits.length === 0) return { refusals: [], source, status: 'unchanged' };
  return { refusals: [], source: applyEdits(source, edits), status: 'rewritten' };
}

function analyzeKovoCall(call, sourceFile, edits, refusals) {
  if (call.arguments.length !== 1) {
    refusals.push(refusal('app-context', call, sourceFile));
    return;
  }
  const annotation = unwrapped(call.arguments[0]);
  if (ts.isArrowFunction(annotation) || ts.isFunctionExpression(annotation)) return;
  if (!ts.isObjectLiteralExpression(annotation)) {
    refusals.push(refusal('app-context', annotation, sourceFile));
    return;
  }

  const parameter = unusedParameterName(annotation, 'columns');
  edits.push({
    start: annotation.getStart(sourceFile),
    end: annotation.getStart(sourceFile),
    text: `(${parameter}) => (`,
  });
  edits.push({ start: annotation.end, end: annotation.end, text: ')' });

  for (const property of annotation.properties) {
    if (ts.isSpreadAssignment(property)) {
      refusals.push(refusal('app-context', property, sourceFile));
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) {
      refusals.push(refusal('ambiguous-binding', property.name, sourceFile));
      continue;
    }
    if (COLUMN_FIELDS.has(name)) {
      analyzeColumnValue(
        property.initializer,
        parameter,
        sourceFile,
        edits,
        refusals,
        name === 'key',
      );
      continue;
    }
    if (name === 'fans') {
      analyzeFans(property.initializer, parameter, sourceFile, edits, refusals);
      continue;
    }
    if (name === 'ownerVia') {
      analyzeOwnerVia(property.initializer, parameter, sourceFile, edits, refusals);
    }
  }
}

function analyzeColumnValue(node, root, sourceFile, edits, refusals, isKey = false) {
  const value = unwrapped(node);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return;
  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) {
        refusals.push(refusal('app-context', element, sourceFile));
      } else {
        analyzeColumnValue(element, root, sourceFile, edits, refusals, isKey);
      }
    }
    return;
  }
  const name = legacyColumnName(value);
  if (!name) {
    refusals.push(refusal('app-context', value, sourceFile));
    return;
  }
  if (isKey && name.includes(',')) {
    const names = name.split(',');
    if (
      names.length < 2 ||
      names.some(
        (column) => column.length === 0 || !ts.isIdentifierText(column, ts.ScriptTarget.Latest),
      )
    ) {
      refusals.push(refusal('app-context', value, sourceFile));
      return;
    }
    edits.push({
      start: value.getStart(sourceFile),
      end: value.end,
      text: `[${names.map((column) => `${root}.${column}`).join(', ')}]`,
    });
    return;
  }
  if (!ts.isIdentifierText(name, ts.ScriptTarget.Latest)) {
    refusals.push(refusal('app-context', value, sourceFile));
    return;
  }
  edits.push({ start: value.getStart(sourceFile), end: value.end, text: `${root}.${name}` });
}

function analyzeFans(node, root, sourceFile, edits, refusals) {
  const value = unwrapped(node);
  if (!ts.isArrayLiteralExpression(value)) {
    refusals.push(refusal('app-context', value, sourceFile));
    return;
  }
  for (const element of value.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      refusals.push(refusal('app-context', element, sourceFile));
      continue;
    }
    const via = objectProperty(element, 'via');
    if (!via) {
      refusals.push(refusal('app-context', element, sourceFile));
      continue;
    }
    analyzeColumnValue(via.initializer, root, sourceFile, edits, refusals);
  }
}

function analyzeOwnerVia(node, root, sourceFile, edits, refusals) {
  const value = unwrapped(node);
  if (!ts.isObjectLiteralExpression(value)) {
    refusals.push(refusal('app-context', value, sourceFile));
    return;
  }
  const fk = objectProperty(value, 'fk');
  const parent = objectProperty(value, 'parent');
  const parentKey = objectProperty(value, 'parentKey');
  if (!fk || !parent || !parentKey) {
    refusals.push(refusal('app-context', value, sourceFile));
    return;
  }
  const parentExpression = unwrapped(parent.initializer);
  if (!ts.isIdentifier(parentExpression) && !ts.isPropertyAccessExpression(parentExpression)) {
    refusals.push(refusal('app-context', parentExpression, sourceFile));
    return;
  }
  analyzeColumnValue(fk.initializer, root, sourceFile, edits, refusals);
  analyzeColumnValue(
    parentKey.initializer,
    parentExpression.getText(sourceFile),
    sourceFile,
    edits,
    refusals,
  );
}

function legacyColumnName(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  if (node.parameters.length !== 1 || !ts.isIdentifier(node.parameters[0]?.name)) return undefined;
  let body = node.body;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return undefined;
    body = body.statements[0].expression;
    if (!body) return undefined;
  }
  body = unwrapped(body);
  if (
    ts.isPropertyAccessExpression(body) &&
    ts.isIdentifier(body.expression) &&
    body.expression.text === node.parameters[0].name.text
  ) {
    return body.name.text;
  }
  if (
    ts.isElementAccessExpression(body) &&
    ts.isIdentifier(body.expression) &&
    body.expression.text === node.parameters[0].name.text &&
    body.argumentExpression &&
    ts.isStringLiteral(body.argumentExpression)
  ) {
    return body.argumentExpression.text;
  }
  return undefined;
}

function objectProperty(object, name) {
  return object.properties.find(
    (property) => ts.isPropertyAssignment(property) && propertyName(property.name) === name,
  );
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function unwrapped(node) {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return unwrapped(node.expression);
  }
  return node;
}

function unusedParameterName(scope, preferred) {
  const identifiers = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(scope);
  if (!identifiers.has(preferred)) return preferred;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${preferred}${String(index)}`;
    if (!identifiers.has(candidate)) return candidate;
  }
  throw new Error('could not allocate a collision-free annotation parameter');
}

function refusal(category, node, sourceFile) {
  return { category, start: node.getStart(sourceFile), end: node.end };
}

function uniqueRefusals(refusals) {
  const seen = new Set();
  return refusals
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .filter((entry) => {
      const key = `${entry.category}:${String(entry.start)}:${String(entry.end)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function applyEdits(source, edits) {
  let output = source;
  for (const edit of edits.sort(
    (left, right) => right.start - left.start || right.end - left.end,
  )) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  return output;
}

function scriptKind(fileName) {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function runDrizzleApiV1Migration({ cwd = process.cwd(), mode, sourcePaths = [] }) {
  if (mode !== 'check' && mode !== 'write') throw new TypeError('mode must be "check" or "write"');
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
    const analysis = analyzeDrizzleApiV1Migration({ fileName: file.path, source });
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
    `.${basename(path)}.kovo-drizzle-api-v1-${String(process.pid)}-${Date.now().toString(36)}`,
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
      'usage: node scripts/migrate-drizzle-api-v1.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runDrizzleApiV1Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 || (result.mode === 'check' && result.summary.rewritten > 0)
      ? 1
      : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-drizzle-api-v1: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
