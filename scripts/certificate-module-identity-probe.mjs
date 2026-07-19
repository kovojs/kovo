#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { collectFiles } from './lib/source-files.mjs';
import { normalizePackageExports, resolveExportTarget } from './package-exports.mjs';
import { publicPackages, repoRoot } from './public-packages.mjs';

export const certificateProbePackageNames = Object.freeze([
  '@kovojs/better-auth',
  '@kovojs/server',
]);

const snapshotPath = path.join(repoRoot, 'scripts', 'pack-security.files.json');

export function probePublishedModuleIdentity({
  packageConfigs = defaultPackageConfigs(repoRoot),
  packageNames = certificateProbePackageNames,
  snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')),
} = {}) {
  const findings = [];
  const configsByName = new Map(packageConfigs.map((config) => [config.name, config]));
  const resolutionPackages = [];

  for (const config of configsByName.values()) {
    const packedFiles = snapshot?.packages?.[config.name];
    if (!Array.isArray(packedFiles)) {
      findings.push(`${config.name}: scripts/pack-security.files.json has no exact file list`);
      continue;
    }
    const modules = validateExactModuleFiles({ config, findings, packedFiles });
    resolutionPackages.push({ ...config, modules, moduleSet: new Set(modules) });
  }

  const resolutionPackagesByName = new Map(resolutionPackages.map((entry) => [entry.name, entry]));
  const packages = [];
  for (const packageName of packageNames) {
    const packageEntry = resolutionPackagesByName.get(packageName);
    if (packageEntry === undefined) {
      findings.push(`${packageName}: package configuration or exact file list is missing`);
    } else {
      packages.push(packageEntry);
    }
  }

  if (findings.length > 0) throw probeError(findings);

  const resolvedEdges = new Map();
  const externalImports = new Map();
  const opaqueModules = new Map();

  for (const packageEntry of packages) {
    for (const modulePath of packageEntry.modules) {
      const module = moduleId(packageEntry.name, modulePath);
      const absolutePath = path.join(packageEntry.rootDir, modulePath);
      const source = readFileSync(absolutePath, 'utf8');
      const parsed = parsePublishedModule(module, source, findings);

      if (parsed.importsModuleLoader) {
        const opaque = {
          module,
          reason:
            'imports Node module-loader authority; runtime-selected dependency loads require lexical authority coverage',
        };
        opaqueModules.set(`${opaque.module}\0${opaque.reason}`, opaque);
      }

      for (const imported of parsed.specifiers) {
        const resolution = resolvePublishedSpecifier({
          from: modulePath,
          imported,
          packageEntry,
          packagesByName: resolutionPackagesByName,
        });
        if (resolution.kind === 'finding') {
          findings.push(`${module}:${imported.line}:${imported.column}: ${resolution.message}`);
        } else if (resolution.kind === 'edge') {
          const edge = [module, resolution.target];
          resolvedEdges.set(edge.join('\0'), edge);
        } else {
          const external = [module, imported.text];
          externalImports.set(external.join('\0'), external);
        }
      }
    }
  }

  if (findings.length > 0) throw probeError(findings);

  const edges = [...resolvedEdges.values()].sort(compareTuples);
  const externals = [...externalImports.values()].sort(compareTuples);
  const opaque = [...opaqueModules.values()].sort(
    (left, right) =>
      compareStrings(left.module, right.module) || compareStrings(left.reason, right.reason),
  );
  const packageSummaries = packages
    .map((entry) => ({
      moduleCount: entry.modules.length,
      name: entry.name,
      resolvedImportEdgeCount: edges.filter(([from]) => from.startsWith(`${entry.name}/`)).length,
    }))
    .sort((left, right) => compareStrings(left.name, right.name));
  const selectedFileList = Object.fromEntries(
    resolutionPackages
      .map((entry) => [entry.name, entry.modules])
      .sort(([left], [right]) => compareStrings(left, right)),
  );

  return {
    schema: 'kovo.certificate-module-identity-probe/v1',
    exactModuleFileListSha256: createHash('sha256')
      .update(`${JSON.stringify(selectedFileList)}\n`, 'utf8')
      .digest('hex'),
    recoveredModuleCount: packageSummaries.reduce((count, entry) => count + entry.moduleCount, 0),
    resolvedImportEdgeCount: edges.length,
    externalImportCount: externals.length,
    opaqueModuleCount: opaque.length,
    resolutionPackageCount: resolutionPackages.length,
    packages: packageSummaries,
    resolvedEdges: edges,
    externalImports: externals,
    opaqueModules: opaque,
  };
}

export function formatPublishedModuleIdentityReport(report, { includeEdges = false } = {}) {
  const lines = [
    `${report.schema} modules=${report.recoveredModuleCount} resolution-packages=${report.resolutionPackageCount} resolved-edges=${report.resolvedImportEdgeCount} external-imports=${report.externalImportCount} opaque-modules=${report.opaqueModuleCount}`,
    `exact-module-file-list-sha256=${report.exactModuleFileListSha256}`,
  ];
  for (const entry of report.packages) {
    lines.push(
      `${entry.name}: modules=${entry.moduleCount} resolved-edges=${entry.resolvedImportEdgeCount}`,
    );
  }
  for (const entry of report.opaqueModules) {
    lines.push(`opaque ${entry.module}: ${entry.reason}`);
  }
  if (includeEdges) {
    for (const [from, to] of report.resolvedEdges) lines.push(`edge ${from} -> ${to}`);
  }
  lines.push(
    'certificate-module-identity-probe: PASS (all discovered in-scope ESM edges resolved)',
  );
  return `${lines.join('\n')}\n`;
}

function validateExactModuleFiles({ config, findings, packedFiles }) {
  const seen = new Set();
  const modules = [];
  for (const packedFile of packedFiles) {
    if (typeof packedFile !== 'string') {
      findings.push(`${config.name}: packed file list contains a non-string entry`);
      continue;
    }
    if (
      packedFile.includes('\\') ||
      path.posix.isAbsolute(packedFile) ||
      path.posix.normalize(packedFile) !== packedFile ||
      packedFile.startsWith('../')
    ) {
      findings.push(`${config.name}: packed path is not canonical: ${JSON.stringify(packedFile)}`);
      continue;
    }
    if (seen.has(packedFile)) {
      findings.push(`${config.name}: duplicate packed path ${packedFile}`);
      continue;
    }
    seen.add(packedFile);
    if (packedFile.endsWith('.mjs')) modules.push(packedFile);
  }
  modules.sort(compareStrings);

  const actualModules = collectFiles(config.rootDir, ['dist'], {
    includeFile: ({ relativePath }) => relativePath.endsWith('.mjs'),
  }).sort(compareStrings);
  if (JSON.stringify(actualModules) !== JSON.stringify(modules)) {
    const expected = new Set(modules);
    const actual = new Set(actualModules);
    for (const missing of modules.filter((entry) => !actual.has(entry))) {
      findings.push(`${config.name}: packed module is missing from dist: ${missing}`);
    }
    for (const extra of actualModules.filter((entry) => !expected.has(entry))) {
      findings.push(
        `${config.name}: dist module is absent from the exact packed file list: ${extra}`,
      );
    }
  }

  validatePackageRoot(config, findings);
  for (const modulePath of modules) validateNoSymlinkPath(config, modulePath, findings);
  return modules;
}

function validatePackageRoot(config, findings) {
  try {
    const stat = lstatSync(config.rootDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      findings.push(`${config.name}: package root must be a regular non-symlink directory`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function validateNoSymlinkPath(config, modulePath, findings) {
  const segments = modulePath.split('/');
  let current = config.rootDir;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        findings.push(
          `${config.name}: published module ancestry must not contain a symlink: ${modulePath}`,
        );
        return;
      }
      if (index < segments.length - 1 && !stat.isDirectory()) {
        findings.push(
          `${config.name}: published module ancestry must contain only directories: ${modulePath}`,
        );
        return;
      }
      if (index === segments.length - 1 && !stat.isFile()) {
        findings.push(`${config.name}: published module must be a regular file: ${modulePath}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return;
    }
  }
}

function parsePublishedModule(module, source, findings) {
  const sourceFile = ts.createSourceFile(
    module,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  for (const diagnostic of sourceFile.parseDiagnostics) {
    const start = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    findings.push(
      `${module}:${start.line + 1}:${start.character + 1}: parse failure: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
  }

  const specifiers = [];
  let importsModuleLoader = false;
  const addSpecifier = (node, kind) => {
    if (!node || !ts.isStringLiteralLike(node)) return false;
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    specifiers.push({
      column: start.character + 1,
      kind,
      line: start.line + 1,
      text: node.text,
    });
    importsModuleLoader ||= node.text === 'node:module' || node.text === 'module';
    return true;
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier, 'import');
    } else if (ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier, 'export');
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (!addSpecifier(node.arguments[0], 'dynamic-import')) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push(
          `${module}:${start.line + 1}:${start.character + 1}: computed dynamic import has no resolvable module identity`,
        );
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push(
        `${module}:${start.line + 1}:${start.character + 1}: CommonJS require has no published ESM edge identity`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { importsModuleLoader, specifiers };
}

function resolvePublishedSpecifier({ from, imported, packageEntry, packagesByName }) {
  const specifier = imported.text;
  if (
    specifier === '' ||
    specifier.includes('\\') ||
    specifier.includes('?') ||
    specifier.includes('#')
  ) {
    return {
      kind: 'finding',
      message: `non-canonical module specifier ${JSON.stringify(specifier)}`,
    };
  }
  if (specifier.startsWith('.')) {
    const targetPath = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    if (!targetPath.startsWith('dist/') || !packageEntry.moduleSet.has(targetPath)) {
      return {
        kind: 'finding',
        message: `relative ESM edge ${JSON.stringify(specifier)} does not resolve in the exact packed file list`,
      };
    }
    return { kind: 'edge', target: moduleId(packageEntry.name, targetPath) };
  }
  if (
    specifier.startsWith('/') ||
    (/^[a-z][a-z+.-]*:/iu.test(specifier) && !specifier.startsWith('node:'))
  ) {
    return {
      kind: 'finding',
      message: `URL or absolute ESM edge is unsupported: ${JSON.stringify(specifier)}`,
    };
  }

  const targetPackage = [...packagesByName.values()].find(
    (entry) => specifier === entry.name || specifier.startsWith(`${entry.name}/`),
  );
  if (targetPackage === undefined) {
    if (specifier.startsWith('@kovojs/')) {
      return {
        kind: 'finding',
        message: `first-party ESM edge ${JSON.stringify(specifier)} names no packed Kovo package`,
      };
    }
    return { kind: 'external' };
  }

  const subpath =
    specifier === targetPackage.name ? '.' : `.${specifier.slice(targetPackage.name.length)}`;
  const target = resolveExportTarget(
    normalizePackageExports(targetPackage.publishExports)[subpath],
    {
      conditions: ['import', 'default'],
    },
  );
  const targetPath = typeof target === 'string' ? target.replace(/^\.\//u, '') : undefined;
  if (targetPath === undefined || !targetPackage.moduleSet.has(targetPath)) {
    return {
      kind: 'finding',
      message: `first-party ESM edge ${JSON.stringify(specifier)} has no exact published dist target`,
    };
  }
  return { kind: 'edge', target: moduleId(targetPackage.name, targetPath) };
}

function defaultPackageConfigs(rootDir) {
  return publicPackages()
    .filter((entry) => entry.name.startsWith('@kovojs/'))
    .map((entry) => {
      const packageRoot = path.join(rootDir, 'packages', entry.dir);
      const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
      return {
        name: entry.name,
        publishExports: manifest.publishConfig?.exports,
        rootDir: packageRoot,
      };
    });
}

function moduleId(packageName, modulePath) {
  return `${packageName}/${modulePath}`;
}

function probeError(findings) {
  return new Error(
    `Published module identity did not survive:\n  - ${[...new Set(findings)].sort(compareStrings).join('\n  - ')}`,
  );
}

function compareTuples(left, right) {
  return compareStrings(left[0], right[0]) || compareStrings(left[1], right[1]);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function main() {
  const report = probePublishedModuleIdentity();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    formatPublishedModuleIdentityReport(report, { includeEdges: process.argv.includes('--edges') }),
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
