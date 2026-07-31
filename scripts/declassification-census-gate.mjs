#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const declassificationCensusPath = 'security/declassification-census.json';
export const declassificationCensusSchema = 'kovo-declassification-census/v1';

export const DECLASSIFICATION_DOORS = Object.freeze([
  '.reveal',
  'publishToClient',
  'revealSecret',
  'revealUntrusted',
  'serverValue',
  'trustedAssign',
  'trustedReveal',
]);

const declassificationSourceScope = Object.freeze({
  excluded: Object.freeze(['docs', 'generated-output', 'tests']),
  policy: 'kovo-authored-production-js-source/v1',
  roots: Object.freeze(['examples', 'packages']),
});
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const excludedDirectoryPattern =
  /(?:^|\/)(?:__fixtures__|coverage|dist|fixtures?|generated|node_modules|test|tests)(?:\/|$)/u;
const excludedFilePattern =
  /(?:\.(?:bench|spec|test)\.[^.]+$|(?:^|[.-])test-support(?:[.-]|$)|\.generated\.[^.]+$|\.d\.ts$)/u;
const authoritativeLocalDoors = Object.freeze({
  'packages/core/src/secret.ts': Object.freeze(
    new Set(['publishToClient', 'revealSecret', 'revealUntrusted', 'trustedReveal']),
  ),
  'packages/server/src/write-governance.ts': Object.freeze(
    new Set(['serverValue', 'trustedAssign']),
  ),
});
const coreDoorExports = Object.freeze(
  new Set(['publishToClient', 'revealSecret', 'revealUntrusted', 'trustedReveal']),
);
const serverDoorExports = Object.freeze(new Set(['serverValue', 'trustedAssign']));
const packageDoorExports = Object.freeze({
  '@kovojs/core': coreDoorExports,
  '@kovojs/core/security': coreDoorExports,
  '@kovojs/server': serverDoorExports,
  '@kovojs/server/write-safety': serverDoorExports,
});

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedNodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/gu, ' ').trim();
}

function scriptKind(file) {
  if (file.endsWith('.tsx') || file.endsWith('.jsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function moduleText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function doorBinding(moduleName, exportName) {
  if (!packageDoorExports[moduleName]?.has(exportName)) return undefined;
  return {
    door: exportName,
    identity: `import:${moduleName}#${exportName}`,
    kind: 'door',
  };
}

function scopeDepth(scope) {
  let depth = 0;
  for (let current = scope; current; current = current.parent) depth += 1;
  return depth;
}

function scopeContains(scope, node) {
  for (let current = node; current; current = current.parent) {
    if (current === scope) return true;
  }
  return false;
}

function nearestBlockScope(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isBlock(current) || ts.isSourceFile(current)) return current;
  }
  return node.getSourceFile();
}

function nearestFunctionScope(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
  }
  return node.getSourceFile();
}

function variableScope(node) {
  const declarationList = node.parent;
  return declarationList.flags & ts.NodeFlags.BlockScoped
    ? nearestBlockScope(node)
    : nearestFunctionScope(node);
}

function declarationScope(node) {
  const parent = node.parent;
  if (ts.isParameter(parent)) return parent.parent;
  if (ts.isVariableDeclaration(parent)) return variableScope(parent);
  if (
    ts.isFunctionDeclaration(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isEnumDeclaration(parent)
  ) {
    return parent.parent;
  }
  if (ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent)) {
    return node.getSourceFile();
  }
  if (ts.isBindingElement(parent)) {
    const declaration = bindingOwner(parent);
    if (declaration && ts.isVariableDeclaration(declaration)) return variableScope(declaration);
    if (declaration && ts.isParameter(declaration)) return declaration.parent;
  }
  if (ts.isCatchClause(parent)) return parent.block;
  return nearestBlockScope(node);
}

function bindingOwner(node) {
  let current = node;
  while (current.parent && (ts.isBindingElement(current) || ts.isBindingPattern(current.parent))) {
    current = current.parent;
  }
  return current.parent;
}

function bindingIdentifiers(name, output = []) {
  if (ts.isIdentifier(name)) {
    output.push(name);
    return output;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    bindingIdentifiers(element.name, output);
  }
  return output;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticPropertyName(node) {
  const current = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression && unwrapExpression(current.argumentExpression);
    if (
      argument &&
      (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ) {
      return argument.text;
    }
  }
  return undefined;
}

function enclosingOwner(node, sourceFile) {
  for (let owner = node.parent; owner; owner = owner.parent) {
    if (ts.isMethodDeclaration(owner) || ts.isGetAccessorDeclaration(owner)) {
      const member = owner.name?.getText(sourceFile) ?? '<anonymous>';
      const container = owner.parent;
      if (ts.isClassDeclaration(container) && container.name)
        return `${container.name.text}#${member}`;
      return member;
    }
    if (
      ts.isFunctionDeclaration(owner) ||
      ts.isFunctionExpression(owner) ||
      ts.isArrowFunction(owner)
    ) {
      if ('name' in owner && owner.name) return owner.name.getText(sourceFile);
      const parent = owner.parent;
      if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
        return parent.name.getText(sourceFile);
      }
      return '<anonymous>';
    }
  }
  return '<module>';
}

function collectDeclarations(file, sourceFile) {
  const declarations = [];
  const localDoors = authoritativeLocalDoors[file] ?? new Set();

  function add(identifier, details = {}) {
    declarations.push({
      declaration: identifier,
      depth: scopeDepth(declarationScope(identifier)),
      name: identifier.text,
      scope: declarationScope(identifier),
      ...details,
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const importedModule = moduleText(node.moduleSpecifier);
      const clause = node.importClause;
      if (clause?.name) add(clause.name);
      if (clause?.namedBindings && importedModule) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          add(clause.namedBindings.name, {
            binding: { kind: 'namespace', module: importedModule },
          });
        } else {
          for (const specifier of clause.namedBindings.elements) {
            const exportName = (specifier.propertyName ?? specifier.name).text;
            add(specifier.name, {
              binding:
                !clause.isTypeOnly && !specifier.isTypeOnly
                  ? doorBinding(importedModule, exportName)
                  : undefined,
            });
          }
        }
      }
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      add(node.name, {
        binding: localDoors.has(node.name.text)
          ? {
              door: node.name.text,
              identity: `local:${file}#${node.name.text}`,
              kind: 'door',
            }
          : undefined,
      });
    } else if ((ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
      add(node.name);
    } else if (ts.isVariableDeclaration(node)) {
      for (const identifier of bindingIdentifiers(node.name)) {
        add(identifier, {
          aliasInitializer:
            ts.isIdentifier(node.name) && node.initializer && node.parent.flags & ts.NodeFlags.Const
              ? node.initializer
              : undefined,
        });
      }
    } else if (ts.isParameter(node)) {
      for (const identifier of bindingIdentifiers(node.name)) add(identifier);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      for (const identifier of bindingIdentifiers(node.variableDeclaration.name)) add(identifier);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return declarations;
}

function declarationForIdentifier(identifier, declarations) {
  const candidates = declarations.filter(
    (entry) => entry.name === identifier.text && scopeContains(entry.scope, identifier),
  );
  candidates.sort(
    (left, right) =>
      right.depth - left.depth ||
      (right.declaration.getStart() <= identifier.getStart() ? 1 : 0) -
        (left.declaration.getStart() <= identifier.getStart() ? 1 : 0) ||
      right.declaration.getStart() - left.declaration.getStart(),
  );
  return candidates[0];
}

function resolveNamespaceReference(node, declarations) {
  const current = unwrapExpression(node);
  if (!ts.isIdentifier(current)) return undefined;
  const declaration = declarationForIdentifier(current, declarations);
  return declaration?.binding?.kind === 'namespace' ? declaration.binding.module : undefined;
}

function resolveDoorReference(node, declarations, allowAlias = true) {
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) {
    const declaration = declarationForIdentifier(current, declarations);
    if (declaration?.binding?.kind === 'door') return declaration.binding;
    if (allowAlias && declaration?.aliasInitializer) {
      return resolveDoorReference(declaration.aliasInitializer, declarations, false);
    }
    return undefined;
  }

  const property = staticPropertyName(current);
  if (!property) return undefined;
  if (property === 'reveal') {
    return { door: '.reveal', identity: 'member:.reveal', kind: 'door' };
  }
  const receiver = ts.isPropertyAccessExpression(current)
    ? current.expression
    : ts.isElementAccessExpression(current)
      ? current.expression
      : undefined;
  const importedModule = receiver && resolveNamespaceReference(receiver, declarations);
  return importedModule ? doorBinding(importedModule, property) : undefined;
}

/**
 * Derive exact syntactic declassification calls from one authored source file. The census records
 * capability identity and call code; it does not claim the call is semantically safe or effective
 * (SPEC §2 and §6.6).
 */
export function collectDeclassificationSitesFromSource(file, source) {
  const normalizedFile = file.replaceAll(path.sep, '/');
  const sourceFile = ts.createSourceFile(
    normalizedFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(normalizedFile),
  );
  const declarations = collectDeclarations(normalizedFile, sourceFile);
  const calls = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const binding = resolveDoorReference(node.expression, declarations);
      if (binding) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        calls.push({
          callee: normalizedNodeText(node.expression, sourceFile),
          column: location.character + 1,
          door: binding.door,
          expressionSha256: sha256(normalizedNodeText(node, sourceFile)),
          file: normalizedFile,
          identity: binding.identity,
          line: location.line + 1,
          owner: enclosingOwner(node, sourceFile),
          start: node.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return calls
    .sort((left, right) => left.start - right.start)
    .map(({ start: _start, ...site }, index) => ({
      ...site,
      site: `${normalizedFile}#site-${String(index + 1).padStart(4, '0')}`,
    }));
}

function productionSourceFiles(root) {
  const files = [];
  for (const sourceRoot of declassificationSourceScope.roots) {
    collectSourceFiles(root, path.join(root, sourceRoot), files);
  }
  return files.sort(asciiCompare);
}

function collectSourceFiles(root, directory, output) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    if (entry.isDirectory()) {
      if (!excludedDirectoryPattern.test(relative)) collectSourceFiles(root, absolute, output);
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) continue;
    if (!excludedFilePattern.test(relative)) output.push(relative);
  }
}

export function collectDeclassificationSites({ root = repoRoot } = {}) {
  const sites = [];
  for (const file of productionSourceFiles(root)) {
    sites.push(
      ...collectDeclassificationSitesFromSource(file, readFileSync(path.join(root, file), 'utf8')),
    );
  }
  return sites.sort((left, right) => asciiCompare(left.site, right.site));
}

function doorSummary(sites) {
  const counts = Object.fromEntries(DECLASSIFICATION_DOORS.map((door) => [door, 0]));
  for (const site of sites) counts[site.door] = (counts[site.door] ?? 0) + 1;
  return counts;
}

export function renderDeclassificationCensus(sites) {
  return {
    $comment:
      'Syntax-derived closed census of authored non-test declassification calls. It closes site/code/capability identity drift; it does not prove declassification semantics or justification quality.',
    schema: declassificationCensusSchema,
    scope: declassificationSourceScope,
    doors: DECLASSIFICATION_DOORS,
    summary: {
      byDoor: doorSummary(sites),
      total: sites.length,
    },
    sites: sites.map(
      ({ site, callee, column, door, expressionSha256, file, identity, line, owner }) => ({
        site,
        file,
        line,
        column,
        owner,
        door,
        identity,
        callee,
        expressionSha256,
      }),
    ),
  };
}

function exactJson(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

export function validateDeclassificationCensus({ artifact, sites }) {
  const findings = [];
  if (artifact?.schema !== declassificationCensusSchema) {
    findings.push(`schema must be ${declassificationCensusSchema}`);
  }
  if (!exactJson(artifact?.scope, declassificationSourceScope)) {
    findings.push('scope must match the authored production-source policy');
  }
  if (!exactJson(artifact?.doors, DECLASSIFICATION_DOORS)) {
    findings.push('doors must match the closed declassification vocabulary');
  }

  const expectedSummary = { byDoor: doorSummary(sites), total: sites.length };
  if (!exactJson(artifact?.summary, expectedSummary)) {
    findings.push('summary is stale for the source-derived sites');
  }

  const actualBySite = new Map(sites.map((site) => [site.site, site]));
  const rows = Array.isArray(artifact?.sites) ? artifact.sites : [];
  if (!Array.isArray(artifact?.sites)) findings.push('sites must be an array');
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      findings.push(`sites[${index}] must be an object`);
      continue;
    }
    if (typeof row.site !== 'string') {
      findings.push(`sites[${index}].site must be a string`);
      continue;
    }
    if (seen.has(row.site)) findings.push(`duplicate site ${row.site}`);
    seen.add(row.site);
    const actual = actualBySite.get(row.site);
    if (!actual) {
      findings.push(`inventoried site is absent: ${row.site}`);
      continue;
    }
    for (const field of [
      'file',
      'line',
      'column',
      'owner',
      'door',
      'identity',
      'callee',
      'expressionSha256',
    ]) {
      if (row[field] !== actual[field]) findings.push(`${row.site} has stale ${field}`);
    }
  }
  for (const site of sites) {
    if (!seen.has(site.site)) findings.push(`unclassified declassification site: ${site.site}`);
  }
  return { findings: [...new Set(findings)].sort(asciiCompare), ok: findings.length === 0 };
}

export function expectedDeclassificationCensus({ root = repoRoot } = {}) {
  return renderDeclassificationCensus(collectDeclassificationSites({ root }));
}

export function checkDeclassificationCensus({ root = repoRoot } = {}) {
  const artifact = JSON.parse(readFileSync(path.join(root, declassificationCensusPath), 'utf8'));
  return validateDeclassificationCensus({
    artifact,
    sites: collectDeclassificationSites({ root }),
  });
}

export function runDeclassificationCensusGate(args = process.argv.slice(2)) {
  if (args.includes('--write')) {
    const artifact = expectedDeclassificationCensus();
    writeFileSync(
      path.join(repoRoot, declassificationCensusPath),
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(
      `declassification-census/v1 sites=${artifact.summary.total} wrote=1\nOK\n`,
    );
    return 0;
  }
  const artifact = expectedDeclassificationCensus();
  const result = checkDeclassificationCensus();
  process.stdout.write(`declassification-census/v1 sites=${artifact.summary.total}\n`);
  if (result.ok) {
    process.stdout.write('OK\n');
    return 0;
  }
  process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
  return 1;
}

if (isMainEntry(import.meta.url)) await runGate(runDeclassificationCensusGate);
