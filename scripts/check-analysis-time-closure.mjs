#!/usr/bin/env node
import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { collectWorkspacePackageJsons, loadTcbManifest } from './check-tcb-boundary.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  lookupPnpmPackageIntegrity,
  packageSubjectFromSnapshotKey,
  parsePnpmPackageIntegrities,
  parsePnpmSnapshotDependencies,
  resolveSnapshotDependencyKeys,
  snapshotKeysForSubject,
} from './lib/pnpm-lock-packages.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const defaultManifestPath = 'security/TCB.md';
export const defaultLockfilePath = 'pnpm-lock.yaml';
export const analysisClosureSchema = 'kovo.security.analysis-time-closure/v1';
export const securityRatchetSchema = 'kovo.security.tcb-ratchet/v1';

const sourceExtensionPattern = /\.(?:[cm]?[jt]sx?|json)$/u;
const commandPackageByExecutable = new Map([
  ['esbuild', 'esbuild'],
  ['tsc', 'typescript'],
  ['vite-plus', 'vite-plus'],
  ['vitest', 'vitest'],
  ['vp', 'vite-plus'],
]);
const hostCommandExecutables = new Set([
  'bash',
  'cat',
  'env',
  'exit',
  'false',
  'node',
  'npm',
  'pnpm',
  'sh',
  'test',
  'true',
  '{',
  '}',
]);
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => (name.startsWith('node:') ? name : `node:${name}`)),
]);

export function checkAnalysisTimeClosure(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const manifestPath = options.manifestPath ?? defaultManifestPath;
  const lockfilePath = options.lockfilePath ?? defaultLockfilePath;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));
  const manifest = options.manifest ?? loadTcbManifest({ manifestPath, readText });
  const closure = manifest.analysisTimeClosure;
  const findings = validateClosureShape({ closure, manifestPath });
  findings.push(...validateSecurityRatchetShape({ manifest, manifestPath }));
  if (findings.length > 0) return result(findings);

  const previousManifest =
    options.previousManifest !== undefined
      ? options.previousManifest
      : loadPreviousTcbManifest({ manifestPath, root });
  if (previousManifest?.error) {
    findings.push(
      `${manifestPath}: security ratchet cannot load its comparison base: ${previousManifest.error}`,
    );
  } else if (previousManifest?.manifest?.securityRatchet) {
    findings.push(
      ...collectSecurityRatchetFindings({
        currentManifest: manifest,
        manifestPath,
        previousManifest: previousManifest.manifest,
      }),
    );
  }

  const packageJsonPaths = options.workspacePackageJsons ?? collectWorkspacePackageJsons(root);
  const workspace = loadWorkspaceManifests({ exists, packageJsonPaths, readText });
  findings.push(...workspace.findings);

  const discovered = discoverGateEntrypoints({
    compileEntrypoints: closure.compileEntrypoints,
    exists,
    rootManifest: workspace.byPath.get('package.json'),
    workspaceManifests: workspace.manifests,
  });
  findings.push(...discovered.findings);

  const graph = collectAnalysisImportGraph({
    entrypoints: discovered.entrypoints,
    exists,
    readText,
    workspacePackages: workspace.byName,
  });
  findings.push(...graph.findings);

  const records = dependencyRecords(manifest);
  findings.push(...records.findings);
  const rootRecords = [];
  const seenRootIds = new Set();
  for (const id of closure.roots) {
    if (seenRootIds.has(id)) findings.push(`${manifestPath}: duplicate analysis root id ${id}`);
    seenRootIds.add(id);
    const record = records.byId.get(id);
    if (!record) {
      findings.push(`${manifestPath}: analysis root ${id} does not name an enrolled dependency`);
      continue;
    }
    rootRecords.push(record);
  }

  const derivedRootNames = [
    ...new Set([...graph.externalPackages, ...discovered.commandPackages]),
  ].sort(compareText);
  const declaredRootNames = [...new Set(rootRecords.map((record) => record.dependency))].sort(
    compareText,
  );
  findings.push(
    ...exactSetFindings({
      actual: derivedRootNames,
      actualLabel: 'derived analysis root',
      expected: declaredRootNames,
      expectedLabel: 'manifest analysis root',
      manifestPath,
    }),
  );

  const declaredAcquisitions = new Map(
    closure.dynamicAcquisitions.map((entry) => [entry.id, entry]),
  );
  findings.push(
    ...exactSetFindings({
      actual: graph.dynamicAcquisitions.map((entry) => entry.id),
      actualLabel: 'derived dynamic acquisition',
      expected: [...declaredAcquisitions.keys()],
      expectedLabel: 'manifest dynamic acquisition',
      manifestPath,
    }),
  );

  let derivedSubjects = [];
  if (!exists(lockfilePath)) {
    findings.push(`${manifestPath}: analysisTimeClosure requires ${lockfilePath}`);
  } else {
    const lockfileText = readText(lockfilePath);
    const packageInventory = parsePnpmPackageIntegrities(lockfileText, { lockfilePath });
    const snapshotInventory = parsePnpmSnapshotDependencies(lockfileText, { lockfilePath });
    findings.push(...packageInventory.findings, ...snapshotInventory.findings);
    const derived = deriveTransitiveSubjects({
      packages: packageInventory.packages,
      roots: rootRecords,
      snapshots: snapshotInventory.snapshots,
    });
    findings.push(...derived.findings);
    derivedSubjects = derived.subjects;
  }

  findings.push(
    ...exactSetFindings({
      actual: derivedSubjects,
      actualLabel: 'derived closure subject',
      expected: closure.subjects,
      expectedLabel: 'manifest closure subject',
      manifestPath,
    }),
  );
  if (closure.maxPackageCount !== closure.subjects.length) {
    findings.push(
      `${manifestPath}: analysisTimeClosure.maxPackageCount ${closure.maxPackageCount} must equal the ${closure.subjects.length} enrolled closure subjects so shrinkage cannot leave slack`,
    );
  }
  if (derivedSubjects.length > closure.maxPackageCount) {
    findings.push(
      `${manifestPath}: analysis-time closure has ${derivedSubjects.length} subjects, over maxPackageCount ${closure.maxPackageCount}`,
    );
  }

  return result(findings, {
    dynamicAcquisitions: graph.dynamicAcquisitions,
    entrypoints: discovered.entrypoints,
    externalPackages: derivedRootNames,
    subjects: derivedSubjects,
  });
}

export function discoverGateEntrypoints({
  compileEntrypoints,
  exists,
  rootManifest,
  workspaceManifests,
}) {
  const findings = [];
  const entrypoints = new Set();
  const commandPackages = new Set();
  const scripts = [];
  const rootScripts = rootManifest?.scripts ?? {};
  const visitedRootScripts = new Set();
  const workspaceBins = collectWorkspaceBins({ exists, findings, workspaceManifests });

  const visitRootScript = (name) => {
    if (visitedRootScripts.has(name)) return;
    visitedRootScripts.add(name);
    const command = rootScripts[name];
    if (typeof command !== 'string') {
      findings.push(`package.json: referenced gate script ${name} is missing`);
      return;
    }
    scripts.push({ baseDir: '.', command, label: `package.json#${name}` });
    for (const referenced of referencedPackageScripts(command)) visitRootScript(referenced);
  };
  for (const name of Object.keys(rootScripts).filter(
    (name) => name === 'check' || name.startsWith('check:'),
  )) {
    visitRootScript(name);
  }

  for (const workspace of workspaceManifests) {
    if (workspace.path === 'package.json') continue;
    for (const [name, command] of Object.entries(workspace.manifest.scripts ?? {})) {
      if (name !== 'check' && !name.startsWith('check:')) continue;
      scripts.push({
        baseDir: path.posix.dirname(workspace.path),
        command,
        label: `${workspace.path}#${name}`,
      });
    }
  }

  for (const script of scripts) {
    for (const executable of invokedExecutables(script.command)) {
      const dependency = commandPackageByExecutable.get(executable);
      if (dependency) {
        commandPackages.add(dependency);
        continue;
      }
      const workspaceBin = workspaceBins.get(executable);
      if (workspaceBin) {
        entrypoints.add(workspaceBin);
        continue;
      }
      if (!hostCommandExecutables.has(executable)) {
        findings.push(
          `${script.label}: gate command executable ${executable} has no analysis-time package enrollment`,
        );
      }
    }
    for (const candidate of sourcePathCandidates(script.command)) {
      const relativePath = normalizeRepoPath(path.posix.join(script.baseDir, candidate));
      if (exists(relativePath)) entrypoints.add(relativePath);
    }
  }

  if (exists('vite.config.ts')) entrypoints.add('vite.config.ts');
  for (const entrypoint of compileEntrypoints) {
    if (!exists(entrypoint)) {
      findings.push(`security/TCB.md: compile entrypoint ${entrypoint} is missing`);
    } else {
      entrypoints.add(entrypoint);
    }
  }
  return {
    commandPackages: [...commandPackages].sort(compareText),
    entrypoints: [...entrypoints].sort(compareText),
    findings,
  };
}

export function collectAnalysisImportGraph({ entrypoints, exists, readText, workspacePackages }) {
  const findings = [];
  const files = new Set();
  const externalPackages = new Set();
  const dynamicAcquisitions = [];
  const queue = [...entrypoints];

  while (queue.length > 0) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    if (file.endsWith('.json')) continue;
    let text;
    try {
      text = readText(file);
    } catch {
      findings.push(`${file}: analysis import graph entry is unreadable`);
      continue;
    }
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file),
    );
    const references = collectModuleReferences(sourceFile);
    for (const acquisition of references.dynamicAcquisitions) {
      dynamicAcquisitions.push({
        ...acquisition,
        id: `${file}#${acquisition.kind}#${acquisition.expression}`,
      });
    }
    for (const specifier of references.specifiers) {
      if (builtins.has(specifier)) continue;
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const resolved = resolveLocalModule(file, specifier, exists);
        if (!resolved) {
          findings.push(`${file}: cannot resolve local analysis import ${specifier}`);
        } else if (!files.has(resolved)) {
          queue.push(resolved);
        }
        continue;
      }
      const dependency = dependencyName(specifier);
      if (specifier.startsWith('#')) {
        const resolved = resolvePackageImport(workspacePackages, file, specifier, exists);
        if (!resolved) {
          findings.push(`${file}: cannot resolve package analysis import ${specifier}`);
        } else if (!files.has(resolved)) {
          queue.push(resolved);
        }
        continue;
      }
      const workspace = workspacePackages.get(dependency);
      if (workspace) {
        const resolved = resolveWorkspaceModule(workspace, specifier, exists);
        if (!resolved) {
          findings.push(`${file}: cannot resolve workspace analysis import ${specifier}`);
        } else if (!files.has(resolved)) {
          queue.push(resolved);
        }
        continue;
      }
      if (!dependency || dependency.startsWith('#')) {
        findings.push(`${file}: unsupported analysis import specifier ${specifier}`);
      } else {
        externalPackages.add(dependency);
      }
    }
  }
  return {
    dynamicAcquisitions: dynamicAcquisitions.sort((left, right) => compareText(left.id, right.id)),
    externalPackages: [...externalPackages].sort(compareText),
    files: [...files].sort(compareText),
    findings,
  };
}

export function deriveTransitiveSubjects({ packages, roots, snapshots }) {
  const findings = [];
  const subjects = new Set();
  const visitedSnapshots = new Set();
  const queue = [];
  for (const root of roots) {
    const integrity = lookupPnpmPackageIntegrity(packages, root.dependency, root.pinnedVersion);
    if (integrity !== root.integrity) {
      findings.push(
        `${root.id}: root ${root.dependency}@${root.pinnedVersion} integrity ${root.integrity} does not match lockfile ${integrity ?? '<missing>'}`,
      );
    }
    const keys = snapshotKeysForSubject(snapshots, root.dependency, root.pinnedVersion);
    if (keys.length === 0) {
      findings.push(
        `${root.id}: lockfile has no snapshot for ${root.dependency}@${root.pinnedVersion}`,
      );
    }
    queue.push(...keys);
  }

  while (queue.length > 0) {
    const snapshotKey = queue.shift();
    if (visitedSnapshots.has(snapshotKey)) continue;
    visitedSnapshots.add(snapshotKey);
    const subject = packageSubjectFromSnapshotKey(snapshotKey);
    if (!subject) {
      findings.push(`pnpm-lock.yaml: cannot identify snapshot subject ${snapshotKey}`);
      continue;
    }
    const integrity = lookupPnpmPackageIntegrity(packages, subject.dependency, subject.version);
    if (!integrity) {
      findings.push(
        `pnpm-lock.yaml: ${snapshotKey} has no canonical packages resolution.integrity subject`,
      );
      continue;
    }
    subjects.add(subjectLabel(subject.dependency, subject.version, integrity));
    for (const [dependency, version] of snapshots.get(snapshotKey) ?? []) {
      const resolved = resolveSnapshotDependencyKeys(snapshots, dependency, version);
      if (resolved.length === 0) {
        findings.push(
          `pnpm-lock.yaml: ${snapshotKey} dependency ${dependency}@${version} has no exact snapshot`,
        );
      } else {
        queue.push(...resolved);
      }
    }
  }
  return { findings, subjects: [...subjects].sort(compareText) };
}

export function subjectLabel(dependency, version, integrity) {
  return `${dependency}@${version} ${integrity}`;
}

export function collectSecurityRatchetFindings({
  currentManifest,
  manifestPath = defaultManifestPath,
  previousManifest,
}) {
  const findings = [];
  const current = currentManifest.securityRatchet;
  const previous = previousManifest.securityRatchet;
  if (!current || !previous) return findings;
  const priorRaises = previous.reviewedRaises;
  const currentRaises = current.reviewedRaises;
  const prefix = currentRaises.slice(0, priorRaises.length);
  if (JSON.stringify(prefix) !== JSON.stringify(priorRaises)) {
    findings.push(`${manifestPath}: securityRatchet.reviewedRaises is append-only`);
    return findings;
  }

  const increased = Object.keys(current.limits).filter(
    (metric) => current.limits[metric] > previous.limits[metric],
  );
  if (increased.length === 0) {
    if (currentRaises.length !== priorRaises.length) {
      findings.push(
        `${manifestPath}: a reviewed-raise marker may only be appended with an actual ratchet increase`,
      );
    }
    return findings;
  }

  if (currentRaises.length !== priorRaises.length + 1) {
    findings.push(
      `${manifestPath}: ratchet increase for ${increased.join(', ')} requires exactly one appended reviewed-raise marker`,
    );
    return findings;
  }
  const marker = currentRaises.at(-1);
  for (const field of ['id', 'reason', 'review']) {
    if (typeof marker?.[field] !== 'string' || marker[field] === '') {
      findings.push(`${manifestPath}: reviewed-raise marker ${field} must be a non-empty string`);
    }
  }
  if (JSON.stringify(marker?.from) !== JSON.stringify(previous.limits)) {
    findings.push(
      `${manifestPath}: reviewed-raise marker from must equal the previous ratchet limits`,
    );
  }
  if (JSON.stringify(marker?.to) !== JSON.stringify(current.limits)) {
    findings.push(
      `${manifestPath}: reviewed-raise marker to must equal the current ratchet limits`,
    );
  }
  return findings;
}

function validateClosureShape({ closure, manifestPath }) {
  const findings = [];
  if (!closure || typeof closure !== 'object') {
    return [`${manifestPath}: analysisTimeClosure must be an object`];
  }
  if (closure.schema !== analysisClosureSchema) {
    findings.push(`${manifestPath}: analysisTimeClosure.schema must be ${analysisClosureSchema}`);
  }
  for (const field of ['compileEntrypoints', 'roots', 'subjects', 'dynamicAcquisitions']) {
    if (!Array.isArray(closure[field])) {
      findings.push(`${manifestPath}: analysisTimeClosure.${field} must be an array`);
    }
  }
  if (!Number.isInteger(closure.maxPackageCount) || closure.maxPackageCount < 0) {
    findings.push(
      `${manifestPath}: analysisTimeClosure.maxPackageCount must be a non-negative integer`,
    );
  }
  if (findings.length > 0) return findings;
  for (const field of ['compileEntrypoints', 'roots', 'subjects']) {
    for (const value of closure[field]) {
      if (typeof value !== 'string' || value === '') {
        findings.push(
          `${manifestPath}: analysisTimeClosure.${field} entries must be non-empty strings`,
        );
      }
    }
    if (!isSortedUnique(closure[field])) {
      findings.push(`${manifestPath}: analysisTimeClosure.${field} must be sorted and unique`);
    }
  }
  for (const entry of closure.dynamicAcquisitions) {
    if (typeof entry?.id !== 'string' || entry.id === '') {
      findings.push(`${manifestPath}: dynamic acquisition id must be a non-empty string`);
    }
    if (typeof entry?.reason !== 'string' || entry.reason === '') {
      findings.push(
        `${manifestPath}: dynamic acquisition ${entry?.id ?? '<unknown>'} needs a reason`,
      );
    }
  }
  if (!isSortedUnique(closure.dynamicAcquisitions.map((entry) => entry.id))) {
    findings.push(
      `${manifestPath}: analysisTimeClosure.dynamicAcquisitions must be sorted and unique`,
    );
  }
  return findings;
}

function validateSecurityRatchetShape({ manifest, manifestPath }) {
  const findings = [];
  const ratchet = manifest.securityRatchet;
  if (!ratchet || typeof ratchet !== 'object') {
    return [`${manifestPath}: securityRatchet must be an object`];
  }
  if (ratchet.schema !== securityRatchetSchema) {
    findings.push(`${manifestPath}: securityRatchet.schema must be ${securityRatchetSchema}`);
  }
  if (!ratchet.limits || typeof ratchet.limits !== 'object') {
    findings.push(`${manifestPath}: securityRatchet.limits must be an object`);
    return findings;
  }
  for (const metric of ['analysisClosureSize', 'entryCount', 'totalTcbMaxLines']) {
    if (!Number.isInteger(ratchet.limits[metric]) || ratchet.limits[metric] < 0) {
      findings.push(
        `${manifestPath}: securityRatchet.limits.${metric} must be a non-negative integer`,
      );
    }
  }
  if (!Array.isArray(ratchet.reviewedRaises)) {
    findings.push(`${manifestPath}: securityRatchet.reviewedRaises must be an array`);
  }
  if (findings.length > 0) return findings;
  const expected = {
    analysisClosureSize: manifest.analysisTimeClosure.maxPackageCount,
    entryCount: manifest.entries.length,
    totalTcbMaxLines: manifest.budgets.totalTcbMaxLines,
  };
  for (const [metric, value] of Object.entries(expected)) {
    if (ratchet.limits[metric] !== value) {
      findings.push(
        `${manifestPath}: securityRatchet.limits.${metric} ${ratchet.limits[metric]} must equal current ${value} so shrinkage cannot leave slack`,
      );
    }
  }
  return findings;
}

function loadPreviousTcbManifest({ manifestPath, root }) {
  try {
    const dirty = execFileSync('git', ['diff', '--quiet', 'HEAD', '--', manifestPath], {
      cwd: root,
      stdio: 'ignore',
    });
    void dirty;
    return {
      manifest: parseTcbManifestText(
        execFileSync('git', ['show', `HEAD^:${manifestPath}`], { cwd: root, encoding: 'utf8' }),
      ),
    };
  } catch (error) {
    if (error?.status === 1) {
      try {
        return {
          manifest: parseTcbManifestText(
            execFileSync('git', ['show', `HEAD:${manifestPath}`], { cwd: root, encoding: 'utf8' }),
          ),
        };
      } catch (headError) {
        return { error: stableProcessError(headError) };
      }
    }
    return { error: stableProcessError(error) };
  }
}

function parseTcbManifestText(text) {
  const match = text.match(/```json tcb-manifest\s*\n([\s\S]*?)\n```/u);
  if (!match) throw new Error('comparison manifest has no tcb-manifest fence');
  return JSON.parse(match[1]);
}

function stableProcessError(error) {
  return typeof error?.message === 'string' ? error.message.split('\n')[0] : String(error);
}

function loadWorkspaceManifests({ exists, packageJsonPaths, readText }) {
  const findings = [];
  const manifests = [];
  const byName = new Map();
  const byPath = new Map();
  for (const packageJson of packageJsonPaths) {
    if (!exists(packageJson)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readText(packageJson));
    } catch {
      findings.push(`${packageJson}: workspace package manifest is not valid JSON`);
      continue;
    }
    const row = { manifest, path: packageJson };
    manifests.push(row);
    byPath.set(packageJson, manifest);
    if (typeof manifest.name === 'string') {
      if (byName.has(manifest.name))
        findings.push(`${packageJson}: duplicate workspace name ${manifest.name}`);
      byName.set(manifest.name, row);
    }
  }
  return { byName, byPath, findings, manifests };
}

function dependencyRecords(manifest) {
  const findings = [];
  const byId = new Map();
  for (const bucket of [
    manifest.analysisToolchain ?? [],
    manifest.analysisDependencies ?? [],
    manifest.trustedDependencySurfaces ?? [],
  ]) {
    for (const record of bucket) {
      const existing = byId.get(record.id);
      if (existing)
        findings.push(`security/TCB.md: duplicate dependency enrollment id ${record.id}`);
      byId.set(record.id, record);
    }
  }
  return { byId, findings };
}

function collectModuleReferences(sourceFile) {
  const specifiers = [];
  const dynamicAcquisitions = [];
  const loaderBindings = collectLoaderBindings(sourceFile);
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      if (!runtimeImportClause(node.importClause)) return;
      addLiteral(node.moduleSpecifier);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) addLiteral(node.moduleSpecifier);
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        addLiteral(node.moduleReference.expression);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const kind =
        node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? 'import'
          : moduleLoaderCallKind(node.expression, loaderBindings);
      if (!kind) {
        ts.forEachChild(node, visit);
        return;
      }
      const argument = node.arguments[0];
      if (node.arguments.length === 1 && argument && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      } else {
        dynamicAcquisitions.push({
          expression: normalizeExpression(node.getText(sourceFile)),
          kind,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { dynamicAcquisitions, specifiers };
}

function collectLoaderBindings(sourceFile) {
  const createRequire = new Set();
  const moduleNamespaces = new Set();
  const require = new Set(['require']);
  const findImports = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'node:module'
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) moduleNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName?.text ?? element.name.text) === 'createRequire') {
            createRequire.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, findImports);
  };
  findImports(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    const findAliases = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const name = node.name.text;
        if (ts.isIdentifier(node.initializer) && createRequire.has(node.initializer.text)) {
          if (!createRequire.has(name)) {
            createRequire.add(name);
            changed = true;
          }
        } else if (
          ts.isCallExpression(node.initializer) &&
          isCreateRequireCallee(node.initializer.expression, createRequire, moduleNamespaces)
        ) {
          if (!require.has(name)) {
            require.add(name);
            changed = true;
          }
        } else if (ts.isIdentifier(node.initializer) && require.has(node.initializer.text)) {
          if (!require.has(name)) {
            require.add(name);
            changed = true;
          }
        }
      }
      ts.forEachChild(node, findAliases);
    };
    findAliases(sourceFile);
  }
  return { createRequire, moduleNamespaces, require };
}

function moduleLoaderCallKind(expression, bindings) {
  if (ts.isIdentifier(expression) && bindings.require.has(expression.text)) return 'require';
  if (
    ts.isCallExpression(expression) &&
    isCreateRequireCallee(expression.expression, bindings.createRequire, bindings.moduleNamespaces)
  ) {
    return 'require';
  }
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'resolve') {
    return undefined;
  }
  if (isImportMeta(expression.expression)) return 'import.resolve';
  if (ts.isIdentifier(expression.expression) && bindings.require.has(expression.expression.text)) {
    return 'require.resolve';
  }
  if (
    ts.isCallExpression(expression.expression) &&
    isCreateRequireCallee(
      expression.expression.expression,
      bindings.createRequire,
      bindings.moduleNamespaces,
    )
  ) {
    return 'require.resolve';
  }
  const receiver = expression.expression.getText();
  return /(?:require|resolver)/iu.test(receiver) ? 'require.resolve' : undefined;
}

function isCreateRequireCallee(expression, createRequire, moduleNamespaces) {
  if (ts.isIdentifier(expression)) return createRequire.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'createRequire' &&
    ts.isIdentifier(expression.expression) &&
    moduleNamespaces.has(expression.expression.text)
  );
}

function isImportMeta(node) {
  return (
    ts.isMetaProperty(node) &&
    node.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === 'meta'
  );
}

function runtimeImportClause(clause) {
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings) return true;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function resolveLocalModule(importer, specifier, exists) {
  if (specifier.startsWith('/')) return undefined;
  const base = normalizeRepoPath(path.posix.join(path.posix.dirname(importer), specifier));
  return resolveCandidate(base, exists);
}

function resolveWorkspaceModule(workspace, specifier, exists) {
  const dependency = workspace.manifest.name;
  const suffix = specifier.slice(dependency.length);
  const subpath = suffix === '' ? '.' : `.${suffix}`;
  const target = exportTarget(workspace.manifest.exports?.[subpath]);
  if (!target) return undefined;
  return resolveCandidate(
    normalizeRepoPath(path.posix.join(path.posix.dirname(workspace.path), target)),
    exists,
  );
}

function resolvePackageImport(workspacePackages, importer, specifier, exists) {
  const workspaces = [...workspacePackages.values()]
    .map((workspace) => ({
      ...workspace,
      dir: path.posix.dirname(workspace.path),
    }))
    .filter((workspace) => importer.startsWith(`${workspace.dir}/`))
    .sort((left, right) => right.dir.length - left.dir.length);
  const workspace = workspaces[0];
  if (!workspace) return undefined;
  const target = exportTarget(workspace.manifest.imports?.[specifier]);
  if (!target) return undefined;
  return resolveCandidate(normalizeRepoPath(path.posix.join(workspace.dir, target)), exists);
}

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  for (const condition of ['source', 'import', 'node', 'default', 'types']) {
    const target = exportTarget(value[condition]);
    if (target) return target;
  }
  return undefined;
}

function resolveCandidate(candidate, exists) {
  const clean = candidate.replace(/[?#].*$/u, '');
  if (
    path.posix.isAbsolute(clean) ||
    clean === '..' ||
    clean.startsWith('../') ||
    clean.includes('/../')
  ) {
    return undefined;
  }
  const extension = path.posix.extname(clean);
  const candidates = [clean];
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    const stem = clean.slice(0, -extension.length);
    const sourceExtensions =
      extension === '.jsx'
        ? ['.tsx', '.ts']
        : extension === '.mjs'
          ? ['.mts', '.ts']
          : extension === '.cjs'
            ? ['.cts', '.ts']
            : ['.ts', '.tsx'];
    candidates.unshift(...sourceExtensions.map((sourceExtension) => `${stem}${sourceExtension}`));
  }
  if (extension === '') {
    candidates.push(
      ...['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.cjs', '.json'].map(
        (sourceExtension) => `${clean}${sourceExtension}`,
      ),
      ...['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.cjs', '.json'].map(
        (sourceExtension) => `${clean}/index${sourceExtension}`,
      ),
    );
  }
  return candidates.find((value) => exists(value));
}

function sourcePathCandidates(command) {
  const matches = command.match(/[A-Za-z0-9_@./-]+\.(?:[cm]?[jt]sx?|json)/gu) ?? [];
  return matches
    .map((value) => value.replace(/^\.\//u, ''))
    .filter((value) => sourceExtensionPattern.test(value));
}

function invokedExecutables(command) {
  return command
    .split(/\s*(?:&&|\|\||;|\|)\s*/u)
    .map((segment) => segment.trim().split(/\s+/u))
    .flatMap((rawTokens) => {
      const tokens = rawTokens.filter((token) => !token.includes('='));
      const executable = tokens[0];
      if (!executable) return [];
      const nested = nestedExecExecutable(tokens);
      return nested ? [executable, nested] : [executable];
    })
    .map((token) => path.posix.basename(token));
}

function nestedExecExecutable(tokens) {
  if (!['pnpm', 'vp'].includes(tokens[0])) return undefined;
  const execIndex = tokens.indexOf('exec');
  if (execIndex === -1) return undefined;
  return tokens.slice(execIndex + 1).find((token) => token !== '--' && !token.startsWith('-'));
}

function collectWorkspaceBins({ exists, findings, workspaceManifests }) {
  const bins = new Map();
  for (const workspace of workspaceManifests) {
    const declared = workspace.manifest.bin;
    const entries =
      typeof declared === 'string'
        ? [[workspace.manifest.name?.replace(/^@[^/]+\//u, ''), declared]]
        : Object.entries(declared ?? {});
    for (const [name, target] of entries) {
      if (typeof name !== 'string' || name === '' || typeof target !== 'string') continue;
      const resolved = resolveCandidate(
        normalizeRepoPath(path.posix.join(path.posix.dirname(workspace.path), target)),
        exists,
      );
      if (!resolved) {
        findings.push(`${workspace.path}: workspace bin ${name} target ${target} is missing`);
        continue;
      }
      if (bins.has(name) && bins.get(name) !== resolved) {
        findings.push(`${workspace.path}: workspace bin ${name} has multiple source targets`);
        continue;
      }
      bins.set(name, resolved);
    }
  }
  return bins;
}

function referencedPackageScripts(command) {
  return [...command.matchAll(/\b(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)/gu)].map(
    (match) => match[1],
  );
}

function dependencyName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function scriptKind(file) {
  if (/\.tsx$/u.test(file)) return ts.ScriptKind.TSX;
  if (/\.(?:jsx|js|mjs|cjs)$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function normalizeExpression(expression) {
  return expression.replace(/\s+/gu, ' ').trim();
}

function normalizeRepoPath(value) {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function exactSetFindings({ actual, actualLabel, expected, expectedLabel, manifestPath }) {
  const findings = [];
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const value of [...actualSet].sort(compareText)) {
    if (!expectedSet.has(value))
      findings.push(`${manifestPath}: ${actualLabel} is not enrolled: ${value}`);
  }
  for (const value of [...expectedSet].sort(compareText)) {
    if (!actualSet.has(value)) findings.push(`${manifestPath}: stale ${expectedLabel}: ${value}`);
  }
  return findings;
}

function isSortedUnique(values) {
  return values.every((value, index) => index === 0 || compareText(values[index - 1], value) < 0);
}

function compareText(left, right) {
  return left.localeCompare(right, 'en');
}

function result(findings, details = {}) {
  return {
    ...details,
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK ${details.entrypoints?.length ?? 0} gate/compile roots close over ${details.subjects?.length ?? 0} integrity-pinned package subjects`
        : `${findings.length} analysis-time closure violation(s)`,
  };
}

export function main(options = {}) {
  const check = checkAnalysisTimeClosure(options);
  process.stdout.write(`check-analysis-time-closure/v1 ${check.summary}\n`);
  for (const finding of check.findings) process.stderr.write(`${finding}\n`);
  return check.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);
