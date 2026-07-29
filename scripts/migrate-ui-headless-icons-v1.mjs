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
const BATCH = 'ui-headless-icons-v1';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const INTERNAL_HEADLESS_HELPERS = new Map([
  ['@kovojs/headless-ui/accordion', new Set(['accordionItemOpen'])],
  [
    '@kovojs/headless-ui/autocomplete',
    new Set([
      'autocompleteOptionHighlighted',
      'autocompleteOptionSelected',
      'autocompleteSuggestions',
    ]),
  ],
  ['@kovojs/headless-ui/avatar', new Set(['avatarImageState'])],
  ['@kovojs/headless-ui/checkbox-group', new Set(['checkboxGroupItemChecked'])],
  [
    '@kovojs/headless-ui/combobox',
    new Set(['comboboxFilteredItems', 'comboboxOptionHighlighted', 'comboboxOptionSelected']),
  ],
  [
    '@kovojs/headless-ui/command',
    new Set(['commandFilteredItems', 'commandItemHighlighted', 'commandItemSelected']),
  ],
  [
    '@kovojs/headless-ui/context-menu',
    new Set(['contextMenuFocusElement', 'contextMenuItemHighlighted']),
  ],
  [
    '@kovojs/headless-ui/dropdown-menu',
    new Set(['dropdownMenuFocusElement', 'dropdownMenuItemHighlighted']),
  ],
  [
    '@kovojs/headless-ui/menubar',
    new Set(['menubarFocusElement', 'menubarItemHighlighted', 'menubarItemOpen']),
  ],
  ['@kovojs/headless-ui/meter', new Set(['meterValueState'])],
  [
    '@kovojs/headless-ui/navigation-menu',
    new Set([
      'navigationMenuFocusElement',
      'navigationMenuItemHighlighted',
      'navigationMenuItemOpen',
    ]),
  ],
  [
    '@kovojs/headless-ui/otp-field',
    new Set(['otpFieldComplete', 'otpFieldSlotValue', 'otpFieldValueFromString']),
  ],
  ['@kovojs/headless-ui/progress', new Set(['progressValueState'])],
  ['@kovojs/headless-ui/radio-group', new Set(['radioGroupItemChecked', 'radioGroupMoveValue'])],
  [
    '@kovojs/headless-ui/scroll-area',
    new Set([
      'scrollAreaCornerState',
      'scrollAreaScrollbarState',
      'scrollAreaThumbGeometry',
      'scrollAreaViewportState',
    ]),
  ],
  ['@kovojs/headless-ui/select', new Set(['selectItemSelected'])],
  ['@kovojs/headless-ui/slider', new Set(['sliderValueState'])],
  ['@kovojs/headless-ui/tabs', new Set(['tabsItemSelected'])],
  ['@kovojs/headless-ui/toggle-group', new Set(['toggleGroupItemPressed'])],
  ['@kovojs/headless-ui/toolbar', new Set(['toolbarRovingIndex'])],
]);

export function analyzeUiHeadlessIconsV1Migration({ fileName, source }) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  const refusals = [];
  const canonicalRenderBindings = [];
  let lastImportEnd = 0;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    lastImportEnd = statement.end;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === '@kovojs/ui') {
      refusals.push({
        category: 'ambiguous-binding',
        start: statement.moduleSpecifier.getStart(sourceFile),
        end: statement.moduleSpecifier.end,
      });
      continue;
    }

    const namedImports = statement.importClause?.namedBindings;
    if (!namedImports || !ts.isNamedImports(namedImports)) continue;

    const internalHelpers = INTERNAL_HEADLESS_HELPERS.get(specifier);
    if (internalHelpers !== undefined) {
      for (const element of namedImports.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (!internalHelpers.has(importedName)) continue;
        refusals.push({
          category: 'app-context',
          start: element.getStart(sourceFile),
          end: element.end,
        });
      }
      continue;
    }

    if (specifier !== '@kovojs/icons') continue;
    const retired = namedImports.elements.filter(
      (element) => (element.propertyName?.text ?? element.name.text) === 'IconRenderResult',
    );
    if (retired.length === 0) continue;
    for (const element of retired) canonicalRenderBindings.push(element.name.text);
    edits.push({
      start: statement.getStart(sourceFile),
      end: statement.end,
      text: rewrittenIconsImport(statement, namedImports, retired, sourceFile),
    });
  }

  if (refusals.length > 0) {
    return { source, status: 'refused', refusals };
  }
  if (canonicalRenderBindings.length === 0) {
    return { source, status: 'unchanged', refusals: [] };
  }

  const bindings = [...new Set(canonicalRenderBindings)]
    .sort((left, right) => left.localeCompare(right))
    .map((localName) =>
      localName === 'ComponentRenderResult'
        ? 'ComponentRenderResult'
        : `ComponentRenderResult as ${localName}`,
    );
  edits.push({
    start: lastImportEnd,
    end: lastImportEnd,
    text: `\nimport type { ${bindings.join(', ')} } from '@kovojs/core';`,
  });
  return {
    source: applyTextEdits(source, edits),
    status: 'rewritten',
    refusals: [],
  };
}

function rewrittenIconsImport(statement, namedImports, retired, sourceFile) {
  const retiredSet = new Set(retired);
  const kept = namedImports.elements.filter((element) => !retiredSet.has(element));
  const defaultName = statement.importClause?.name?.text;
  if (kept.length === 0 && defaultName === undefined) return '';

  const bindings = [];
  if (defaultName !== undefined) bindings.push(defaultName);
  if (kept.length > 0) {
    bindings.push(`{ ${kept.map((element) => element.getText(sourceFile)).join(', ')} }`);
  }
  return `${statement.importClause?.isTypeOnly === true ? 'import type' : 'import'} ${bindings.join(
    ', ',
  )} from ${statement.moduleSpecifier.getText(sourceFile)};`;
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

export function runUiHeadlessIconsV1Migration({ cwd = process.cwd(), mode, sourcePaths = [] }) {
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
    const analysis = analyzeUiHeadlessIconsV1Migration({ fileName: file.path, source });
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
    `.${basename(path)}.kovo-ui-api-v1-${String(process.pid)}-${Date.now().toString(36)}`,
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
      'usage: node scripts/migrate-ui-headless-icons-v1.mjs --check|--write [source-or-directory ...]\n',
    );
    return 2;
  }
  try {
    const result = runUiHeadlessIconsV1Migration({
      mode: modeArg === '--check' ? 'check' : 'write',
      sourcePaths,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.summary.refused > 0 || (result.mode === 'check' && result.summary.rewritten > 0)
      ? 1
      : 0;
  } catch (error) {
    process.stderr.write(
      `migrate-ui-headless-icons-v1: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
