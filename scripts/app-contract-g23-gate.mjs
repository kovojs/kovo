import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const appFactoryNames = new Set(['endpoint', 'layout', 'mutation', 'query', 'route', 'task']);
const manualContextNames = new Set([
  'AppRequest',
  'ComponentRenderSlots',
  'MutationContext',
  'QueryLoadContext',
  'Reader',
]);
const registryNames = new Set([
  'ComponentRegistry',
  'InvalidationSets',
  'MutationRegistry',
  'QueryRegistry',
  'RouteRegistry',
]);

const defaultCorpora = Object.freeze([
  {
    exclude: (path) => path.includes('/_kovo/') || path.includes('.test.'),
    name: 'packed-starter',
    root: 'packages/create-kovo/templates/src',
  },
  {
    exclude: (path) => path.includes('.test.'),
    name: 'crm-advanced-example',
    root: 'examples/crm/src',
  },
]);

export function analyzeAppContractG23(
  workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
) {
  const corpora = defaultCorpora.map((corpus) => {
    const root = resolve(workspaceRoot, corpus.root);
    const files = sourceFiles(root)
      .map((fileName) => {
        const path = normalizePath(relative(workspaceRoot, fileName));
        return { path, source: readFileSync(fileName, 'utf8') };
      })
      .filter((file) => !corpus.exclude(`/${file.path}`));
    return analyzeAppContractCorpus(corpus.name, files);
  });
  return Object.freeze({
    corpora,
    ok: corpora.every((corpus) => corpus.findings.length === 0),
    schema: 'kovo.app-contract-g23/v1',
  });
}

export function analyzeAppContractCorpus(name, files) {
  const calls = {
    assemble: 0,
    defineKovo: 0,
    endpoint: 0,
    layout: 0,
    mutation: 0,
    query: 0,
    route: 0,
    task: 0,
  };
  const findings = [];
  const hashes = [];

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    hashes.push(`${file.path}\0${sha256(file.source)}`);

    const visit = (node) => {
      if (ts.isIdentifier(node) && manualContextNames.has(node.text)) {
        addFinding(findings, sourceFile, node, `manual app-context type ${node.text}`);
      }
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        registryNames.has(node.name.text)
      ) {
        addFinding(findings, sourceFile, node.name, `app-authored registry ${node.name.text}`);
      }
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        if (!isConstAssertion(node)) {
          addFinding(findings, sourceFile, node, 'type cast in app-contract consumer');
        }
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const moduleName = node.moduleSpecifier.text;
        if (moduleName === '@kovojs/server') {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              const importedName = element.propertyName?.text ?? element.name.text;
              if (appFactoryNames.has(importedName)) {
                addFinding(
                  findings,
                  sourceFile,
                  element,
                  `free app factory import ${importedName}; use the defineKovo receiver`,
                );
              }
            }
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const expression = unwrapExpression(node.expression);
        if (ts.isIdentifier(expression) && expression.text === 'defineKovo') {
          calls.defineKovo += 1;
          if (node.typeArguments && node.typeArguments.length > 0) {
            addFinding(findings, sourceFile, node, 'explicit defineKovo generic arguments');
          }
        }
        if (ts.isPropertyAccessExpression(expression)) {
          const member = expression.name.text;
          if (member === 'assemble') calls.assemble += 1;
          if (appFactoryNames.has(member)) {
            calls[member] += 1;
            if (node.typeArguments && node.typeArguments.length > 0) {
              addFinding(findings, sourceFile, node, `explicit app.${member} generic arguments`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (calls.defineKovo !== 1) {
    findings.push({
      column: 1,
      file: '<corpus>',
      line: 1,
      message: `expected exactly one defineKovo() call; found ${calls.defineKovo}`,
    });
  }
  if (calls.assemble !== 1) {
    findings.push({
      column: 1,
      file: '<corpus>',
      line: 1,
      message: `expected exactly one app.assemble() call; found ${calls.assemble}`,
    });
  }
  for (const required of ['mutation', 'query', 'route']) {
    if (calls[required] === 0) {
      findings.push({
        column: 1,
        file: '<corpus>',
        line: 1,
        message: `expected at least one app.${required}() declaration`,
      });
    }
  }

  return Object.freeze({
    calls: Object.freeze(calls),
    digest: `sha256:${sha256(hashes.join('\n'))}`,
    fileCount: files.length,
    findings: Object.freeze(
      findings.sort(
        (left, right) =>
          left.file.localeCompare(right.file) ||
          left.line - right.line ||
          left.column - right.column ||
          left.message.localeCompare(right.message),
      ),
    ),
    name,
  });
}

function sourceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function addFinding(findings, sourceFile, node, message) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push({
    column: position.character + 1,
    file: sourceFile.fileName,
    line: position.line + 1,
    message,
  });
}

function isConstAssertion(node) {
  return (
    ts.isAsExpression(node) &&
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === 'const'
  );
}

function normalizePath(path) {
  return sep === '/' ? path : path.split(sep).join('/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = analyzeAppContractG23();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
