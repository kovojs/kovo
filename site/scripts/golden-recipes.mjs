#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { publicEntrySubpaths, publicPackages, repoRoot } from '../../scripts/public-packages.mjs';
import { isMainEntry, runGate } from '../../scripts/lib/cli-entry.mjs';

const contentPath = path.join(repoRoot, 'site/content/guides/golden-recipes.md');
const recipeRoot = path.join(repoRoot, 'site/recipes/golden');
const executePath = path.join(recipeRoot, 'execute.mjs');
const MARKER =
  /^<!-- kovo-recipe task="([^"]+)" source="([^"]+)" export="([A-Za-z_$][A-Za-z0-9_$]*)" -->$/u;
const KOVO_IMPORT = /^@kovojs\/[a-z0-9-]+(?:\/.*)?$/u;

export const GOLDEN_RECIPE_TASKS = [
  'component',
  'route',
  'query',
  'mutation',
  'form',
  'endpoint',
  'auth',
  'storage',
  'task',
  'webhook',
  'email',
  'file',
  'upload',
  'raw HTML',
  'capability link',
  'deploy',
];

export function readGoldenRecipeManifest({ markdown = readFileSync(contentPath, 'utf8') } = {}) {
  const lines = markdown.split('\n');
  const recipes = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('kovo-recipe')) continue;
    const marker = MARKER.exec(lines[index]);
    if (!marker) {
      throw new TypeError(`golden-recipes:${index + 1} malformed kovo-recipe marker`);
    }
    let fenceIndex = index + 1;
    while (fenceIndex < lines.length && lines[fenceIndex].trim() === '') fenceIndex += 1;
    const fence = /^```(ts|tsx)$/u.exec(lines[fenceIndex] ?? '');
    if (!fence) {
      throw new TypeError(
        `golden-recipes:${index + 1} recipe marker must own the next TypeScript fence`,
      );
    }
    const body = [];
    let cursor = fenceIndex + 1;
    while (cursor < lines.length && lines[cursor] !== '```') {
      body.push(lines[cursor]);
      cursor += 1;
    }
    if (cursor >= lines.length) {
      throw new TypeError(`golden-recipes:${fenceIndex + 1} unclosed recipe fence`);
    }
    recipes.push({
      code: body.join('\n'),
      exportName: marker[3],
      line: index + 1,
      sourcePath: marker[2],
      task: marker[1],
    });
    index = cursor;
  }

  return recipes;
}

export function validateGoldenRecipes({
  markdown = readFileSync(contentPath, 'utf8'),
  requireTracked = true,
} = {}) {
  const recipes = readGoldenRecipeManifest({ markdown });
  const actualTasks = recipes.map((recipe) => recipe.task);
  if (JSON.stringify(actualTasks) !== JSON.stringify(GOLDEN_RECIPE_TASKS)) {
    throw new TypeError(
      `golden-recipes task set/order drifted: expected ${GOLDEN_RECIPE_TASKS.join(', ')}; received ${actualTasks.join(', ')}`,
    );
  }

  const sources = new Set();
  for (const recipe of recipes) {
    if (sources.has(recipe.sourcePath)) {
      throw new TypeError(`golden-recipes:${recipe.line} duplicate source ${recipe.sourcePath}`);
    }
    sources.add(recipe.sourcePath);
    const sourceFilePath = confinedSourcePath(recipe);
    if (!existsSync(sourceFilePath) || !statSync(sourceFilePath).isFile()) {
      throw new TypeError(
        `golden-recipes:${recipe.line} source does not exist: ${recipe.sourcePath}`,
      );
    }
    if (requireTracked) assertTrackedSource(recipe);
    const source = readFileSync(sourceFilePath, 'utf8').trimEnd();
    if (recipe.code !== source) {
      throw new TypeError(
        `golden-recipes:${recipe.line} displayed ${recipe.task} bytes differ from ${recipe.sourcePath}`,
      );
    }
    assertExportedSymbol(sourceFilePath, source, recipe);
    assertPublicKovoImports(sourceFilePath, source, recipe);
  }

  return { recipes, tasks: recipes.length };
}

export async function compileAndExecuteGoldenRecipes({ nodeModulesDir, projectRoot } = {}) {
  if (typeof nodeModulesDir !== 'string' || typeof projectRoot !== 'string') {
    throw new TypeError('golden recipe packed execution requires nodeModulesDir and projectRoot');
  }
  const { recipes } = validateGoldenRecipes();
  const sourceDir = path.join(projectRoot, 'src');
  const outputDir = path.join(projectRoot, 'dist');
  await rm(projectRoot, { force: true, recursive: true });
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true,"type":"module"}\n');

  for (const recipe of recipes) {
    await cp(confinedSourcePath(recipe), path.join(sourceDir, path.basename(recipe.sourcePath)));
  }
  const config = {
    compilerOptions: {
      declaration: false,
      exactOptionalPropertyTypes: true,
      jsx: 'react-jsx',
      jsxImportSource: '@kovojs/server',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: false,
      noUncheckedIndexedAccess: true,
      outDir: outputDir,
      rootDir: sourceDir,
      skipLibCheck: true,
      strict: true,
      target: 'ES2024',
      types: ['node'],
      verbatimModuleSyntax: true,
    },
    files: recipes.map((recipe) =>
      path.relative(projectRoot, path.join(sourceDir, path.basename(recipe.sourcePath))),
    ),
  };
  const configPath = path.join(projectRoot, 'tsconfig.json');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  assertPackedRecipeImports({ config, nodeModulesDir, recipes, sourceDir });
  const compiled = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/tsc'),
    ['-p', configPath, '--pretty', 'false'],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  if (compiled.status !== 0) {
    throw new Error(
      `golden recipe packed compile failed:\n${`${compiled.stdout ?? ''}${compiled.stderr ?? ''}`.trim()}`,
    );
  }

  await cp(executePath, path.join(outputDir, 'execute.mjs'));
  const executed = spawnSync(process.execPath, [path.join(outputDir, 'execute.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const output = `${executed.stdout ?? ''}${executed.stderr ?? ''}`.trim();
  if (executed.status !== 0 || output !== 'golden-recipes/v1 tasks=16 OK') {
    throw new Error(`golden recipe packed execution failed${output === '' ? '' : `:\n${output}`}`);
  }
  return { output, tasks: recipes.length };
}

function confinedSourcePath(recipe) {
  const candidate = path.resolve(repoRoot, recipe.sourcePath);
  const relative = path.relative(recipeRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError(`golden-recipes:${recipe.line} source must stay under site/recipes/golden`);
  }
  return candidate;
}

function assertTrackedSource(recipe) {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', recipe.sourcePath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (tracked.status !== 0) {
    throw new TypeError(
      `golden-recipes:${recipe.line} source is not tracked: ${recipe.sourcePath}`,
    );
  }
}

function assertExportedSymbol(sourceFilePath, source, recipe) {
  const sourceFile = ts.createSourceFile(
    sourceFilePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFilePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new TypeError(
      `golden-recipes:${recipe.line} source has TypeScript syntax errors: ${recipe.sourcePath}`,
    );
  }
  const exported = new Set();
  for (const statement of sourceFile.statements) {
    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (isExported && 'name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      exported.add(statement.name.text);
    }
    if (isExported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exported.add(declaration.name.text);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      for (const element of statement.exportClause.elements) exported.add(element.name.text);
    }
  }
  if (!exported.has(recipe.exportName)) {
    throw new TypeError(
      `golden-recipes:${recipe.line} ${recipe.sourcePath} does not export ${recipe.exportName}`,
    );
  }
}

function assertPublicKovoImports(sourceFilePath, source, recipe) {
  const packages = new Map(publicPackages().map((pkg) => [pkg.name, pkg]));
  const sourceFile = ts.createSourceFile(
    sourceFilePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFilePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  for (const imported of ts.preProcessFile(sourceFile.text).importedFiles) {
    const specifier = imported.fileName;
    if (!KOVO_IMPORT.test(specifier)) continue;
    const packageName = specifier.split('/').slice(0, 2).join('/');
    const pkg = packages.get(packageName);
    if (!pkg) {
      throw new TypeError(
        `golden-recipes:${recipe.line} imports non-public package ${packageName}`,
      );
    }
    const suffix = specifier.slice(packageName.length);
    const subpath = suffix === '' ? '.' : `.${suffix}`;
    if (!publicEntrySubpaths(pkg).includes(subpath)) {
      throw new TypeError(
        `golden-recipes:${recipe.line} imports non-app-facing subpath ${specifier}`,
      );
    }
  }
}

function assertPackedRecipeImports({ config, nodeModulesDir, recipes, sourceDir }) {
  const compilerOptions = ts.convertCompilerOptionsFromJson(
    config.compilerOptions,
    sourceDir,
  ).options;
  let resolutions = 0;
  for (const recipe of recipes) {
    const file = path.join(sourceDir, path.basename(recipe.sourcePath));
    const source = readFileSync(file, 'utf8');
    for (const imported of ts.preProcessFile(source).importedFiles) {
      const specifier = imported.fileName;
      if (!KOVO_IMPORT.test(specifier)) continue;
      const packageName = specifier.split('/').slice(0, 2).join('/');
      const resolved = ts.resolveModuleName(
        specifier,
        file,
        compilerOptions,
        ts.sys,
      ).resolvedModule;
      if (!resolved) {
        throw new TypeError(`golden-recipes:${recipe.line} unresolved packed import ${specifier}`);
      }
      const packageDir = canonicalPath(path.join(nodeModulesDir, ...packageName.split('/')));
      const resolvedFile = canonicalPath(resolved.resolvedFileName);
      const relative = path.relative(packageDir, resolvedFile);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new TypeError(
          `golden-recipes:${recipe.line} ${specifier} resolved outside its packed package`,
        );
      }
      if (resolvedFile.includes(`${path.sep}packages${path.sep}`)) {
        throw new TypeError(
          `golden-recipes:${recipe.line} ${specifier} fell back to workspace source`,
        );
      }
      resolutions += 1;
    }
  }
  if (resolutions < GOLDEN_RECIPE_TASKS.length) {
    throw new TypeError(
      `golden-recipes resolved only ${resolutions} packed Kovo imports for ${GOLDEN_RECIPE_TASKS.length} tasks`,
    );
  }
}

function canonicalPath(candidate) {
  let existing = path.resolve(candidate);
  const missing = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(candidate);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...missing);
}

if (isMainEntry(import.meta.url)) {
  await runGate(async () => {
    const { tasks } = validateGoldenRecipes();
    const executeSource = await readFile(executePath, 'utf8');
    if (!executeSource.includes(`tasks=${tasks} OK`)) {
      throw new TypeError('golden recipe executor task count drifted');
    }
    process.stdout.write(`golden-recipes/v1 tasks=${tasks} sources=${tasks} OK\n`);
  });
}
