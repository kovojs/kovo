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
const BATCH = 'browser-client-installer-v1';
const CLIENT_SPECIFIER = '@kovojs/browser/client';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const RETIRED = new Set([
  'BrowserEnhancedMutationOptions',
  'BrowserKovoRoot',
  'CreateBrowserKovoRootOptions',
  'EnhancedMutationFetch',
  'EnhancedMutationFetchOptions',
  'EnhancedMutationResponseLike',
  'KovoLoader',
  'KovoLoaderOptions',
  'QueryIdentity',
  'QuerySnapshot',
  'QueryStore',
  'QueryUpdatePlan',
  'UploadProgress',
  'createBrowserKovoRoot',
  'createQueryStore',
  'defaultEnhancedFetch',
  'installKovoLoader',
]);
const FORWARDABLE_OPTIONS = new Set(['importModule', 'onError', 'root']);

export function analyzeBrowserClientInstallerV1Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  const refusals = [];
  const bindings = new Map();
  const allowedBindingUses = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== CLIENT_SPECIFIER
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name) {
      refusals.push(anchorRefusal('ambiguous-binding', clause.name, sourceFile));
    }
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      refusals.push(anchorRefusal('ambiguous-binding', named, sourceFile));
      continue;
    }
    if (!named || !ts.isNamedImports(named)) continue;

    for (const element of named.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (!RETIRED.has(importedName)) continue;
      if (importedName !== 'installKovoLoader') {
        refusals.push(
          anchorRefusal(
            importedName === 'defaultEnhancedFetch' ? 'trust-decision' : 'app-context',
            element,
            sourceFile,
          ),
        );
        continue;
      }
      if (clause?.isTypeOnly === true || element.isTypeOnly) {
        refusals.push(anchorRefusal('app-context', element, sourceFile));
        continue;
      }

      const localName = element.name.text;
      bindings.set(localName, { calls: 0, element });
      allowedBindingUses.add(element.name.getStart(sourceFile));
      if (element.propertyName) {
        allowedBindingUses.add(element.propertyName.getStart(sourceFile));
        edits.push({
          start: element.propertyName.getStart(sourceFile),
          end: element.propertyName.end,
          text: 'installKovoClient',
        });
      } else {
        edits.push({
          start: element.name.getStart(sourceFile),
          end: element.name.end,
          text: 'installKovoClient',
        });
      }
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = bindings.get(node.expression.text);
      if (binding) {
        binding.calls += 1;
        allowedBindingUses.add(node.expression.getStart(sourceFile));
        analyzeInstallCall(node, binding, sourceFile, edits, refusals);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const [localName, binding] of bindings) {
    if (binding.calls === 0) {
      refusals.push(anchorRefusal('app-context', binding.element, sourceFile));
      continue;
    }
    function findUnexpectedUse(node) {
      if (
        ts.isIdentifier(node) &&
        node.text === localName &&
        !allowedBindingUses.has(node.getStart(sourceFile))
      ) {
        refusals.push(anchorRefusal('app-context', node, sourceFile));
      }
      ts.forEachChild(node, findUnexpectedUse);
    }
    findUnexpectedUse(sourceFile);
  }

  refusals.sort((left, right) => left.start - right.start || left.end - right.end);
  if (refusals.length > 0) return { source, status: 'refused', refusals };
  if (edits.length === 0) return { source, status: 'unchanged', refusals: [] };
  return { source: applyTextEdits(source, edits), status: 'rewritten', refusals: [] };
}

function analyzeInstallCall(call, binding, sourceFile, edits, refusals) {
  if (!ts.isExpressionStatement(call.parent)) {
    refusals.push(anchorRefusal('app-context', call, sourceFile));
    return;
  }
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    refusals.push(anchorRefusal('app-context', call, sourceFile));
    return;
  }
  const options = call.arguments[0];
  const seen = new Set();
  for (const property of options.properties) {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property) &&
      !ts.isMethodDeclaration(property)
    ) {
      refusals.push(anchorRefusal('app-context', property, sourceFile));
      continue;
    }
    const name = propertyName(property.name);
    if (!name || seen.has(name)) {
      refusals.push(anchorRefusal('app-context', property, sourceFile));
      continue;
    }
    seen.add(name);
    if (!FORWARDABLE_OPTIONS.has(name)) {
      refusals.push(
        anchorRefusal(
          name === 'allowedClientModuleUrls' ? 'dynamic-import' : 'app-context',
          property,
          sourceFile,
        ),
      );
    }
  }
  if (!seen.has('root')) {
    refusals.push(anchorRefusal('app-context', options, sourceFile));
  }
  if (!binding.element.propertyName) {
    edits.push({
      start: call.expression.getStart(sourceFile),
      end: call.expression.end,
      text: 'installKovoClient',
    });
  }
}

function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function anchorRefusal(category, node, sourceFile) {
  return {
    category,
    start: node.getStart(sourceFile),
    end: node.end,
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

export function runBrowserClientInstallerV1Migration({
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
  const prepared = [];

  for (const file of files) {
    const before = lstatSync(file.absolutePath);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(`${file.path} must remain a regular, non-symlink source file`);
    }
    const source = readFileSync(file.absolutePath, 'utf8');
    const analysis = analyzeBrowserClientInstallerV1Migration({
      fileName: file.path,
      source,
    });
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

  // A refusal makes the whole write atomic: never leave an app half-migrated.
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
    `.${basename(path)}.kovo-browser-client-v1-${String(process.pid)}-${Date.now().toString(36)}`,
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
      'usage: node scripts/migrate-browser-client-installer-v1.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runBrowserClientInstallerV1Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 || (result.mode === 'check' && result.summary.rewritten > 0)
      ? 1
      : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-browser-client-installer-v1: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
