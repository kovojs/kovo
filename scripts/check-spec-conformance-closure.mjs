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
const coreDiagnosticsPath = 'packages/core/src/diagnostics.ts';
const coreInternalDiagnosticsPath = 'packages/core/src/internal/diagnostics.ts';
const generatedDiagnosticRegistryModulePath =
  'packages/core/src/internal/diagnostic-registry.generated.ts';
const compilerDiagnosticsPath = 'packages/compiler/src/diagnostics.ts';
const rootDiagnosticDoor = `${coreDiagnosticsPath}#createRegisteredDiagnostic`;
const diagnosticFactoryDoor = `${compilerDiagnosticsPath}#DiagnosticFactory.at`;
const generatedDiagnosticConstructorDoor = `${coreDiagnosticsPath}#createDiagnosticConstructor`;

// These are reviewed wrapper definitions, not spelling-based exemptions. A call is approved only
// when its lexical binding resolves to this exact file + symbol and the wrapper graph below proves
// that definition still reaches the root createRegisteredDiagnostic door.
const reviewedDiagnosticWrappers = new Map([
  [`${compilerDiagnosticsPath}#diagnosticFor`, { exported: true, name: 'diagnosticFor' }],
  [
    'packages/compiler/src/lower/attribute-merge.ts#attributeMergeDiagnostic',
    { exported: false, name: 'attributeMergeDiagnostic' },
  ],
  [
    'packages/compiler/src/validate/event-triggers.ts#eventTriggerDiagnostic',
    { exported: false, name: 'eventTriggerDiagnostic' },
  ],
  [
    'packages/compiler/src/validate/markup.ts#attributeMergeDiagnostic',
    { exported: false, name: 'attributeMergeDiagnostic' },
  ],
  [
    'packages/drizzle/src/static/diagnostics.ts#drizzleDiagnostic',
    { exported: true, name: 'drizzleDiagnostic' },
  ],
  [
    'packages/server/src/static-export-diagnostics.ts#staticExportDiagnostic',
    { exported: true, name: 'staticExportDiagnostic' },
  ],
  [
    'packages/test/src/verifier-diagnostics.ts#diagnosticMessage',
    { exported: true, name: 'diagnosticMessage' },
  ],
]);
const reviewedDiagnosticEmitterNames = new Set([
  'attributeMergeDiagnostic',
  'createRegisteredDiagnostic',
  'diagnosticFor',
  'diagnosticMessage',
  'drizzleDiagnostic',
  'eventTriggerDiagnostic',
  'staticExportDiagnostic',
]);
const aliasSensitiveDiagnosticBindings = new Set([
  ...reviewedDiagnosticEmitterNames,
  'createDiagnosticFactory',
  'diagnosticConstructors',
  'DiagnosticFactory',
]);
const productionAnalysisCache = new WeakMap();
const productionScanCache = new WeakMap();
const emissionDoorBindingCache = new WeakMap();
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
  const cached = productionScanCache.get(files);
  if (cached !== undefined) return cached;
  const findings = [];
  const emissionSites = new Map();
  let siteCount = 0;
  const analysis = createProductionAnalysis(files);

  for (const [fileName, sourceFile] of analysis.sourceFiles) {
    if (!isProductionSourcePath(fileName)) continue;

    const visit = (node) => {
      const aliasFinding = diagnosticAliasDeclarationFinding(node, {
        ...analysis,
        fileName,
        sourceFile,
      });
      if (aliasFinding !== undefined) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push(`${fileName}:${position.line + 1}: ${aliasFinding}`);
      }
      if (ts.isCallExpression(node)) {
        const codes = diagnosticCodesInEmissionCall(node);
        if (codes.size > 0) {
          const resolution = resolveDiagnosticEmitterCall(node, {
            ...analysis,
            fileName,
            sourceFile,
          });
          if (resolution.status === 'rejected') {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            findings.push(
              `${fileName}:${position.line + 1}: untrusted diagnostic emitter binding for ${node.expression.getText(sourceFile)} (${resolution.reason})`,
            );
          }
          if (resolution.status === 'approved') {
            if (resolution.constructorCode !== undefined) codes.add(resolution.constructorCode);
            for (const code of codes) {
              const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              const site = {
                emitter: resolution.emitter,
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

  const result = { emissionSites, findings, siteCount };
  productionScanCache.set(files, result);
  return result;
}

function diagnosticAliasDeclarationFinding(node, context) {
  if (ts.isImportSpecifier(node)) {
    const binding = importBindingFromSpecifier(node);
    if (
      binding.localName !== binding.importedName &&
      aliasSensitiveDiagnosticBindings.has(binding.importedName)
    ) {
      return `diagnostic binding alias drift ${binding.localName} -> ${binding.importedName} is forbidden`;
    }
    return undefined;
  }
  if (ts.isNamespaceImport(node)) {
    const importDeclaration = node.parent.parent;
    const moduleSpecifier = importDeclaration.moduleSpecifier.text;
    const modulePath = resolveImportModulePath(context.fileName, moduleSpecifier);
    if (isReviewedDiagnosticModule(modulePath)) {
      return `diagnostic namespace import ${node.name.text} from ${moduleSpecifier} is forbidden`;
    }
    return undefined;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    context.boundFileNames.has(context.fileName)
  ) {
    if (ts.isIdentifier(node.right)) {
      const target = resolveIdentifierDiagnosticEmitter(node.right, context);
      if (target.status === 'approved' || target.status === 'rejected') {
        return `assigned diagnostic emitter alias ${node.left.getText(context.sourceFile)} is forbidden`;
      }
    }
    if (
      ts.isPropertyAccessExpression(node.right) &&
      (aliasSensitiveDiagnosticBindings.has(node.right.name.text) ||
        (/^KV\d{3}$/u.test(node.right.name.text) &&
          isDiagnosticConstructorReceiver(node.right.expression, context)))
    ) {
      return `assigned diagnostic member alias ${node.left.getText(context.sourceFile)} is forbidden`;
    }
    if (ts.isIdentifier(node.left)) {
      const symbol = context.checker.getSymbolAtLocation(node.left);
      const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
      if (declaration !== undefined && ts.isParameter(declaration)) {
        if (isExactDiagnosticFactoryType(declaration.type, context)) {
          return `DiagnosticFactory capability reassignment ${node.left.text} is forbidden`;
        }
      }
    }
    return undefined;
  }
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return undefined;
  if (!ts.isIdentifier(node.name)) {
    const alias = diagnosticBindingElementAlias(node.name);
    return alias === undefined ? undefined : `diagnostic destructuring alias ${alias} is forbidden`;
  }

  if (ts.isIdentifier(node.initializer) && context.boundFileNames.has(context.fileName)) {
    const target = resolveIdentifierDiagnosticEmitter(node.initializer, context);
    if (target.status === 'approved' || target.status === 'rejected') {
      return `local diagnostic emitter alias ${node.name.text} is forbidden`;
    }
  }
  if (ts.isPropertyAccessExpression(node.initializer)) {
    const member = node.initializer.name.text;
    if (
      aliasSensitiveDiagnosticBindings.has(member) ||
      (/^KV\d{3}$/u.test(member) &&
        isDiagnosticConstructorReceiver(node.initializer.expression, context))
    ) {
      return `local diagnostic member alias ${node.name.text} -> ${member} is forbidden`;
    }
  }
  return undefined;
}

function isDiagnosticConstructorReceiver(receiver, context) {
  if (ts.isPropertyAccessExpression(receiver)) {
    return receiver.name.text === 'diagnosticConstructors';
  }
  if (!ts.isIdentifier(receiver) || !context.boundFileNames.has(context.fileName)) return false;
  return importedBinding(receiver, context)?.importedName === 'diagnosticConstructors';
}

function diagnosticBindingElementAlias(name) {
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (element.dotDotDotToken !== undefined) continue;
    const propertyName = element.propertyName;
    const importedName =
      propertyName !== undefined &&
      (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName))
        ? propertyName.text
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
    if (importedName !== undefined && aliasSensitiveDiagnosticBindings.has(importedName)) {
      const localName = ts.isIdentifier(element.name) ? element.name.text : '<nested>';
      return `${localName} -> ${importedName}`;
    }
    if (!ts.isIdentifier(element.name)) {
      const nested = diagnosticBindingElementAlias(element.name);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function isReviewedDiagnosticModule(modulePath) {
  if (
    modulePath === coreDiagnosticsPath ||
    modulePath === coreInternalDiagnosticsPath ||
    modulePath === generatedDiagnosticRegistryModulePath ||
    modulePath === compilerDiagnosticsPath
  ) {
    return true;
  }
  return [...reviewedDiagnosticWrappers.keys()].some((key) => key.startsWith(`${modulePath}#`));
}

function createProductionAnalysis(files) {
  const cached = productionAnalysisCache.get(files);
  if (cached !== undefined) return cached;
  const sourceFiles = new Map();
  for (const file of files) {
    const fileName = normalizePath(file.path);
    if (!isProductionSourcePath(fileName)) continue;
    sourceFiles.set(
      fileName,
      ts.createSourceFile(
        fileName,
        file.text,
        ts.ScriptTarget.Latest,
        true,
        sourceScriptKind(fileName),
      ),
    );
  }
  const compilerOptions = {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const host = {
    fileExists: (fileName) => sourceFiles.has(normalizePath(fileName)),
    getCanonicalFileName: (fileName) => normalizePath(fileName),
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => '',
    getDirectories: () => [],
    getNewLine: () => '\n',
    getSourceFile: (fileName) => sourceFiles.get(normalizePath(fileName)),
    readFile: (fileName) => sourceFiles.get(normalizePath(fileName))?.text,
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {},
  };
  const rootNames = [...sourceFiles]
    .filter(
      ([fileName, sourceFile]) =>
        diagnosticBindingCandidateSource(sourceFile.text) ||
        fileName === coreInternalDiagnosticsPath ||
        fileName === coreDiagnosticsPath ||
        fileName === compilerDiagnosticsPath ||
        [...reviewedDiagnosticWrappers.keys()].some((key) => key.startsWith(`${fileName}#`)),
    )
    .map(([fileName]) => fileName);
  const program = ts.createProgram({
    host,
    options: compilerOptions,
    rootNames,
  });
  const analysis = {
    boundFileNames: new Set(rootNames),
    checker: program.getTypeChecker(),
    sourceFiles,
  };
  productionAnalysisCache.set(files, analysis);
  return analysis;
}

function diagnosticBindingCandidateSource(source) {
  return (
    /KV\d{3}/u.test(source) ||
    /\b(?:attributeMergeDiagnostic|createDiagnosticConstructor|createRegisteredDiagnostic|diagnosticConstructors|diagnosticFor|diagnosticMessage|drizzleDiagnostic|eventTriggerDiagnostic|staticExportDiagnostic)\b/u.test(
      source,
    ) ||
    /\bdiagnostics\.at\s*\(/u.test(source)
  );
}

function sourceScriptKind(fileName) {
  if (/\.tsx$/u.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.(?:mjs|cjs|js)$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function resolveDiagnosticEmitterCall(call, context) {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) {
    return resolveIdentifierDiagnosticEmitter(expression, context);
  }
  if (!ts.isPropertyAccessExpression(expression)) return { status: 'none' };

  const member = expression.name.text;
  if (/^KV\d{3}$/u.test(member)) {
    if (!ts.isIdentifier(expression.expression)) {
      return {
        reason: 'generated constructor receiver must be the exact named import',
        status: 'rejected',
      };
    }
    const binding = importedBinding(expression.expression, context);
    if (binding === undefined || binding.importedName !== 'diagnosticConstructors') {
      return {
        reason: 'generated constructor receiver is a local/lookalike binding',
        status: 'rejected',
      };
    }
    if (binding.localName !== binding.importedName) {
      return {
        reason: 'generated constructor import aliases are not census-stable',
        status: 'rejected',
      };
    }
    const modulePath = resolveImportModulePath(context.fileName, binding.moduleSpecifier);
    if (modulePath !== coreInternalDiagnosticsPath) {
      return {
        reason: `diagnosticConstructors must come from ${coreInternalDiagnosticsPath}`,
        status: 'rejected',
      };
    }
    return {
      constructorCode: member,
      emitter: `diagnosticConstructors.${member}`,
      status: 'approved',
      target: generatedDiagnosticConstructorDoor,
    };
  }

  if (member === 'at') return resolveDiagnosticFactoryAtCall(expression.expression, context);
  if (reviewedDiagnosticEmitterNames.has(member)) {
    return {
      reason: 'namespace/member lookalikes are forbidden; import the reviewed symbol by name',
      status: 'rejected',
    };
  }
  return { status: 'none' };
}

function resolveIdentifierDiagnosticEmitter(identifier, context, seen = new Set()) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) {
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'unbound reviewed-emitter spelling', status: 'rejected' }
      : { status: 'none' };
  }
  if (seen.has(symbol)) return { reason: 'diagnostic emitter alias cycle', status: 'rejected' };
  seen.add(symbol);

  const declaration = preferredValueDeclaration(symbol);
  if (declaration === undefined) {
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'reviewed-emitter spelling has no resolvable declaration', status: 'rejected' }
      : { status: 'none' };
  }

  if (ts.isImportSpecifier(declaration)) {
    const binding = importBindingFromSpecifier(declaration);
    const target = reviewedImportTarget(context.fileName, binding);
    if (target !== undefined) {
      if (binding.localName !== binding.importedName) {
        return {
          reason: `alias drift ${binding.localName} -> ${binding.importedName} is forbidden`,
          status: 'rejected',
        };
      }
      return {
        emitter: binding.importedName,
        status: 'approved',
        target,
      };
    }
    return reviewedDiagnosticEmitterNames.has(binding.localName) ||
      reviewedDiagnosticEmitterNames.has(binding.importedName)
      ? {
          reason: `import does not resolve to a reviewed emitter definition (${binding.moduleSpecifier})`,
          status: 'rejected',
        }
      : { status: 'none' };
  }

  if (ts.isFunctionDeclaration(declaration)) {
    const name = declaration.name?.text;
    const key = name === undefined ? undefined : `${context.fileName}#${name}`;
    if (
      (key === rootDiagnosticDoor || reviewedDiagnosticWrappers.has(key)) &&
      declaration.parent === context.sourceFile
    ) {
      return { emitter: name, status: 'approved', target: key };
    }
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'local function shadows a reviewed emitter name', status: 'rejected' }
      : { status: 'none' };
  }

  if (ts.isVariableDeclaration(declaration)) {
    const initializer = declaration.initializer;
    if (initializer !== undefined && ts.isIdentifier(initializer)) {
      const target = resolveIdentifierDiagnosticEmitter(initializer, context, seen);
      if (target.status === 'approved' || target.status === 'rejected') {
        return {
          reason: `local alias ${identifier.text} obscures the reviewed emitter binding`,
          status: 'rejected',
        };
      }
    }
    return reviewedDiagnosticEmitterNames.has(identifier.text)
      ? { reason: 'local variable shadows a reviewed emitter name', status: 'rejected' }
      : { status: 'none' };
  }

  return reviewedDiagnosticEmitterNames.has(identifier.text)
    ? {
        reason: `${ts.SyntaxKind[declaration.kind]} shadows a reviewed emitter name`,
        status: 'rejected',
      }
    : { status: 'none' };
}

function resolveDiagnosticFactoryAtCall(receiver, context) {
  if (!ts.isIdentifier(receiver)) {
    return {
      reason: 'DiagnosticFactory.at receiver must be a lexically resolved identifier',
      status: 'rejected',
    };
  }
  const symbol = context.checker.getSymbolAtLocation(receiver);
  const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
  if (declaration === undefined) {
    return { reason: 'fake diagnostics.at receiver has no binding', status: 'rejected' };
  }
  if (symbol !== undefined && bindingIsAssignedBefore(symbol, receiver, context)) {
    return {
      reason: 'DiagnosticFactory capability binding was reassigned before emission',
      status: 'rejected',
    };
  }

  if (ts.isParameter(declaration) && isExactDiagnosticFactoryType(declaration.type, context)) {
    return {
      emitter: 'DiagnosticFactory.at',
      status: 'approved',
      target: diagnosticFactoryDoor,
    };
  }
  if (ts.isVariableDeclaration(declaration)) {
    const initializer = declaration.initializer;
    if (
      initializer !== undefined &&
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      isExactImportedOrLocalBinding(
        initializer.expression,
        compilerDiagnosticsPath,
        'createDiagnosticFactory',
        context,
      )
    ) {
      return {
        emitter: 'DiagnosticFactory.at',
        status: 'approved',
        target: diagnosticFactoryDoor,
      };
    }
  }
  return {
    reason: 'fake diagnostics.at receiver is not an exact DiagnosticFactory capability',
    status: 'rejected',
  };
}

function bindingIsAssignedBefore(symbol, use, context) {
  let scope = use.parent;
  while (scope !== undefined && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent;
  }
  if (scope === undefined) return false;
  let assigned = false;
  const visit = (node) => {
    if (assigned || node.getStart(context.sourceFile) >= use.getStart(context.sourceFile)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      context.checker.getSymbolAtLocation(node.left) === symbol
    ) {
      assigned = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return assigned;
}

function isExactDiagnosticFactoryType(typeNode, context) {
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return false;
  if (!ts.isIdentifier(typeNode.typeName) || typeNode.typeName.text !== 'DiagnosticFactory') {
    return false;
  }
  return isExactImportedOrLocalBinding(
    typeNode.typeName,
    compilerDiagnosticsPath,
    'DiagnosticFactory',
    context,
  );
}

function isExactImportedOrLocalBinding(identifier, expectedFile, expectedName, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
  if (declaration === undefined) return false;
  if (ts.isImportSpecifier(declaration)) {
    const binding = importBindingFromSpecifier(declaration);
    return (
      binding.localName === expectedName &&
      binding.importedName === expectedName &&
      resolveImportModulePath(context.fileName, binding.moduleSpecifier) === expectedFile
    );
  }
  if (
    (ts.isInterfaceDeclaration(declaration) ||
      ts.isFunctionDeclaration(declaration) ||
      ts.isVariableDeclaration(declaration)) &&
    declaration.name !== undefined &&
    ts.isIdentifier(declaration.name)
  ) {
    return context.fileName === expectedFile && declaration.name.text === expectedName;
  }
  return false;
}

function importedBinding(identifier, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declaration = symbol === undefined ? undefined : preferredValueDeclaration(symbol);
  return declaration !== undefined && ts.isImportSpecifier(declaration)
    ? importBindingFromSpecifier(declaration)
    : undefined;
}

function preferredValueDeclaration(symbol) {
  return symbol.declarations?.find(
    (declaration) =>
      ts.isImportSpecifier(declaration) ||
      ts.isFunctionDeclaration(declaration) ||
      ts.isVariableDeclaration(declaration) ||
      ts.isParameter(declaration) ||
      ts.isInterfaceDeclaration(declaration) ||
      ts.isBindingElement(declaration),
  );
}

function importBindingFromSpecifier(specifier) {
  const importDeclaration = specifier.parent.parent.parent;
  return {
    importedName: specifier.propertyName?.text ?? specifier.name.text,
    localName: specifier.name.text,
    moduleSpecifier: importDeclaration.moduleSpecifier.text,
  };
}

function reviewedImportTarget(fileName, binding) {
  const modulePath = resolveImportModulePath(fileName, binding.moduleSpecifier);
  if (
    (modulePath === coreInternalDiagnosticsPath || modulePath === coreDiagnosticsPath) &&
    binding.importedName === 'createRegisteredDiagnostic'
  ) {
    return rootDiagnosticDoor;
  }
  const wrapperKey = `${modulePath}#${binding.importedName}`;
  return reviewedDiagnosticWrappers.has(wrapperKey) ? wrapperKey : undefined;
}

function resolveImportModulePath(fileName, moduleSpecifier) {
  if (moduleSpecifier === '@kovojs/core/internal/diagnostics') {
    return coreInternalDiagnosticsPath;
  }
  if (!moduleSpecifier.startsWith('.')) return moduleSpecifier;
  const resolved = normalizePath(
    path.posix.normalize(path.posix.join(path.posix.dirname(fileName), moduleSpecifier)),
  );
  if (/\.(?:js|mjs|cjs)$/u.test(resolved)) return resolved.replace(/\.(?:mjs|cjs|js)$/u, '.ts');
  if (/\.ts$/u.test(resolved)) return resolved;
  return `${resolved}.ts`;
}

function diagnosticCodesInEmissionCall(call) {
  const codes = new Set();
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    /^KV\d{3}$/u.test(call.expression.name.text)
  ) {
    codes.add(call.expression.name.text);
  }

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
  const cached = emissionDoorBindingCache.get(files);
  if (cached !== undefined) return cached;
  const analysis = createProductionAnalysis(files);
  const findings = [];
  const edges = new Map();

  const coreBridge = analysis.sourceFiles.get(coreInternalDiagnosticsPath);
  if (
    coreBridge === undefined ||
    !hasExactStarExport(coreBridge, coreInternalDiagnosticsPath, coreDiagnosticsPath)
  ) {
    findings.push(
      `${coreInternalDiagnosticsPath}: reviewed diagnostics bridge lost exact ${coreDiagnosticsPath} export`,
    );
  }
  if (
    coreBridge === undefined ||
    !hasExactStarExport(
      coreBridge,
      coreInternalDiagnosticsPath,
      generatedDiagnosticRegistryModulePath,
    )
  ) {
    findings.push(
      `${coreInternalDiagnosticsPath}: reviewed diagnostics bridge lost exact generated constructor export`,
    );
  }

  const rootSource = analysis.sourceFiles.get(coreDiagnosticsPath);
  if (
    rootSource === undefined ||
    findTopLevelFunction(rootSource, 'createRegisteredDiagnostic') === undefined
  ) {
    findings.push(`${rootDiagnosticDoor}: root validating diagnostic door is missing`);
  }

  const constructorFunction =
    rootSource === undefined
      ? undefined
      : findTopLevelFunction(rootSource, 'createDiagnosticConstructor');
  if (constructorFunction === undefined) {
    findings.push(
      `${generatedDiagnosticConstructorDoor}: generated constructor wrapper is missing`,
    );
  } else {
    edges.set(
      generatedDiagnosticConstructorDoor,
      emitterTargetsInNode(constructorFunction, coreDiagnosticsPath, analysis, findings),
    );
  }

  const compilerSource = analysis.sourceFiles.get(compilerDiagnosticsPath);
  const factoryMethod =
    compilerSource === undefined ? undefined : findDiagnosticFactoryAtMethod(compilerSource);
  if (factoryMethod === undefined) {
    findings.push(`${diagnosticFactoryDoor}: reviewed factory method is missing`);
  } else {
    edges.set(
      diagnosticFactoryDoor,
      emitterTargetsInNode(factoryMethod, compilerDiagnosticsPath, analysis, findings),
    );
  }

  for (const [key, wrapper] of reviewedDiagnosticWrappers) {
    const separator = key.lastIndexOf('#');
    const fileName = key.slice(0, separator);
    const sourceFile = analysis.sourceFiles.get(fileName);
    const declaration =
      sourceFile === undefined ? undefined : findTopLevelFunction(sourceFile, wrapper.name);
    if (declaration === undefined) {
      findings.push(`${key}: reviewed diagnostic wrapper definition is missing`);
      continue;
    }
    if (wrapper.exported && !hasExportModifier(declaration)) {
      findings.push(`${key}: reviewed imported wrapper must remain a named export`);
    }
    edges.set(key, emitterTargetsInNode(declaration, fileName, analysis, findings));
  }

  for (const key of [
    ...reviewedDiagnosticWrappers.keys(),
    diagnosticFactoryDoor,
    generatedDiagnosticConstructorDoor,
  ]) {
    if (!emitterGraphReachesRoot(key, edges)) {
      findings.push(
        `${key}: reviewed diagnostic wrapper has no exact path to ${rootDiagnosticDoor}`,
      );
    }
  }
  emissionDoorBindingCache.set(files, findings);
  return findings;
}

function emitterTargetsInNode(node, fileName, analysis, findings) {
  const sourceFile = analysis.sourceFiles.get(fileName);
  const targets = new Set();
  if (sourceFile === undefined) return targets;
  const visit = (child) => {
    if (child !== node && (ts.isFunctionDeclaration(child) || ts.isClassDeclaration(child))) return;
    if (ts.isCallExpression(child)) {
      const resolution = resolveDiagnosticEmitterCall(child, {
        ...analysis,
        fileName,
        sourceFile,
      });
      if (resolution.status === 'approved') targets.add(resolution.target);
      if (resolution.status === 'rejected') {
        const position = sourceFile.getLineAndCharacterOfPosition(child.getStart(sourceFile));
        findings.push(
          `${fileName}:${position.line + 1}: reviewed wrapper uses untrusted emitter ${child.expression.getText(sourceFile)} (${resolution.reason})`,
        );
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return targets;
}

function emitterGraphReachesRoot(start, edges, seen = new Set()) {
  if (start === rootDiagnosticDoor) return true;
  if (seen.has(start)) return false;
  seen.add(start);
  for (const target of edges.get(start) ?? []) {
    if (emitterGraphReachesRoot(target, edges, new Set(seen))) return true;
  }
  return false;
}

function findTopLevelFunction(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

function findDiagnosticFactoryAtMethod(sourceFile) {
  const factory = findTopLevelFunction(sourceFile, 'createDiagnosticFactory');
  if (factory === undefined) return undefined;
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isMethodDeclaration(node) && propertyNameText(node.name, sourceFile) === 'at') {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(factory);
  return found;
}

function hasExportModifier(declaration) {
  return ts
    .getModifiers(declaration)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function hasExactStarExport(sourceFile, fileName, expectedModulePath) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause === undefined &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      resolveImportModulePath(fileName, statement.moduleSpecifier.text) === expectedModulePath,
  );
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
