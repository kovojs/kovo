import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));

const disallowedExternalImports = new Set(['@kovojs/server', 'vite']);
const disallowedExternalPrefixes = ['@kovojs/server/', 'vite/', '@vitejs/'];
const disallowedLocalModules = new Set(['mount.mjs', 'vite.mjs']);
const compareText = (a, b) => a.localeCompare(b);

function importSpecifiers(file) {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const specifiers = [];

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (specifier && ts.isStringLiteralLike(specifier)) specifiers.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function resolveLocalModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const base = join(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.mjs'),
    join(base, 'index.js'),
    join(base, 'index.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function localImportGraph(entry) {
  const queue = [entry];
  const visited = new Set();
  const externalImports = new Set();

  while (queue.length) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    for (const specifier of importSpecifiers(file)) {
      const local = resolveLocalModule(file, specifier);
      if (local) {
        queue.push(local);
      } else {
        externalImports.add(specifier);
      }
    }
  }

  return { files: visited, externalImports };
}

function relativeSrcPath(file) {
  return relative(srcDir, file).split(sep).join('/');
}

function isServerOrViteImport(specifier) {
  return (
    disallowedExternalImports.has(specifier) ||
    disallowedExternalPrefixes.some((prefix) => specifier.startsWith(prefix))
  );
}

describe('@kovojs/devtool public seams', () => {
  it('keeps the root runtime import graph plain-Node and away from server/Vite integration', () => {
    const graph = localImportGraph(join(srcDir, 'index.mjs'));
    const localFiles = [...graph.files].map(relativeSrcPath).sort(compareText);
    const blockedExternalImports = [...graph.externalImports]
      .filter(isServerOrViteImport)
      .sort(compareText);
    const blockedLocalFiles = localFiles.filter((file) => disallowedLocalModules.has(file));

    expect(blockedExternalImports).toEqual([]);
    expect(blockedLocalFiles).toEqual([]);
    expect(localFiles).toContain('mcp.mjs');
    expect(localFiles).toContain('render.mjs');
  });

  it('loads root, app, and Vite subpaths through package exports in plain Node', async () => {
    const root = await import('@kovojs/devtool');
    const app = await import('@kovojs/devtool/app');
    const vite = await import('@kovojs/devtool/vite');

    expect(root.buildDataflowGraph).toEqual(expect.any(Function));
    expect(root.createMcpServer).toEqual(expect.any(Function));
    expect(root.createDevtoolApp).toBeUndefined();
    expect(root.devtoolMountPlugin).toBeUndefined();
    expect(app.createDevtoolApp).toEqual(expect.any(Function));
    expect(vite.devtoolMountPlugin).toEqual(expect.any(Function));
  });
});
