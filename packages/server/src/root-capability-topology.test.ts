import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = dirname(fileURLToPath(import.meta.url));

describe('ordinary server root capability topology', () => {
  it('reaches the exact agent bridge without loading the /agent implementation', () => {
    const rootModules = runtimeReachableModules(resolve(sourceRoot, 'index.ts'));
    const agentModules = runtimeReachableModules(resolve(sourceRoot, 'public-agent.ts'));

    expect(rootModules).toContain(resolve(sourceRoot, 'agent-app-bridge.ts'));
    expect(rootModules).not.toContain(resolve(sourceRoot, 'agent.ts'));
    expect(rootModules).not.toContain(resolve(sourceRoot, 'public-agent.ts'));
    expect(agentModules).toContain(resolve(sourceRoot, 'agent.ts'));
    expect(agentModules).toContain(resolve(sourceRoot, 'agent-app-bridge.ts'));
  });
});

function runtimeReachableModules(entry: string): string[] {
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const specifier of runtimeModuleSpecifiers(source)) {
      const resolved = resolveRelativeSource(file, specifier);
      if (resolved !== undefined && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return [...visited].sort();
}

function runtimeModuleSpecifiers(source: ts.SourceFile): string[] {
  const result = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (importHasRuntimeBinding(node.importClause)) result.add(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      exportHasRuntimeBinding(node)
    ) {
      result.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      result.add(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...result];
}

function importHasRuntimeBinding(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  if (clause.namedBindings === undefined) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportHasRuntimeBinding(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) return false;
  if (declaration.exportClause === undefined) return true;
  if (ts.isNamespaceExport(declaration.exportClause)) return true;
  return declaration.exportClause.elements.some((element) => !element.isTypeOnly);
}

function resolveRelativeSource(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const candidate = resolve(dirname(importer), specifier);
  const stem = candidate.replace(/\.(?:mjs|cjs|js)$/u, '');
  for (const extension of ['.ts', '.tsx']) {
    const file = `${stem}${extension}`;
    if (existsSync(file)) return file;
  }
  return undefined;
}
