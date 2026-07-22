#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { FRAMEWORK_WIRE_INPUT_REGISTRY } from '../packages/core/src/internal/wire-input-grammar.ts';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const wireInputBoundarySchema = 'kovo-wire-input-boundary/v1';
export const wireInputBoundaryManifestPath = 'security/wire-input-boundary.json';
export const repoRoot = findRepoRoot();

const defaultCanonicalReaders = Object.freeze([
  {
    allowedCarriers: ['stdio-line'],
    api: 'finiteMcpStdioJsonLine',
    declaration: 'function',
    file: 'packages/core/src/internal/mcp-stdio.ts',
    fixedName: 'json-rpc',
    name: 'parseFiniteMcpJsonLine',
  },
  {
    allowedCarriers: ['header', 'request-header', 'response-header'],
    api: 'serverReadHeader',
    declaration: 'function',
    file: 'packages/server/src/response.ts',
    name: 'readHeader',
    nameArgument: 1,
    normalizeName: 'lowercase',
  },
  {
    allowedCarriers: ['request-header'],
    api: 'requestBodyHeader',
    declaration: 'function',
    file: 'packages/server/src/request-body-intrinsics.ts',
    name: 'requestHeader',
    nameArgument: 1,
    normalizeName: 'lowercase',
  },
  {
    allowedCarriers: ['request-header'],
    api: 'responseRequestHeader',
    declaration: 'function',
    file: 'packages/server/src/response.ts',
    name: 'requestHeader',
    nameArgument: 1,
    normalizeName: 'lowercase',
  },
  {
    allowedCarriers: ['request-header'],
    api: 'readUntrustedRequestHeader',
    declaration: 'function',
    file: 'packages/server/src/untrusted-request-body.ts',
    name: 'readUntrustedRequestHeader',
    nameArgument: 1,
    normalizeName: 'lowercase',
  },
  {
    allowedCarriers: ['request-cookie'],
    api: 'readUntrustedCookieValue',
    declaration: 'function',
    file: 'packages/server/src/untrusted-request-body.ts',
    name: 'readUntrustedCookieValue',
    nameArgument: 1,
  },
  {
    allowedCarriers: ['response-header'],
    api: 'browserReadHeader',
    declaration: 'shorthand-property',
    file: 'packages/browser/src/navigation-security-intrinsics.ts',
    identity: 'createBrowserNavigationSecurityControls.readHeader',
    name: 'readHeader',
    nameArgument: 1,
    normalizeName: 'lowercase',
  },
  {
    allowedCarriers: ['search-params'],
    api: 'querySearchInputEntries',
    declaration: 'function',
    file: 'packages/server/src/query.ts',
    fixedName: '*',
    name: 'snapshotQuerySearchInputEntries',
  },
  {
    allowedCarriers: ['search-param'],
    api: 'capabilityUrlParam',
    declaration: 'function',
    file: 'packages/server/src/capability-intrinsics.ts',
    name: 'capabilityUrlParam',
    nameArgument: 1,
  },
  {
    allowedCarriers: ['search-param'],
    api: 'viteDevUrlSearchParam',
    declaration: 'function',
    file: 'packages/server/src/vite-dev.ts',
    name: 'viteDevUrlSearchParam',
    nameArgument: 1,
  },
]);

/**
 * Resolve exact framework reader declarations through TypeScript and census every call site.
 * Same-named application helpers and structural lookalikes have different declaration symbols and
 * therefore cannot enter this denominator (SPEC §9.1; C13).
 */
export function discoverWireInputReads({
  canonicalReaders = defaultCanonicalReaders,
  rootDir = repoRoot,
  sources,
} = {}) {
  const context = createProgramContext({ rootDir, sources });
  const checker = context.program.getTypeChecker();
  const canonicalTargets = canonicalReaderSymbols({ canonicalReaders, checker, context });
  const discovered = [];

  for (const sourceFile of context.scannedSourceFiles()) {
    visit(sourceFile);

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const identity = callIdentityNode(node.expression);
        const symbol =
          identity === undefined
            ? undefined
            : resolveAlias(checker, checker.getSymbolAtLocation(identity));
        const target =
          symbol === undefined ? undefined : resolvedCanonicalTarget(symbol, canonicalTargets);
        if (target !== undefined) {
          const file = context.logicalFileName(sourceFile.fileName);
          let inputName = target.fixedName;
          if (inputName === undefined && target.nameArgument !== undefined) {
            inputName = staticStringValue(checker, node.arguments[target.nameArgument]);
          }
          if (inputName === undefined) inputName = null;
          if (target.normalizeName === 'lowercase' && typeof inputName === 'string') {
            inputName = inputName.toLowerCase();
          }
          discovered.push({
            allowedCarriers: [...target.allowedCarriers],
            api: target.api,
            file,
            id: `${file}#${stableCallSiteOwner(node, sourceFile)}`,
            inputName,
            position: node.getStart(sourceFile),
            symbol: target.identity,
          });
        }
      }
      ts.forEachChild(node, visit);
    }
  }

  discovered.sort((left, right) =>
    left.file === right.file ? left.position - right.position : left.file.localeCompare(right.file),
  );
  const occurrences = new Map();
  return discovered.map(({ position: _position, ...site }) => {
    const count = (occurrences.get(site.id) ?? 0) + 1;
    occurrences.set(site.id, count);
    return count === 1 ? site : { ...site, id: `${site.id}~${count}` };
  });
}

/** Validate an exact, reviewed registry binding for every discovered framework input read. */
export function evaluateWireInputBoundary({ discovered, manifest, registry }) {
  const findings = [];
  const registryById = validateRegistry(registry, findings);
  if (!isRecord(manifest) || manifest.schema !== wireInputBoundarySchema) {
    findings.push(`wire-input boundary schema must be ${wireInputBoundarySchema}`);
  }
  const rows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  if (!Array.isArray(manifest?.rows)) findings.push('wire-input boundary rows must be an array');
  const discoveredById = new Map(discovered.map((site) => [site.id, site]));
  const seen = new Set();
  let classified = 0;

  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string') {
      findings.push('wire-input boundary row must be an object with a string id');
      continue;
    }
    if (seen.has(row.id)) findings.push(`${row.id}: duplicate wire-input boundary row`);
    seen.add(row.id);
    const site = discoveredById.get(row.id);
    if (site === undefined) {
      findings.push(`stale wire-input boundary row ${row.id}`);
    } else if (!sameResolvedSite(row, site)) {
      findings.push(
        `${row.id}: boundary identity differs from the resolved TypeScript symbol site`,
      );
    }

    const input = typeof row.registryId === 'string' ? registryById.get(row.registryId) : undefined;
    if (input === undefined) {
      findings.push(`${row.id}: registryId must name a closed wire-input registry entry`);
    } else if (site !== undefined) {
      classified += 1;
      if (!site.allowedCarriers.includes(input.carrier)) {
        findings.push(`${row.id}: ${input.carrier} is not allowed for ${site.api}`);
      }
      if (site.inputName === null) {
        if (input.name !== '*') {
          findings.push(`${row.id}: dynamic input name must bind to a * registry input`);
        }
      } else if (site.inputName !== input.name) {
        findings.push(`${row.id}: ${site.inputName} does not match registry input ${input.name}`);
      }
    }
    if (!substantive(row.reason)) {
      findings.push(`${row.id}: classification requires a substantive reviewed reason`);
    }
  }

  for (const site of discovered) {
    if (!seen.has(site.id)) findings.push(`missing wire-input boundary row ${site.id}`);
  }
  const summary = {
    classified,
    dynamicNames: discovered.filter((site) => site.inputName === null).length,
    sites: discovered.length,
  };
  if (isRecord(manifest?.summary) && canonicalJson(manifest.summary) !== canonicalJson(summary)) {
    findings.push('wire-input boundary summary is stale');
  }
  return { findings, ok: findings.length === 0, summary };
}

/** Preserve reviewed decisions while leaving newly resolved reader sites unclassified. */
export function generatedWireInputBoundary({ discovered, existing }) {
  const priorRows =
    existing?.schema === wireInputBoundarySchema && Array.isArray(existing?.rows)
      ? existing.rows
      : [];
  const priorById = new Map(
    priorRows
      .filter((row) => isRecord(row) && typeof row.id === 'string')
      .map((row) => [row.id, row]),
  );
  const rows = discovered.map((site) => {
    const prior = priorById.get(site.id);
    return {
      ...site,
      reason: typeof prior?.reason === 'string' ? prior.reason : null,
      registryId: typeof prior?.registryId === 'string' ? prior.registryId : null,
    };
  });
  return {
    rows,
    schema: wireInputBoundarySchema,
    summary: {
      classified: rows.filter((row) => typeof row.registryId === 'string').length,
      dynamicNames: rows.filter((row) => row.inputName === null).length,
      sites: rows.length,
    },
  };
}

export function writeWireInputBoundary({ rootDir = repoRoot } = {}) {
  const outputPath = path.join(rootDir, wireInputBoundaryManifestPath);
  const existing = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf8'))
    : undefined;
  const discovered = discoverWireInputReads({ rootDir });
  writeFileSync(outputPath, canonicalJson(generatedWireInputBoundary({ discovered, existing })));
}

export function main({ rootDir = repoRoot, write = process.argv.includes('--write') } = {}) {
  if (write) writeWireInputBoundary({ rootDir });
  const manifest = JSON.parse(
    readFileSync(path.join(rootDir, wireInputBoundaryManifestPath), 'utf8'),
  );
  const discovered = discoverWireInputReads({ rootDir });
  const result = evaluateWireInputBoundary({
    discovered,
    manifest,
    registry: FRAMEWORK_WIRE_INPUT_REGISTRY,
  });
  process.stdout.write(
    `wire-input-boundary/v1 ${result.ok ? 'OK' : 'FAIL'} sites=${result.summary.sites} dynamic=${result.summary.dynamicNames}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function validateRegistry(registry, findings) {
  const byId = new Map();
  if (!isRecord(registry) || registry.schema !== 'kovo.wire-input-registry/v1') {
    findings.push('wire-input registry schema must be kovo.wire-input-registry/v1');
  }
  if (!Array.isArray(registry?.inputs)) {
    findings.push('wire-input registry inputs must be an array');
    return byId;
  }
  for (const input of registry.inputs) {
    if (
      !isRecord(input) ||
      typeof input.id !== 'string' ||
      typeof input.carrier !== 'string' ||
      typeof input.name !== 'string'
    ) {
      findings.push('wire-input registry entry must have string id, carrier, and name');
      continue;
    }
    if (byId.has(input.id)) findings.push(`${input.id}: duplicate wire-input registry entry`);
    byId.set(input.id, input);
  }
  return byId;
}

function sameResolvedSite(row, site) {
  return (
    row.api === site.api &&
    row.file === site.file &&
    row.symbol === site.symbol &&
    row.inputName === site.inputName &&
    canonicalJson(row.allowedCarriers) === canonicalJson(site.allowedCarriers)
  );
}

function canonicalReaderSymbols({ canonicalReaders, checker, context }) {
  const bySymbol = new Map();
  const targets = [];
  for (const reference of canonicalReaders) {
    const sourceFile = context.sourceFile(reference.file);
    const declaration =
      reference.declaration === 'shorthand-property'
        ? sourceFile && namedShorthandProperty(sourceFile, reference.name)
        : sourceFile && namedFunctionDeclaration(sourceFile, reference.name);
    const symbol =
      declaration === undefined
        ? undefined
        : resolveAlias(checker, checker.getSymbolAtLocation(declaration.name));
    if (symbol === undefined) {
      throw new Error(`missing canonical wire reader ${reference.file}#${reference.name}`);
    }
    const target = {
      ...reference,
      declaration,
      identity: `${reference.file}#${reference.identity ?? reference.name}`,
    };
    bySymbol.set(symbol, target);
    targets.push(target);
  }
  return { bySymbol, targets };
}

function resolvedCanonicalTarget(symbol, canonicalTargets) {
  const direct = canonicalTargets.bySymbol.get(symbol);
  if (direct !== undefined) return direct;
  for (const declaration of symbol.declarations ?? []) {
    const target = canonicalTargets.targets.find(
      (candidate) =>
        candidate.declaration === declaration ||
        (candidate.declaration.getSourceFile() === declaration.getSourceFile() &&
          candidate.declaration.pos === declaration.pos &&
          candidate.declaration.end === declaration.end),
    );
    if (target !== undefined) return target;
  }
  return undefined;
}

function namedFunctionDeclaration(sourceFile, name) {
  return descendants(sourceFile).find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
}

function namedShorthandProperty(sourceFile, name) {
  const matches = descendants(sourceFile).filter(
    (node) => ts.isShorthandPropertyAssignment(node) && node.name.text === name,
  );
  if (matches.length !== 1) {
    throw new Error(
      `${sourceFile.fileName} must contain exactly one shorthand property named ${name}`,
    );
  }
  return matches[0];
}

function staticStringValue(checker, node, seen = new Set()) {
  const value = unwrapExpression(node);
  if (value === undefined) return undefined;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (!ts.isIdentifier(value)) return undefined;
  const symbol = resolveAlias(checker, checker.getSymbolAtLocation(value));
  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration)) {
      const resolved = staticStringValue(checker, declaration.initializer, seen);
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

function createProgramContext({ rootDir, sources }) {
  if (sources instanceof Map) return virtualProgramContext(sources);
  const rootNames = productionTypeScriptFiles(path.join(rootDir, 'packages'));
  const config = ts.readConfigFile(path.join(rootDir, 'tsconfig.json'), (fileName) =>
    ts.sys.readFile(fileName),
  );
  if (config.error !== undefined) throw new Error(formatDiagnostic(config.error));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, rootDir);
  const program = ts.createProgram({ options: { ...parsed.options, noEmit: true }, rootNames });
  const scanned = new Set(rootNames.map(normalizePath));
  return {
    logicalFileName(fileName) {
      return normalizePath(path.relative(rootDir, fileName));
    },
    program,
    scannedSourceFiles() {
      return program
        .getSourceFiles()
        .filter((sourceFile) => scanned.has(normalizePath(sourceFile.fileName)));
    },
    sourceFile(logicalName) {
      return program.getSourceFile(path.join(rootDir, logicalName));
    },
  };
}

function virtualProgramContext(sources) {
  const base = '/__kovo_wire_input_boundary__';
  const sourceByAbsoluteName = new Map(
    [...sources].map(([file, source]) => [normalizePath(path.join(base, file)), source]),
  );
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
  const host = ts.createCompilerHost(options, true);
  const systemDirectoryExists = host.directoryExists?.bind(host);
  const systemFileExists = host.fileExists.bind(host);
  const systemGetDirectories = host.getDirectories?.bind(host);
  const systemReadFile = host.readFile.bind(host);
  host.getCurrentDirectory = () => base;
  host.fileExists = (fileName) =>
    sourceByAbsoluteName.has(normalizePath(fileName)) || systemFileExists(fileName);
  host.readFile = (fileName) =>
    sourceByAbsoluteName.get(normalizePath(fileName)) ?? systemReadFile(fileName);
  host.directoryExists = (directory) => {
    const normalized = `${normalizePath(directory).replace(/\/$/u, '')}/`;
    return (
      [...sourceByAbsoluteName.keys()].some((fileName) => fileName.startsWith(normalized)) ||
      systemDirectoryExists?.(directory) === true
    );
  };
  host.getDirectories = (directory) => systemGetDirectories?.(directory) ?? [];
  host.realpath = (fileName) => normalizePath(fileName);
  host.getSourceFile = (fileName, languageVersion) => {
    const source = host.readFile(fileName);
    return source === undefined
      ? undefined
      : ts.createSourceFile(fileName, source, languageVersion, true, scriptKind(fileName));
  };
  const rootNames = [...sourceByAbsoluteName.keys()];
  const program = ts.createProgram({ host, options, rootNames });
  const scanned = new Set(rootNames);
  return {
    logicalFileName(fileName) {
      return normalizePath(path.relative(base, fileName));
    },
    program,
    scannedSourceFiles() {
      return program
        .getSourceFiles()
        .filter((sourceFile) => scanned.has(normalizePath(sourceFile.fileName)));
    },
    sourceFile(logicalName) {
      return program.getSourceFile(path.join(base, logicalName));
    },
  };
}

function stableCallSiteOwner(call, sourceFile) {
  let current = call.parent;
  while (current !== undefined && current !== sourceFile) {
    if (ts.isVariableDeclaration(current)) return bindingText(current.name, sourceFile);
    if (ts.isParameter(current)) {
      return `${lexicalOwner(current, sourceFile)}.${bindingText(current.name, sourceFile)}`;
    }
    if (ts.isPropertyAssignment(current) || ts.isPropertyDeclaration(current)) {
      return `${lexicalOwner(current, sourceFile)}.${propertyNameText(current.name)}`;
    }
    if (ts.isReturnStatement(current)) return `${lexicalOwner(current, sourceFile)}.return`;
    current = current.parent;
  }
  return `${lexicalOwner(call, sourceFile)}.call`;
}

function lexicalOwner(node, sourceFile) {
  let current = node.parent;
  while (current !== undefined && current !== sourceFile) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return current.name === undefined ? 'anonymous' : propertyNameText(current.name);
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent)) return bindingText(parent.name, sourceFile);
      if (ts.isPropertyAssignment(parent)) return propertyNameText(parent.name);
      return 'anonymous';
    }
    current = current.parent;
  }
  return 'module';
}

function callIdentityNode(expression) {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression)) return expression.name;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression;
  }
  return undefined;
}

function resolveAlias(checker, symbol) {
  let current = symbol;
  const seen = new Set();
  while (current !== undefined && (current.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(current)) return current;
    seen.add(current);
    current = checker.getAliasedSymbol(current);
  }
  return current;
}

function productionTypeScriptFiles(root) {
  const files = [];
  walk(root);
  return files.sort((left, right) => left.localeCompare(right));

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['dist', 'node_modules'].includes(entry.name)) walk(absolute);
        continue;
      }
      if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
      if (/\.(?:test|bench)\.[cm]?tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts'))
        continue;
      files.push(absolute);
    }
  }
}

function descendants(root) {
  const nodes = [];
  visit(root);
  return nodes;
  function visit(node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
}

function unwrapExpression(node) {
  let current = node;
  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function bindingText(name, sourceFile) {
  return ts.isIdentifier(name) ? name.text : name.getText(sourceFile).replaceAll(/\s+/gu, '');
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText();
}

function scriptKind(fileName) {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function normalizePath(fileName) {
  return fileName.replaceAll('\\', '/');
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function substantive(value) {
  return typeof value === 'string' && value.trim().length >= 12;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

if (isMainEntry(import.meta.url)) {
  void runGate(() => main());
}
