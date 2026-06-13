import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import ts from 'typescript';

import { minifyInlineJavaScriptSource } from './inline-js-minifier.ts';

const inlineJisoLoaderModulePath = fileURLToPath(new URL('./inline-loader.ts', import.meta.url));
const inlineResponseApplySourcePath = fileURLToPath(
  new URL('./inline-response-apply.ts', import.meta.url),
);
const wireParserSourcePath = fileURLToPath(new URL('./wire-parser.ts', import.meta.url));
const inlineResponseApplyRootFunctionNames = ['applyInlineMutationResponseBody'] as const;
const inlineWireParserRootFunctionNames = ['readInlineMutationResponseBodyChunks'] as const;

export const inlineJisoLoaderGzipByteBudget = 4096;

export const inlineWireParserReadableSource = readInlineWireParserReadableSource();
export const inlineResponseApplyReadableSource = readInlineResponseApplyReadableSource();

export const inlineJisoLoaderInstallerReadableSource =
  buildInlineJisoLoaderInstallerReadableSource();

export function buildInlineJisoLoaderInstallerReadableSource(
  wireParserReadableSource = inlineWireParserReadableSource,
  responseApplyReadableSource = inlineResponseApplyReadableSource,
): string {
  return String.raw`
/* SPEC.md §4.4: this is the always-loaded bootstrap source. */
function installInlineJisoLoader(importModule) {
  const events = ['click', 'submit', 'input', 'change'];
  const doc = document;
  let idemCounter = 0;
  const createInlineIdem = () =>
    crypto.randomUUID?.() ??
    'idem_' + Date.now().toString(36) + '_' + (idemCounter += 1).toString(36);
  const readStateHost = (element) => element.closest?.('[fw-state]') ?? element;
  const readState = (element) => {
    try {
      return JSON.parse(readStateHost(element)?.getAttribute('fw-state') ?? '{}');
    } catch {
      return {};
    }
  };
  const readDeps = (value) =>
    (value ?? '')
      .split(/[\s,]+/)
      .map((dep) => dep.trim())
      .filter(Boolean);
  const readTargets = () => [
    ...new Set(
      [...doc.querySelectorAll('[fw-deps]')]
        .map((element) => {
          const deps = readDeps(element.getAttribute('fw-deps'));
          const target = element.getAttribute('fw-fragment-target') ?? element.id;
          return target && (deps.length > 0 ? target + '=' + deps.join(' ') : target);
        })
        .filter(Boolean)
    )
  ];
  const findFragmentTarget = (target) =>
    doc.getElementById(target) ?? doc.querySelector('[fw-fragment-target="' + target + '"]');
  ${wireParserReadableSource}
  ${responseApplyReadableSource}
  const dispatchQuery = (query) => {
    dispatchEvent(
      new CustomEvent('jiso:query', {
        detail: {
          attrs: query.attrs,
          content: query.content
        },
      }),
    );
  };
  const applyResponseBody = (body) => {
    applyInlineMutationResponseBody(body, {
      dispatchQuery,
      findFragmentTarget,
      readBody: readInlineMutationResponseBodyChunks,
    });
  };
  const fallbackSubmit = (form) => {
    if (typeof form.submit === 'function') {
      form.submit();
      return;
    }
    form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
    form.setAttribute?.('fw-error', '');
  };
  const hasAttribute = (form, name) => form.getAttribute?.(name) != null;
  const isEnhancedForm = (form) =>
    hasAttribute(form, 'enhance') ||
    hasAttribute(form, 'data-enhance') ||
    hasAttribute(form, 'data-mutation');
  const submitEnhancedForm = (event, form) => {
    event.preventDefault();
    fetch(form.action, {
      body: new FormData(form),
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': createInlineIdem(),
        'FW-Targets': readTargets().join('; '),
      },
      keepalive: true,
      method: (form.method || 'post').toUpperCase(),
    })
      .then((response) => response.text())
      .then(applyResponseBody)
      .catch(() => fallbackSubmit(form));
  };
  const readParamTypes = (element) =>
    (element.getAttribute('fw-param-types') || '').split(/[\s,]+/).reduce((types, entry) => {
      const [name, type] = entry.split(':');
      if (name) types[name] = type;
      return types;
    }, {},);
  const dispatch = async (event) => {
    if (event.type === 'submit') {
      const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]',);
      if (form && isEnhancedForm(form)) {
        submitEnhancedForm(event, form);
        return;
      }
    }
    const element = event.target?.closest?.('[on\\:' + event.type + ']');
    const refs = element?.getAttribute('on:' + event.type);
    if (!element || !refs) return;
    const params = {};
    const paramTypes = readParamTypes(element);
    const state = readState(element);
    const stateHost = readStateHost(element);
    const context = { params, state, signal: new AbortController().signal };
    for (const attribute of element.attributes || []) {
      if (!attribute.name.startsWith('data-p-')) continue;
      const name = attribute.name
        .slice('data-p-'.length)
        .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
      const type = paramTypes[name];
      const value = attribute.value;
      params[name] = type === 'number' ? Number(value) : type === 'boolean' ? value === 'true' : value;
    }
    for (const ref of refs.split(/\s+/).filter(Boolean)) {
      const hashIndex = ref.lastIndexOf('#');
      if (hashIndex <= 0 || hashIndex === ref.length - 1) throw Error('Invalid handler reference: ' + ref);
      const mod = await importModule(ref.slice(0, hashIndex));
      const fn = mod[ref.slice(hashIndex + 1)];
      if (typeof fn !== 'function') throw Error('Handler export not found: ' + ref);
      await fn(event, context);
    }
    stateHost?.setAttribute?.('fw-state', JSON.stringify(state));
  };
  const trigger = (type, target) => {
    void dispatch({ target, type });
  };
  for (const event of events) addEventListener(event, dispatch, { capture: true });
  doc.querySelectorAll('[on\\:load]').forEach((element) => trigger('load', element));
  doc
    .querySelectorAll('[on\\:idle]')
    .forEach((element) => (globalThis.requestIdleCallback || setTimeout)(() => trigger('idle', element)),);
  if (globalThis.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        trigger('visible', entry.target);
      }),
    );
    doc.querySelectorAll('[on\\:visible]').forEach((element) => observer.observe(element));
  }
}
`;
}

export function buildInlineJisoLoaderInstallerSource(
  source = inlineJisoLoaderInstallerReadableSource,
): string {
  assertDefaultInlineJisoLoaderInstallerWireParserParity(source);
  assertDefaultInlineJisoLoaderInstallerResponseApplyParity(source);
  const installerSource = minifyInlineJavaScriptSource(source);
  assertDefaultMinifiedInlineJisoLoaderInstallerWireParserParity(source, installerSource);
  assertDefaultMinifiedInlineJisoLoaderInstallerResponseApplyParity(source, installerSource);
  return installerSource;
}

export interface EmitInlineJisoLoaderModuleOptions {
  check?: boolean;
  source?: string;
  targetPath?: string;
}

export interface EmitInlineJisoLoaderModuleResult {
  changed: boolean;
  source: string;
  targetPath: string;
}

export function buildInlineJisoLoaderModuleSource(
  source = inlineJisoLoaderInstallerReadableSource,
): string {
  const installerSource = buildInlineJisoLoaderInstallerSource(source);
  assertInlineJisoLoaderGzipBudget(installerSource, 'Generated inline Jiso loader module');

  const moduleSource = `${[
    '// @ts-nocheck',
    '// Generated from the SPEC.md §4.4 readable inline bootstrap by inline-loader-build.ts.',
    "import type { ImportHandlerModule } from './handlers.js';",
    '',
    'export type InlineImportHandlerModule = ImportHandlerModule;',
    '',
    '// SPEC.md §4.4 keeps the always-loaded loader under a 4KB gzip budget; this',
    '// literal is the pre-minified bootstrap shipped in document shells.',
    `export const inlineJisoLoaderInstallerSource = ${inlineJavaScriptTemplateLiteral(
      installerSource,
    )};`,
    '',
    '// prettier-ignore',
    'const inlineJisoLoaderInstaller = (',
    `  ${installerSource}`,
    ') as (',
    '    importModule: InlineImportHandlerModule,',
    '  ) => void;',
    '',
    'export function installInlineJisoLoader(importModule: InlineImportHandlerModule): void {',
    '  inlineJisoLoaderInstaller(importModule);',
    '}',
    '',
    'export function createInlineJisoLoaderSource(',
    "  importModuleExpression = '(url)=>import(url)',",
    '): string {',
    '  const expression = importModuleExpression.trim();',
    '  if (!expression) {',
    "    throw new Error('Inline Jiso loader import expression cannot be empty.');",
    '  }',
    '',
    '  return `(${inlineJisoLoaderInstallerSource})(${expression});`;',
    '}',
    '',
    'export const jisoLoaderSource = createInlineJisoLoaderSource();',
  ].join('\n')}\n`;
  assertInlineJisoLoaderModuleArtifactParity(moduleSource, 'Generated inline Jiso loader module');

  return moduleSource;
}

export function assertInlineJisoLoaderGzipBudget(
  installerSource: string,
  label = 'Inline Jiso loader',
): void {
  const bytes = gzipSync(createInlineJisoLoaderBootstrapSource(installerSource)).byteLength;
  if (bytes <= inlineJisoLoaderGzipByteBudget) return;

  throw new Error(
    `${label} exceeds SPEC.md §4.4 gzip budget: ${bytes} bytes > ${inlineJisoLoaderGzipByteBudget} bytes.`,
  );
}

function readInlineWireParserReadableSource(): string {
  return extractInlineHelperReadableSource({
    label: 'wire parser',
    rootFunctionNames: inlineWireParserRootFunctionNames,
    source: readFileSync(wireParserSourcePath, 'utf8'),
    sourceFileName: 'wire-parser.ts',
  });
}

function readInlineResponseApplyReadableSource(): string {
  return extractInlineHelperReadableSource({
    label: 'response apply',
    rootFunctionNames: inlineResponseApplyRootFunctionNames,
    source: readFileSync(inlineResponseApplySourcePath, 'utf8'),
    sourceFileName: 'inline-response-apply.ts',
  });
}

export function extractInlineWireParserReadableSource(
  source: string,
  rootFunctionNames: readonly string[] = inlineWireParserRootFunctionNames,
): string {
  return extractInlineHelperReadableSource({
    label: 'wire parser',
    rootFunctionNames,
    source,
    sourceFileName: 'wire-parser.ts',
  });
}

export function extractInlineResponseApplyReadableSource(
  source: string,
  rootFunctionNames: readonly string[] = inlineResponseApplyRootFunctionNames,
): string {
  return extractInlineHelperReadableSource({
    label: 'response apply',
    rootFunctionNames,
    source,
    sourceFileName: 'inline-response-apply.ts',
  });
}

interface ExtractInlineHelperReadableSourceOptions {
  label: string;
  rootFunctionNames: readonly string[];
  source: string;
  sourceFileName: string;
}

function extractInlineHelperReadableSource({
  label,
  rootFunctionNames,
  source,
  sourceFileName,
}: ExtractInlineHelperReadableSourceOptions): string {
  const sourceFile = ts.createSourceFile(
    sourceFileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.FunctionDeclaration>();
  const unsupportedTopLevelBindings = collectUnsupportedInlineHelperTopLevelBindings(sourceFile);

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
  }

  const missing = rootFunctionNames.filter((name) => !declarations.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Inline Jiso loader ${label} source is missing helper(s): ${missing.join(', ')}`,
    );
  }

  const included = collectInlineHelperDependencyClosure(
    label,
    sourceFile,
    declarations,
    unsupportedTopLevelBindings,
    rootFunctionNames,
  );
  const helperSource = [...included]
    .map((name) => declarations.get(name))
    .filter((declaration): declaration is ts.FunctionDeclaration => declaration !== undefined)
    .map((declaration) => declaration.getText(sourceFile).replace(/^export\s+function/, 'function'))
    .join('\n\n');
  const transpiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;

  return transpiled.replace(/^"use strict";\s*/, '').trim();
}

export function assertInlineJisoLoaderInstallerWireParserParity(
  installerSource: string,
  wireParserSource: string = readFileSync(wireParserSourcePath, 'utf8'),
): void {
  const expected = extractInlineWireParserReadableSource(wireParserSource);
  const count = countSubstring(installerSource, expected);

  if (count !== 1) {
    throw new Error(
      `Inline Jiso loader readable source must embed the canonical wire parser helper closure exactly once; found ${count}.`,
    );
  }
}

export function assertMinifiedInlineJisoLoaderInstallerWireParserParity(
  installerSource: string,
  wireParserSource: string = readFileSync(wireParserSourcePath, 'utf8'),
): void {
  const expected = minifyInlineJavaScriptSource(
    extractInlineWireParserReadableSource(wireParserSource),
  );
  const count = countSubstring(installerSource, expected);

  if (count !== 1) {
    throw new Error(
      `Inline Jiso loader minified source must embed the canonical minified wire parser helper closure exactly once; found ${count}.`,
    );
  }
}

export function assertInlineJisoLoaderInstallerResponseApplyParity(
  installerSource: string,
  responseApplySource: string = readFileSync(inlineResponseApplySourcePath, 'utf8'),
): void {
  const expected = extractInlineResponseApplyReadableSource(responseApplySource);
  const count = countSubstring(installerSource, expected);

  if (count !== 1) {
    throw new Error(
      `Inline Jiso loader readable source must embed the canonical response apply helper closure exactly once; found ${count}.`,
    );
  }
}

export function assertMinifiedInlineJisoLoaderInstallerResponseApplyParity(
  installerSource: string,
  responseApplySource: string = readFileSync(inlineResponseApplySourcePath, 'utf8'),
): void {
  const expected = minifyInlineJavaScriptSource(
    extractInlineResponseApplyReadableSource(responseApplySource),
  );
  const count = countSubstring(installerSource, expected);

  if (count !== 1) {
    throw new Error(
      `Inline Jiso loader minified source must embed the canonical minified response apply helper closure exactly once; found ${count}.`,
    );
  }
}

function assertDefaultInlineJisoLoaderInstallerWireParserParity(source: string): void {
  if (source !== inlineJisoLoaderInstallerReadableSource) return;
  assertInlineJisoLoaderInstallerWireParserParity(source);
}

function assertDefaultInlineJisoLoaderInstallerResponseApplyParity(source: string): void {
  if (source !== inlineJisoLoaderInstallerReadableSource) return;
  assertInlineJisoLoaderInstallerResponseApplyParity(source);
}

function assertDefaultMinifiedInlineJisoLoaderInstallerWireParserParity(
  readableSource: string,
  installerSource: string,
): void {
  if (readableSource !== inlineJisoLoaderInstallerReadableSource) return;
  assertMinifiedInlineJisoLoaderInstallerWireParserParity(installerSource);
}

function assertDefaultMinifiedInlineJisoLoaderInstallerResponseApplyParity(
  readableSource: string,
  installerSource: string,
): void {
  if (readableSource !== inlineJisoLoaderInstallerReadableSource) return;
  assertMinifiedInlineJisoLoaderInstallerResponseApplyParity(installerSource);
}

function countSubstring(source: string, expected: string): number {
  if (!expected) return 0;

  let count = 0;
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(expected, offset);
    if (index === -1) return count;

    count += 1;
    offset = index + expected.length;
  }

  return count;
}

function collectInlineHelperDependencyClosure(
  label: string,
  sourceFile: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
  unsupportedTopLevelBindings: ReadonlySet<string>,
  rootFunctionNames: readonly string[],
): Set<string> {
  const included = new Set<string>();
  const visiting = new Set<string>();

  const include = (name: string): void => {
    if (included.has(name)) return;
    if (visiting.has(name)) return;

    const declaration = declarations.get(name);
    if (!declaration) {
      throw new Error(`Inline Jiso loader ${label} source is missing helper: ${name}`);
    }

    visiting.add(name);
    for (const dependency of collectInlineHelperFunctionDependencies(
      label,
      sourceFile,
      declaration,
      declarations,
      unsupportedTopLevelBindings,
    )) {
      include(dependency);
    }
    included.add(name);
    visiting.delete(name);
  };

  for (const name of rootFunctionNames) include(name);
  return included;
}

function collectInlineHelperFunctionDependencies(
  label: string,
  sourceFile: ts.SourceFile,
  declaration: ts.FunctionDeclaration,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
  unsupportedTopLevelBindings: ReadonlySet<string>,
): Set<string> {
  const dependencies = new Set<string>();
  const ownName = declaration.name?.text;

  const visit = (node: ts.Node): void => {
    if (node === declaration.name) return;

    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (name !== ownName && declarations.has(name)) dependencies.add(name);
      if (unsupportedTopLevelBindings.has(name)) {
        throw new Error(
          `Inline Jiso loader ${label} helper ${ownName ?? '<anonymous>'} references top-level binding ${name}, but inline extraction only supports self-contained top-level function declarations.`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  for (const parameter of declaration.parameters) {
    if (parameter.initializer) visit(parameter.initializer);
  }
  if (declaration.body) visit(declaration.body);
  return dependencies;
}

function collectUnsupportedInlineHelperTopLevelBindings(sourceFile: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();

  const addBindingName = (name: ts.BindingName | ts.Identifier): void => {
    if (ts.isIdentifier(name)) {
      bindings.add(name.text);
      return;
    }

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      addBindingName(element.name);
    }
  };

  const addImportClauseBindings = (clause: ts.ImportClause): void => {
    if (clause.name) bindings.add(clause.name.text);
    if (!clause.namedBindings) return;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.add(clause.namedBindings.name.text);
      return;
    }
    for (const specifier of clause.namedBindings.elements) {
      bindings.add(specifier.name.text);
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      addImportClauseBindings(statement.importClause);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addBindingName(declaration.name);
      }
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      bindings.add(statement.name.text);
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      bindings.add(statement.name.text);
    }
  }

  return bindings;
}

export function assertInlineJisoLoaderModuleArtifactParity(
  moduleSource: string,
  label = 'Inline Jiso loader module',
): void {
  const sourceFile = parseInlineJisoLoaderModuleSource(moduleSource, label);
  let installerLiteralSource: string | undefined;
  let installerFunctionSource: string | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (node.name.text === 'inlineJisoLoaderInstallerSource') {
        installerLiteralSource = readInlineInstallerSourceLiteral(node.initializer);
      }
      if (node.name.text === 'inlineJisoLoaderInstaller') {
        const expression = unwrapInlineInstallerExpression(node.initializer);
        if (ts.isFunctionExpression(expression)) {
          installerFunctionSource = expression.getText(sourceFile);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (installerLiteralSource === undefined) {
    throw new Error(`${label} is missing inlineJisoLoaderInstallerSource.`);
  }
  if (installerFunctionSource === undefined) {
    throw new Error(`${label} is missing inlineJisoLoaderInstaller function artifact.`);
  }
  if (installerLiteralSource !== installerFunctionSource) {
    throw new Error(
      `${label} embedded installer artifacts drifted: inlineJisoLoaderInstallerSource does not match inlineJisoLoaderInstaller.`,
    );
  }
  assertInlineJisoLoaderGzipBudget(installerLiteralSource, label);
}

function parseInlineJisoLoaderModuleSource(moduleSource: string, label: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    'inline-loader.ts',
    moduleSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const [diagnostic] =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  if (diagnostic) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    throw new Error(`${label} is invalid TypeScript: ${message}`);
  }

  return sourceFile;
}

function readInlineInstallerSourceLiteral(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapInlineInstallerExpression(expression);
  if (ts.isNoSubstitutionTemplateLiteral(unwrapped) || ts.isStringLiteral(unwrapped)) {
    return unwrapped.text;
  }

  return undefined;
}

function unwrapInlineInstallerExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function emitInlineJisoLoaderModule(
  options: EmitInlineJisoLoaderModuleOptions = {},
): EmitInlineJisoLoaderModuleResult {
  const targetPath = options.targetPath ?? inlineJisoLoaderModulePath;
  const source =
    options.source === undefined
      ? buildInlineJisoLoaderModuleSource()
      : buildInlineJisoLoaderModuleSource(options.source);
  const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : undefined;
  const changed = current !== source;

  if (options.check) {
    if (current !== undefined) {
      assertInlineJisoLoaderModuleArtifactParity(current, targetPath);
    }
    if (changed) {
      throw new Error(
        `Inline Jiso loader module is stale: ${targetPath}. Run pnpm --filter @jiso/runtime run build:inline-loader.`,
      );
    }
    return { changed, source, targetPath };
  }

  if (changed) writeFileSync(targetPath, source, 'utf8');

  return { changed, source, targetPath };
}

function inlineJavaScriptTemplateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

function createInlineJisoLoaderBootstrapSource(
  installerSource: string,
  importModuleExpression = '(url)=>import(url)',
): string {
  return `(${installerSource})(${importModuleExpression});`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = emitInlineJisoLoaderModule({ check: process.argv.includes('--check') });

  if (!process.argv.includes('--check')) {
    console.log(
      `${result.changed ? 'Wrote' : 'Unchanged'} ${result.targetPath} from inline-loader-build.ts.`,
    );
  }
}
