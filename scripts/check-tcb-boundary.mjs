#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectFiles, collectSourceFiles, productionSourceRoots } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();
export const defaultManifestPath = 'security/TCB.md';
export const tcbClassification = 'tcb';
export const generatedTemplateRoots = ['packages/create-kovo/templates'];
export const legacyGeneratedTemplateDecisionFiles = new Set([
  'packages/create-kovo/templates/src/_kovo/app-runtime-db.sqlite.ts',
  'packages/create-kovo/templates/src/_kovo/app-runtime-db.ts',
]);
export const allowedClassifications = new Set([
  tcbClassification,
  'advisory-static-classifier',
  'delegating-wire-emitter',
  'inventory-classifier',
]);

const wrapperKindByName = {
  securityClassifier: 'classifier',
  wireEmitter: 'wire-emitter',
};

export function checkTcbBoundary(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const manifestPath = options.manifestPath ?? defaultManifestPath;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));
  const sourceFiles =
    options.sourceFiles ??
    collectTcbBoundarySourceFiles(root, {
      sourceRoots: options.sourceRoots,
      productionRoots: options.productionRoots,
      templateRoots: options.templateRoots,
    });

  const findings = [];
  const manifest = loadTcbManifest({ manifestPath, readText });
  findings.push(...validateManifestShape(manifest, manifestPath));
  if (findings.length > 0) return result(findings);

  const entries = manifest.entries;
  const plannedEntries = manifest.plannedEntries ?? [];
  const byFileAndName = new Map();
  const seenIds = new Set();
  let totalTcbLines = 0;
  const declarationsByFile = new Map();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      findings.push(`${manifestPath}: duplicate TCB manifest id ${entry.id}`);
    }
    seenIds.add(entry.id);

    const key = entryKey(entry.file, entry.name);
    if (byFileAndName.has(key)) {
      findings.push(
        `${manifestPath}: duplicate TCB manifest declaration ${entry.file}#${entry.name}`,
      );
    }
    byFileAndName.set(key, entry);

    if (!exists(entry.file)) {
      findings.push(`${entry.file}: TCB manifest entry ${entry.name} file is missing`);
      continue;
    }

    let declarations = declarationsByFile.get(entry.file);
    if (!declarations) {
      declarations = collectDeclarations(entry.file, readText(entry.file));
      declarationsByFile.set(entry.file, declarations);
    }

    const declaration = declarations.get(entry.name);
    if (!declaration) {
      findings.push(`${entry.file}: TCB manifest entry ${entry.name} declaration is missing`);
      continue;
    }

    if (entry.wrapper !== undefined) {
      if (declaration.wrapper !== entry.wrapper) {
        findings.push(
          `${entry.file}:${declaration.line}: ${entry.name} manifest expects ${entry.wrapper}() but found ${declaration.wrapper ?? 'an unwrapped declaration'}`,
        );
      }
      if (entry.decision !== undefined && declaration.decision !== entry.decision) {
        findings.push(
          `${entry.file}:${declaration.line}: ${entry.name} manifest expects decision ${entry.decision} but found ${declaration.decision ?? '<none>'}`,
        );
      }
    }

    if (entry.classification !== tcbClassification) continue;
    if (!Number.isInteger(entry.lineBudget) || entry.lineBudget <= 0) {
      findings.push(`${manifestPath}: ${entry.id} is TCB but has no positive integer lineBudget`);
      continue;
    }
    if (entry.lineBudget > manifest.budgets.entryMaxLines) {
      findings.push(
        `${manifestPath}: ${entry.id} lineBudget ${entry.lineBudget} exceeds entryMaxLines ${manifest.budgets.entryMaxLines}`,
      );
    }
    if (declaration.lineCount > entry.lineBudget) {
      findings.push(
        `${entry.file}:${declaration.line}: ${entry.name} spans ${declaration.lineCount} line(s), over manifest budget ${entry.lineBudget}`,
      );
    }
    totalTcbLines += declaration.lineCount;
  }

  if (totalTcbLines > manifest.budgets.totalTcbMaxLines) {
    findings.push(
      `${manifestPath}: TCB spans ${totalTcbLines} line(s), over total budget ${manifest.budgets.totalTcbMaxLines}`,
    );
  }

  for (const wrapped of collectWrappedSecurityDecisions({ exists, readText, sourceFiles })) {
    const entry = byFileAndName.get(entryKey(wrapped.file, wrapped.name));
    if (!entry) {
      findings.push(
        `${wrapped.file}:${wrapped.line}: ${wrapped.name} uses ${wrapped.wrapper}() but is not listed in ${manifestPath}`,
      );
      continue;
    }
    if (entry.wrapper !== wrapped.wrapper) {
      findings.push(
        `${wrapped.file}:${wrapped.line}: ${wrapped.name} manifest classification must list wrapper ${wrapped.wrapper}()`,
      );
    }
    if (entry.decision !== wrapped.decision) {
      findings.push(
        `${wrapped.file}:${wrapped.line}: ${wrapped.name} manifest decision ${entry.decision ?? '<none>'} does not match ${wrapped.decision ?? '<none>'}`,
      );
    }
  }

  findings.push(
    ...collectPlannedEntryEnrollmentFindings({
      byFileAndName,
      exists,
      plannedEntries,
      readText,
    }),
  );

  findings.push(
    ...collectGeneratedTemplateBoundaryFindings({
      allowedLegacyDecisionFiles:
        options.allowedLegacyTemplateDecisionFiles ?? legacyGeneratedTemplateDecisionFiles,
      exists,
      readText,
      sourceFiles,
      templateRoots: options.templateRoots ?? generatedTemplateRoots,
    }),
  );

  return result(findings, totalTcbLines);
}

export function collectTcbBoundarySourceFiles(root, options = {}) {
  const roots = options.sourceRoots ?? productionSourceRoots;
  const sourceFiles = collectSourceFiles(root, roots, {
    productionRoots: options.productionRoots ?? roots,
  });
  const templateFiles = collectFiles(root, options.templateRoots ?? generatedTemplateRoots, {
    includeFile: ({ relativePath }) =>
      /\.[cm]?tsx?$/u.test(relativePath) &&
      !relativePath.endsWith('.d.ts') &&
      !/\.(?:test|spec)\.[cm]?tsx?$/u.test(relativePath),
  });
  return [...new Set([...sourceFiles, ...templateFiles])].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function loadTcbManifest({ manifestPath = defaultManifestPath, readText } = {}) {
  const text = readText(manifestPath);
  const match = text.match(/```json tcb-manifest\s*\n([\s\S]*?)\n```/u);
  if (!match) {
    throw new Error(`${manifestPath}: missing \`\`\`json tcb-manifest fenced manifest`);
  }
  return JSON.parse(match[1]);
}

export function collectDeclarations(fileName, text) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map();

  const record = (name, node, extra = {}) => {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const current = declarations.get(name);
    if (current?.hasBody && !extra.hasBody) return;
    declarations.set(name, {
      ...extra,
      line: start,
      lineCount: end - start + 1,
    });
  };

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      record(node.name.text, node, {
        declarationKind: 'function',
        hasBody: node.body !== undefined,
      });
      return;
    }
    if (ts.isClassDeclaration(node) && node.name) {
      record(node.name.text, node, { declarationKind: 'class', hasBody: true });
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const wrapped = wrappedInitializer(node.initializer);
      record(node.name.text, node, {
        declarationKind: 'const',
        decision: wrapped?.decision,
        hasBody: true,
        wrapper: wrapped?.wrapper,
        wrapperKind: wrapped?.kind,
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

export function collectWrappedSecurityDecisions({ exists, readText, sourceFiles }) {
  const wrapped = [];
  for (const file of sourceFiles) {
    if (!exists(file)) continue;
    const text = readText(file);
    if (!text.includes('securityClassifier') && !text.includes('wireEmitter')) continue;
    const declarations = collectDeclarations(file, text);
    for (const [name, declaration] of declarations.entries()) {
      if (declaration.wrapper === undefined) continue;
      wrapped.push({
        decision: declaration.decision,
        file,
        line: declaration.line,
        name,
        wrapper: declaration.wrapper,
        wrapperKind: declaration.wrapperKind,
      });
    }
  }
  return wrapped.sort((left, right) =>
    `${left.file}\0${left.name}`.localeCompare(`${right.file}\0${right.name}`),
  );
}

export function collectGeneratedTemplateBoundaryFindings({
  allowedLegacyDecisionFiles = legacyGeneratedTemplateDecisionFiles,
  exists,
  readText,
  sourceFiles,
  templateRoots = generatedTemplateRoots,
}) {
  const findings = [];
  const allowedLegacyFiles = new Set(allowedLegacyDecisionFiles);
  for (const file of sourceFiles) {
    if (!isGeneratedTemplateFile(file, templateRoots)) continue;
    if (!exists(file)) continue;
    const text = readText(file);
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const violations = generatedTemplateSecurityDecisionUses(sourceFile);
    if (violations.length === 0) continue;
    if (allowedLegacyFiles.has(file)) continue;
    for (const violation of violations) {
      findings.push(
        `${file}:${violation.line}: generated templates may only wire framework-provided security metadata/chokes; ${violation.label} belongs in a manifested framework TCB entry`,
      );
    }
  }
  return findings;
}

export function main(options = {}) {
  const check = checkTcbBoundary(options);
  process.stdout.write(`check-tcb-boundary/v1 ${check.summary}\n`);
  for (const finding of check.findings) process.stderr.write(`${finding}\n`);
  return check.ok;
}

function validateManifestShape(manifest, manifestPath) {
  const findings = [];
  if (manifest?.schema !== 'kovo.security.tcb/v1') {
    findings.push(`${manifestPath}: schema must be kovo.security.tcb/v1`);
  }
  if (!manifest?.budgets || !Number.isInteger(manifest.budgets.entryMaxLines)) {
    findings.push(`${manifestPath}: budgets.entryMaxLines must be an integer`);
  }
  if (!manifest?.budgets || !Number.isInteger(manifest.budgets.totalTcbMaxLines)) {
    findings.push(`${manifestPath}: budgets.totalTcbMaxLines must be an integer`);
  }
  if (!Array.isArray(manifest?.entries)) {
    findings.push(`${manifestPath}: entries must be an array`);
    return findings;
  }
  const plannedEntries = Array.isArray(manifest?.plannedEntries) ? manifest.plannedEntries : [];
  if (manifest?.plannedEntries !== undefined && !Array.isArray(manifest.plannedEntries)) {
    findings.push(`${manifestPath}: plannedEntries must be an array when present`);
  }

  for (const [index, entry] of manifest.entries.entries()) {
    const label = typeof entry?.id === 'string' ? entry.id : `entries[${index}]`;
    for (const field of ['id', 'file', 'name', 'kind', 'classification']) {
      if (typeof entry?.[field] !== 'string' || entry[field] === '') {
        findings.push(`${manifestPath}: ${label}.${field} must be a non-empty string`);
      }
    }
    if (
      typeof entry?.classification === 'string' &&
      !allowedClassifications.has(entry.classification)
    ) {
      findings.push(
        `${manifestPath}: ${label}.classification ${entry.classification} is not recognized`,
      );
    }
    if (entry?.wrapper !== undefined && !Object.hasOwn(wrapperKindByName, entry.wrapper)) {
      findings.push(`${manifestPath}: ${label}.wrapper ${entry.wrapper} is not recognized`);
    }
  }
  for (const [index, entry] of plannedEntries.entries()) {
    const label = typeof entry?.id === 'string' ? entry.id : `plannedEntries[${index}]`;
    for (const field of ['id', 'file', 'name', 'kind', 'classification']) {
      if (typeof entry?.[field] !== 'string' || entry[field] === '') {
        findings.push(`${manifestPath}: ${label}.${field} must be a non-empty string`);
      }
    }
    if (
      typeof entry?.classification === 'string' &&
      !allowedClassifications.has(entry.classification)
    ) {
      findings.push(
        `${manifestPath}: ${label}.classification ${entry.classification} is not recognized`,
      );
    }
    if (entry?.wrapper !== undefined && !Object.hasOwn(wrapperKindByName, entry.wrapper)) {
      findings.push(`${manifestPath}: ${label}.wrapper ${entry.wrapper} is not recognized`);
    }
  }
  return findings;
}

function collectPlannedEntryEnrollmentFindings({
  byFileAndName,
  exists,
  plannedEntries,
  readText,
}) {
  const findings = [];
  const declarationsByFile = new Map();
  for (const entry of plannedEntries) {
    const key = entryKey(entry.file, entry.name);
    if (byFileAndName.has(key)) continue;
    if (!exists(entry.file)) continue;
    let declarations = declarationsByFile.get(entry.file);
    if (!declarations) {
      declarations = collectDeclarations(entry.file, readText(entry.file));
      declarationsByFile.set(entry.file, declarations);
    }
    const declaration = declarations.get(entry.name);
    if (!declaration) continue;
    findings.push(
      `${entry.file}:${declaration.line}: planned TCB entry ${entry.id} declaration ${entry.name} exists but is still only reserved in plannedEntries; move it to entries with a lineBudget before using it as a choke`,
    );
  }
  return findings;
}

function wrappedInitializer(initializer) {
  const call = unwrapCall(initializer);
  if (!call) return undefined;
  const wrapper = callWrapperName(call);
  if (!wrapper) return undefined;
  return {
    decision: stringLiteralArgument(call, 0),
    kind: wrapperKindByName[wrapper],
    wrapper,
  };
}

function unwrapCall(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current && ts.isCallExpression(current) ? current : undefined;
}

function callWrapperName(call) {
  const expression = call.expression;
  if (!ts.isIdentifier(expression)) return undefined;
  return Object.hasOwn(wrapperKindByName, expression.text) ? expression.text : undefined;
}

function stringLiteralArgument(call, index) {
  const argument = call.arguments[index];
  return argument && ts.isStringLiteral(argument) ? argument.text : undefined;
}

function isGeneratedTemplateFile(file, templateRoots) {
  return templateRoots.some((root) => file.startsWith(`${root.replace(/\/$/u, '')}/`));
}

function generatedTemplateSecurityDecisionUses(sourceFile) {
  const violations = [];
  const record = (node, label) => {
    violations.push({
      label,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  };
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@kovojs/core/internal/security-markers'
    ) {
      record(node, 'security marker import');
      return;
    }
    if (ts.isCallExpression(node)) {
      const wrapper = callWrapperName(node);
      if (wrapper) record(node, `${wrapper}() security decision wrapper`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function entryKey(file, name) {
  return `${file}#${name}`;
}

function result(findings, totalTcbLines = 0) {
  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK TCB manifest declarations and wrapper classifications fit budget (${totalTcbLines} TCB lines)`
        : `${findings.length} TCB boundary violation(s)`,
  };
}

if (isMainEntry(import.meta.url)) await runGate(main);
