#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { checkDiagnosticsRegistryEquality } from '../site/scripts/diagnostics-ref.mjs';
import {
  diagnosticSpecPath,
  generatedDiagnosticRegistryPath,
  parseDiagnosticSpecRegistry,
  renderGeneratedDiagnosticRegistry,
} from './generate-diagnostic-registry.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const diagnosticConformanceEvidencePath = 'security/diagnostic-conformance-evidence.json';
export const diagnosticConformanceSchema = 'kovo.diagnostic-conformance-evidence/v1';

const compilerMatrixKind = 'compiler-matrix';
const fixturesKind = 'fixtures';
const reviewedZeroEmissionKind = 'reviewed-zero-emission';
const approvedCallEmitters = new Set([
  'attributeMergeDiagnostic',
  'createRegisteredDiagnostic',
  'diagnosticFor',
  'diagnosticMessage',
  'drizzleDiagnostic',
  'eventTriggerDiagnostic',
  'staticExportDiagnostic',
]);
const diagnosticLiteralExemptions = new Set([
  'packages/core/src/diagnostics.ts',
  'packages/core/src/internal/diagnostic-registry.generated.ts',
  'packages/core/src/internal/security-markers.ts',
  'packages/core/src/internal/source-sink-registry.ts',
  'packages/drizzle/src/test-helpers.ts',
]);

export async function loadSpecConformanceInput({ root = repoRoot } = {}) {
  const specMarkdown = readFileSync(path.join(root, diagnosticSpecPath), 'utf8');
  const generatedSource = readFileSync(path.join(root, generatedDiagnosticRegistryPath), 'utf8');
  const evidence = JSON.parse(
    readFileSync(path.join(root, diagnosticConformanceEvidencePath), 'utf8'),
  );
  const productionFiles = collectPackageSourceFiles(root);
  const fixtureFiles = {};
  for (const file of referencedEvidenceFiles(evidence)) {
    fixtureFiles[file] = readFileSync(path.join(root, file), 'utf8');
  }

  const diagnosticsModule = await import(
    pathToFileURL(path.join(root, 'packages/core/src/diagnostics.ts')).href
  );
  const generatedRuntimeShape = parseGeneratedRuntimeShape(
    generatedSource,
    diagnosticsModule.diagnosticDefinitions,
  );

  let diagnosticsRefResult;
  try {
    const result = await checkDiagnosticsRegistryEquality();
    diagnosticsRefResult = { codes: result.codes, findings: [], ok: true };
  } catch (error) {
    diagnosticsRefResult = {
      codes: 0,
      findings: [error instanceof Error ? error.message : String(error)],
      ok: false,
    };
  }

  return {
    definitions: diagnosticsModule.diagnosticDefinitions,
    diagnosticsRefResult,
    evidence,
    fixtureFiles,
    generatedSource,
    productionFiles,
    runtimeConstructorCodes: generatedRuntimeShape.constructorCodes,
    runtimeRegistry: generatedRuntimeShape.registry,
    specMarkdown,
  };
}

function parseGeneratedRuntimeShape(source, definitions) {
  const registry = {};
  for (const match of source.matchAll(
    /^\s*(KV\d{3}): createRegisteredDiagnosticDefinition\('(KV\d{3})', '(compile-error|fail-closed-runtime|audited-escape)'\),$/gmu,
  )) {
    if (match[1] !== match[2]) continue;
    const definition = definitions[match[1]];
    if (definition === undefined) continue;
    registry[match[1]] = { ...definition, enforcementClass: match[3] };
  }
  const constructorCodes = Array.from(
    source.matchAll(/^\s*(KV\d{3}): createDiagnosticConstructor\('(KV\d{3})'\),$/gmu),
    (match) => (match[1] === match[2] ? match[1] : undefined),
  ).filter(Boolean);
  return { constructorCodes, registry };
}

export function evaluateSpecConformanceClosure(input) {
  const findings = [];
  let rows;
  try {
    rows = parseDiagnosticSpecRegistry(input.specMarkdown);
  } catch (error) {
    return conformanceResult([error instanceof Error ? error.message : String(error)], 0, 0, 0);
  }

  const expectedGenerated = renderGeneratedDiagnosticRegistry(rows);
  if (input.generatedSource !== expectedGenerated) {
    findings.push(
      `${generatedDiagnosticRegistryPath}: stale or incomplete; run node scripts/generate-diagnostic-registry.mjs --write`,
    );
  }

  const specCodes = new Set(rows.map((row) => row.code));
  const definitionCodes = new Set(Object.keys(input.definitions ?? {}));
  const runtimeRegistryCodes = new Set(Object.keys(input.runtimeRegistry ?? {}));
  const runtimeConstructorCodes = new Set(input.runtimeConstructorCodes ?? []);
  findings.push(...exactCodeSetFindings('diagnosticDefinitions', definitionCodes, specCodes));
  findings.push(
    ...exactCodeSetFindings('generated diagnostic registry', runtimeRegistryCodes, specCodes),
  );
  findings.push(
    ...exactCodeSetFindings(
      'generated diagnostic constructors',
      runtimeConstructorCodes,
      specCodes,
    ),
  );

  for (const row of rows) {
    const definition = input.definitions?.[row.code];
    const registryRow = input.runtimeRegistry?.[row.code];
    if (definition !== undefined && definition.severity !== row.severity) {
      findings.push(
        `${row.code}: SPEC severity ${row.severity} disagrees with diagnosticDefinitions severity ${definition.severity}`,
      );
    }
    if (registryRow !== undefined) {
      if (registryRow.severity !== row.severity) {
        findings.push(
          `${row.code}: generated registry severity ${registryRow.severity} disagrees with SPEC severity ${row.severity}`,
        );
      }
      if (registryRow.enforcementClass !== row.enforcementClass) {
        findings.push(
          `${row.code}: generated registry enforcement ${registryRow.enforcementClass} disagrees with SPEC enforcement ${row.enforcementClass}`,
        );
      }
    }
  }

  findings.push(...validateEmissionDoorBindings(input.productionFiles));
  const scan = scanDiagnosticProductionSources(input.productionFiles);
  findings.push(...scan.findings);

  const errorCodes = rows.filter((row) => row.severity === 'error').map((row) => row.code);
  findings.push(
    ...validateDiagnosticEvidence({
      emissionSites: scan.emissionSites,
      errorCodes,
      evidence: input.evidence,
      fixtureFiles: input.fixtureFiles,
    }),
  );

  if (!input.diagnosticsRefResult?.ok) {
    const detail = input.diagnosticsRefResult?.findings?.join('; ') || 'unknown registry drift';
    findings.push(`diagnostics-ref registry equality failed: ${detail}`);
  } else if (input.diagnosticsRefResult.codes !== rows.length) {
    findings.push(
      `diagnostics-ref registry equality counted ${input.diagnosticsRefResult.codes} codes; SPEC registers ${rows.length}`,
    );
  }

  return conformanceResult(findings, rows.length, errorCodes.length, scan.siteCount);
}

export function scanDiagnosticProductionSources(files) {
  const findings = [];
  const emissionSites = new Map();
  let siteCount = 0;

  for (const file of files) {
    const fileName = normalizePath(file.path);
    if (!isProductionSourcePath(fileName)) continue;
    const sourceFile = ts.createSourceFile(
      fileName,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const emitter = approvedEmitterName(node.expression, sourceFile);
        if (emitter !== undefined) {
          const codes = diagnosticCodesInEmissionCall(node, emitter);
          for (const code of codes) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            const site = {
              emitter,
              file: fileName,
              line: position.line + 1,
            };
            const existing = emissionSites.get(code) ?? [];
            existing.push(site);
            emissionSites.set(code, existing);
            siteCount += 1;
          }
        }
      }

      if (ts.isObjectLiteralExpression(node) && !diagnosticLiteralExemptions.has(fileName)) {
        const literal = adHocDiagnosticLiteral(node, sourceFile);
        if (literal !== undefined) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          findings.push(
            `${fileName}:${position.line + 1}: ad hoc ${literal} production diagnostic literal; use a generated registry constructor`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { emissionSites, findings, siteCount };
}

function approvedEmitterName(expression, sourceFile) {
  const text = expression.getText(sourceFile);
  const leaf = text.split('.').at(-1);
  if (approvedCallEmitters.has(text) || approvedCallEmitters.has(leaf)) return leaf;
  if (/^diagnosticConstructors\.KV\d{3}$/u.test(text)) return text;
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'at' &&
    /diagnostic/iu.test(expression.expression.getText(sourceFile))
  ) {
    return 'diagnostics.at';
  }
  return undefined;
}

function diagnosticCodesInEmissionCall(call, emitter) {
  const codes = new Set();
  const constructorMatch = emitter.match(/^diagnosticConstructors\.(KV\d{3})$/u);
  if (constructorMatch) codes.add(constructorMatch[1]);

  const visit = (node) => {
    if (ts.isStringLiteralLike(node) && /^KV\d{3}$/u.test(node.text)) codes.add(node.text);
    ts.forEachChild(node, visit);
  };
  for (const argument of call.arguments) visit(argument);

  // An approved emission call must bind a literal code. Dynamic finite lattices should branch to
  // code-specific constructors before this point, so the conformance gate can derive each site.
  return codes;
}

function adHocDiagnosticLiteral(node, sourceFile) {
  let code;
  let carriesDiagnosticPayload = false;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name, sourceFile);
    if (
      name === 'code' &&
      ts.isStringLiteralLike(property.initializer) &&
      /^KV\d{3}$/u.test(property.initializer.text)
    ) {
      code = property.initializer.text;
    }
    if (name === 'message' || name === 'severity') carriesDiagnosticPayload = true;
  }
  return code !== undefined && carriesDiagnosticPayload ? code : undefined;
}

function propertyNameText(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return name.getText(sourceFile);
}

function validateEmissionDoorBindings(files) {
  const byPath = new Map(files.map((file) => [normalizePath(file.path), file.text]));
  const requirements = [
    ['packages/compiler/src/diagnostics.ts', 'createRegisteredDiagnostic('],
    ['packages/drizzle/src/static/diagnostics.ts', 'createRegisteredDiagnostic('],
    ['packages/server/src/static-export-diagnostics.ts', 'createRegisteredDiagnostic('],
    ['packages/test/src/verifier-diagnostics.ts', 'createRegisteredDiagnostic('],
    ['packages/compiler/src/validate/event-triggers.ts', 'diagnostics.at('],
    ['packages/compiler/src/lower/attribute-merge.ts', 'diagnosticFor('],
  ];
  const findings = [];
  for (const [file, anchor] of requirements) {
    const text = byPath.get(file);
    if (text === undefined || !text.includes(anchor)) {
      findings.push(`${file}: approved diagnostic wrapper lost registry-door anchor ${anchor}`);
    }
  }
  return findings;
}

function validateDiagnosticEvidence({ emissionSites, errorCodes, evidence, fixtureFiles }) {
  const findings = [];
  if (evidence?.schema !== diagnosticConformanceSchema) {
    findings.push(
      `${diagnosticConformanceEvidencePath}: schema must be ${diagnosticConformanceSchema}`,
    );
    return findings;
  }

  const entries = evidence.diagnostics ?? {};
  const expectedCodes = new Set(errorCodes);
  findings.push(
    ...exactCodeSetFindings(
      `${diagnosticConformanceEvidencePath} error evidence`,
      new Set(Object.keys(entries)),
      expectedCodes,
    ),
  );

  const matrix = evidence.compilerMatrix;
  const matrixCodes = matrixCodesFromSource(fixtureFiles?.[matrix?.source] ?? '');
  const matrixTest = findNamedTest(fixtureFiles?.[matrix?.test] ?? '', matrix?.testName);
  if (matrixTest === undefined) {
    findings.push(`${matrix?.test ?? '<missing>'}: compiler matrix red/green test is missing`);
  } else if (!matrixTest.includes('.positive()') || !matrixTest.includes('.negative()')) {
    findings.push(`${matrix.test}: compiler matrix test must execute positive() and negative()`);
  }

  for (const code of errorCodes) {
    const entry = entries[code];
    if (entry === undefined) continue;
    const sites = emissionSites.get(code) ?? [];

    if (entry.kind === reviewedZeroEmissionKind) {
      if (sites.length > 0) {
        findings.push(`${code}: reviewed zero-emission applicability contradicts derived sites`);
      }
      if (typeof entry.reason !== 'string' || entry.reason.trim().length < 24) {
        findings.push(`${code}: zero-emission applicability needs a reviewed, explicit reason`);
      }
      if (typeof entry.reviewer !== 'string' || entry.reviewer.trim().length === 0) {
        findings.push(`${code}: zero-emission applicability needs a named reviewer role`);
      }
      findings.push(
        ...validateFixtureReference(code, 'zero-emission mutation', entry.mutation, fixtureFiles),
      );
      continue;
    }

    if (sites.length === 0) {
      findings.push(`${code}: no derived production enforcement site`);
    }

    if (entry.kind === compilerMatrixKind) {
      if (!matrixCodes.has(code)) {
        findings.push(`${code}: compiler-matrix evidence row is missing from ${matrix?.source}`);
      }
      if (entry.ownerPackage !== 'compiler') {
        findings.push(`${code}: compiler-matrix evidence ownerPackage must be compiler`);
      }
      continue;
    }

    if (entry.kind !== fixturesKind) {
      findings.push(
        `${code}: evidence kind must be ${fixturesKind}, ${compilerMatrixKind}, or ${reviewedZeroEmissionKind}`,
      );
      continue;
    }

    findings.push(...validateFixtureReference(code, 'red', entry.red, fixtureFiles, true));
    findings.push(...validateFixtureReference(code, 'green', entry.green, fixtureFiles));
    findings.push(...validateFixtureReference(code, 'own-layer', entry.ownLayer, fixtureFiles));
    const ownFile = normalizePath(entry.ownLayer?.file ?? '');
    if (
      typeof entry.ownerPackage !== 'string' ||
      !ownFile.startsWith(`packages/${entry.ownerPackage}/`)
    ) {
      findings.push(
        `${code}: own-layer fixture must live under declared owner package ${entry.ownerPackage ?? '<missing>'}`,
      );
    }
  }
  return findings;
}

function validateFixtureReference(code, label, reference, fixtureFiles, requireCode = false) {
  if (
    reference === undefined ||
    typeof reference.file !== 'string' ||
    typeof reference.test !== 'string'
  ) {
    return [`${code}: ${label} fixture reference is incomplete`];
  }
  const file = normalizePath(reference.file);
  if (!isTestSourcePath(file)) return [`${code}: ${label} fixture must name a test source file`];
  const text = fixtureFiles?.[file];
  if (typeof text !== 'string') return [`${code}: ${label} fixture file ${file} is missing`];
  const test = findNamedTest(text, reference.test, file);
  if (test === undefined) return [`${code}: ${label} fixture test "${reference.test}" is missing`];
  const findings = [];
  if (!/\bexpect\s*\(/u.test(test)) {
    findings.push(`${code}: ${label} fixture test "${reference.test}" has no assertion`);
  }
  if (requireCode && !text.includes(code)) {
    findings.push(`${code}: red fixture file ${file} no longer references the diagnostic code`);
  }
  return findings;
}

function findNamedTest(text, testName, fileName = 'fixture.test.ts') {
  if (typeof text !== 'string' || typeof testName !== 'string') return undefined;
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isCallExpression(node) && isTestCall(node.expression, sourceFile)) {
      const title = node.arguments[0];
      if (title && ts.isStringLiteralLike(title) && title.text === testName) {
        found = node.getText(sourceFile);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isTestCall(expression, sourceFile) {
  const text = expression.getText(sourceFile);
  return text === 'it' || text === 'test' || text.endsWith('.it') || text.endsWith('.test');
}

function matrixCodesFromSource(source) {
  const block = source.match(/const compilerDiagnosticCoverageOrder = \[([\s\S]*?)\] as const/u);
  if (!block) return new Set();
  return new Set(Array.from(block[1].matchAll(/'(KV\d{3})'/gu), (match) => match[1]));
}

function exactCodeSetFindings(label, actual, expected) {
  const missing = [...expected].filter((code) => !actual.has(code)).sort(compareCodes);
  const extra = [...actual].filter((code) => !expected.has(code)).sort(compareCodes);
  const findings = [];
  if (missing.length > 0) findings.push(`${label}: missing ${missing.join(', ')}`);
  if (extra.length > 0) findings.push(`${label}: unexpected ${extra.join(', ')}`);
  return findings;
}

function referencedEvidenceFiles(evidence) {
  const files = new Set();
  if (typeof evidence?.compilerMatrix?.source === 'string')
    files.add(evidence.compilerMatrix.source);
  if (typeof evidence?.compilerMatrix?.test === 'string') files.add(evidence.compilerMatrix.test);
  for (const entry of Object.values(evidence?.diagnostics ?? {})) {
    for (const key of ['red', 'green', 'ownLayer', 'mutation']) {
      if (typeof entry?.[key]?.file === 'string') files.add(normalizePath(entry[key].file));
    }
  }
  return files;
}

function collectPackageSourceFiles(root) {
  const files = [];
  const packagesRoot = path.join(root, 'packages');
  walk(packagesRoot, (absolutePath) => {
    const relativePath = normalizePath(path.relative(root, absolutePath));
    if (!/\.(?:[cm]?js|tsx?)$/u.test(relativePath)) return;
    files.push({ path: relativePath, text: readFileSync(absolutePath, 'utf8') });
  });
  return files;
}

function walk(directory, onFile) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(child, onFile);
    else if (entry.isFile()) onFile(child);
  }
}

function isProductionSourcePath(fileName) {
  const file = normalizePath(fileName);
  return (
    /^packages\/[^/]+\/src\/.+\.(?:[cm]?js|tsx?)$/u.test(file) &&
    !isTestSourcePath(file) &&
    !file.startsWith('packages/conformance-fixtures/') &&
    !file.includes('/diagnostic-coverage/') &&
    !file.endsWith('/diagnostic-coverage-matrix.data.ts') &&
    !file.endsWith('/spec-coverage-map.ts') &&
    !file.endsWith('/test-helpers.ts') &&
    !file.includes('.test-helper.')
  );
}

function isTestSourcePath(fileName) {
  return /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$)/u.test(
    normalizePath(fileName),
  );
}

function normalizePath(value) {
  return String(value).replaceAll(path.sep, '/');
}

function compareCodes(left, right) {
  return Number(left.slice(2)) - Number(right.slice(2));
}

function conformanceResult(findings, codes, errorCodes, sites) {
  return {
    codes,
    errorCodes,
    findings,
    ok: findings.length === 0,
    sites,
  };
}

export async function main(options = {}) {
  const result = evaluateSpecConformanceClosure(await loadSpecConformanceInput(options));
  process.stdout.write(
    `check-spec-conformance-closure/v1 ${result.ok ? 'OK' : 'FAIL'} codes=${result.codes} errors=${result.errorCodes} sites=${result.sites}\n`,
  );
  for (const finding of result.findings) process.stderr.write(`- ${finding}\n`);
  return result.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);
