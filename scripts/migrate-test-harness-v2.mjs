#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const RESULT_SCHEMA = 'kovo-api-migration-result/v1';
const BATCH = 'test-harness-v2';
const HARNESS_SPECIFIER = '@kovojs/test/harness';
const TEST_CASE_SPECIFIER = '@kovojs/test/test-case';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const RETIRED_HARNESS_SYMBOLS = new Map([
  ['HarnessPageFixture', 'deployment-posture'],
  ['KovoTestReadSite', 'app-context'],
  ['KovoTestTouchGraph', 'app-context'],
  ['KovoTestTouchGraphEntry', 'app-context'],
  ['KovoTestTouchSite', 'app-context'],
  ['KovoTestUnresolvedWriteSite', 'app-context'],
]);

/**
 * Refuse harness v1 syntax that needs app-owned choices.
 *
 * There is intentionally no source rewrite in this batch. Syntax alone cannot select the imported
 * opaque app, successful proof artifact, absolute project root, or separately bootstrapped HTTP
 * origin required by SPEC §12. A guessed rewrite would recreate caller-authored proof authority.
 */
export function analyzeTestHarnessV2Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const refusals = [];
  const harnessBindings = new Map();
  const allowedHarnessBindingUses = new Set();

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
      isOwnedSpecifier(statement.moduleSpecifier.text)
    ) {
      analyzeImport(
        statement,
        statement.moduleSpecifier.text,
        sourceFile,
        refusals,
        harnessBindings,
        allowedHarnessBindingUses,
      );
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isOwnedSpecifier(statement.moduleSpecifier.text)
    ) {
      analyzeExport(statement, statement.moduleSpecifier.text, sourceFile, refusals);
      continue;
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      isOwnedSpecifier(statement.moduleReference.expression.text)
    ) {
      refusals.push(refusal('ambiguous-binding', statement, sourceFile));
    }
  }

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      harnessBindings.has(node.expression.text)
    ) {
      harnessBindings.get(node.expression.text).calls += 1;
      allowedHarnessBindingUses.add(node.expression.getStart(sourceFile));
      if (node.arguments.length !== 2) {
        refusals.push(refusal('app-context', node, sourceFile));
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && isOwnedSpecifier(argument.text),
      )
    ) {
      refusals.push(refusal('dynamic-import', node, sourceFile));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && isOwnedSpecifier(argument.text),
      )
    ) {
      refusals.push(refusal('dynamic-import', node, sourceFile));
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      isOwnedSpecifier(node.argument.literal.text)
    ) {
      refusals.push(refusal('dynamic-import', node, sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const [localName, binding] of harnessBindings) {
    function findUnexpectedUse(node) {
      if (
        ts.isIdentifier(node) &&
        node.text === localName &&
        !allowedHarnessBindingUses.has(node.getStart(sourceFile))
      ) {
        refusals.push(refusal('app-context', node, sourceFile));
      }
      ts.forEachChild(node, findUnexpectedUse);
    }
    findUnexpectedUse(sourceFile);
    if (binding.calls === 0) {
      // A retained but passed-through factory still needs a human to audit its now-async,
      // app-scoped call sites.
      refusals.push(refusal('app-context', binding.element, sourceFile));
    }
  }

  const stableRefusals = uniqueRefusals(refusals);
  return stableRefusals.length === 0
    ? { refusals: [], source, status: 'unchanged' }
    : { refusals: stableRefusals, source, status: 'refused' };
}

function analyzeImport(
  node,
  specifier,
  sourceFile,
  refusals,
  harnessBindings,
  allowedHarnessBindingUses,
) {
  if (node.attributes || node.assertClause) {
    refusals.push(refusal('ambiguous-binding', node, sourceFile));
    return;
  }
  const clause = node.importClause;
  if (!clause) {
    if (specifier === TEST_CASE_SPECIFIER) {
      refusals.push(refusal('ambiguous-binding', node, sourceFile));
    }
    return;
  }
  if (clause.name) refusals.push(refusal('ambiguous-binding', clause.name, sourceFile));
  const bindings = clause.namedBindings;
  if (!bindings) return;
  if (ts.isNamespaceImport(bindings)) {
    refusals.push(refusal('ambiguous-binding', bindings, sourceFile));
    return;
  }
  for (const element of bindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    if (specifier === TEST_CASE_SPECIFIER) {
      refusals.push(refusal('app-context', element, sourceFile));
      continue;
    }
    const retiredCategory = RETIRED_HARNESS_SYMBOLS.get(imported);
    if (retiredCategory) {
      refusals.push(refusal(retiredCategory, element, sourceFile));
      continue;
    }
    if (imported !== 'createKovoTestHarness') continue;
    if (clause.isTypeOnly || element.isTypeOnly) {
      refusals.push(refusal('app-context', element, sourceFile));
      continue;
    }
    const localName = element.name.text;
    harnessBindings.set(localName, { calls: 0, element });
    allowedHarnessBindingUses.add(element.name.getStart(sourceFile));
    if (element.propertyName) {
      allowedHarnessBindingUses.add(element.propertyName.getStart(sourceFile));
    }
  }
}

function analyzeExport(node, specifier, sourceFile, refusals) {
  if (
    node.attributes ||
    node.assertClause ||
    !node.exportClause ||
    !ts.isNamedExports(node.exportClause)
  ) {
    refusals.push(refusal('ambiguous-binding', node, sourceFile));
    return;
  }
  for (const element of node.exportClause.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    if (specifier === TEST_CASE_SPECIFIER) {
      refusals.push(refusal('app-context', element, sourceFile));
      continue;
    }
    const retiredCategory = RETIRED_HARNESS_SYMBOLS.get(imported);
    if (retiredCategory) refusals.push(refusal(retiredCategory, element, sourceFile));
  }
}

function isOwnedSpecifier(value) {
  return value === HARNESS_SPECIFIER || value === TEST_CASE_SPECIFIER;
}

function refusal(category, node, sourceFile) {
  return {
    category,
    end: node.getEnd(),
    start: node.getStart(sourceFile),
  };
}

function uniqueRefusals(refusals) {
  const unique = new Map();
  for (const entry of refusals) {
    unique.set(`${entry.category}:${String(entry.start)}:${String(entry.end)}`, entry);
  }
  return [...unique.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function scriptKind(fileName) {
  if (/\.[cm]?tsx$/u.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.[cm]?jsx$/u.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function runTestHarnessV2Migration({ cwd = process.cwd(), mode, sourcePaths = [] }) {
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
    const analysis = analyzeTestHarnessV2Migration({ fileName: file.path, source });
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

function main(args) {
  const [modeArg, ...sourcePaths] = args;
  if (modeArg !== '--check' && modeArg !== '--write') {
    process.stderr.write(
      'usage: node scripts/migrate-test-harness-v2.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runTestHarnessV2Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-test-harness-v2: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
