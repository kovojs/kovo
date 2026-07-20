#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles, productionSourceRoots } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

const EXPECTED_DOORS = [
  'auth',
  'authorization',
  'declassification',
  'egress',
  'storage',
  'task',
  'replay',
];

const EXPECTED_RESOURCE_KINDS = {
  auth: 'credential',
  authorization: 'resource',
  declassification: 'secret',
  egress: 'destination',
  replay: 'reservation',
  storage: 'object',
  task: 'task',
};

const REQUIRED_DECISION_FIELDS = [
  'decisionSite',
  'door',
  'outcome',
  'principal',
  'resourceScope',
  'type',
];

const DECISION_SITE_CENSUS = 'security/security-event-decision-sites.json';
const DECISION_MARKER_PATTERN =
  /@kovo-security-decision\s+(auth|authorization|declassification|egress|storage|task|replay)\s+[a-z0-9][a-z0-9.-]*/gu;

/** Validate the single event-door denominator and its export/CLI consumers. */
export function checkSecurityEventAnswerability(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const findings = [];
  const sourceFiles =
    options.files ??
    collectSourceFiles(root, productionSourceRoots, { productionRoots: productionSourceRoots });
  const serverPath = 'packages/server/src/security-event.ts';
  const serverSource = readText(serverPath);
  const serverFile = parse(serverPath, serverSource);
  const doors = literalArray(serverFile, 'SECURITY_EVENT_INCIDENT_DOORS');
  if (JSON.stringify(doors) !== JSON.stringify(EXPECTED_DOORS)) {
    findings.push(
      `${serverPath}: incident-door denominator must remain exactly ${EXPECTED_DOORS.join(', ')}`,
    );
  }
  const resources = literalObject(serverFile, 'SECURITY_EVENT_RESOURCE_KIND_BY_DOOR');
  if (JSON.stringify(resources) !== JSON.stringify(EXPECTED_RESOURCE_KINDS)) {
    findings.push(
      `${serverPath}: every incident door must have its exact no-payload resource kind`,
    );
  }
  const fields = interfaceProperties(serverFile, 'SecurityDecisionEventInput');
  if (JSON.stringify(fields.names) !== JSON.stringify(REQUIRED_DECISION_FIELDS)) {
    findings.push(
      `${serverPath}: SecurityDecisionEventInput must require the complete decision fact set`,
    );
  }
  if (fields.optional.length > 0) {
    findings.push(
      `${serverPath}: SecurityDecisionEventInput fields cannot be optional: ${fields.optional.join(', ')}`,
    );
  }
  const principalArms = typeAliasObjectArms(serverFile, 'SecurityEventPrincipalScope');
  if (
    principalArms.length !== 4 ||
    principalArms.some(
      (arm) =>
        arm.optional.length > 0 ||
        !['epoch', 'id', 'kind', 'tenant'].every((property) => arm.names.includes(property)),
    )
  ) {
    findings.push(
      `${serverPath}: every principal-scope arm must require epoch, id, kind, and tenant facts`,
    );
  }
  const resourceFields = interfaceProperties(serverFile, 'SecurityEventResourceScope');
  if (
    JSON.stringify(resourceFields.names) !== JSON.stringify(['identity', 'kind']) ||
    resourceFields.optional.length > 0
  ) {
    findings.push(`${serverPath}: resource scope must require only opaque identity and kind facts`);
  }
  if (
    !serverSource.includes('assertSecurityDecisionEventInput(input') ||
    !serverSource.includes(
      'throw new TypeError(`${label} contains a missing or unexpected field.`)',
    )
  ) {
    findings.push(
      `${serverPath}: the single event door no longer validates complete own-data facts`,
    );
  }
  if (
    !serverSource.includes("if (normalized.type === 'security-decision')") ||
    !serverSource.includes('if (!decisionRecorderArmed) return undefined;') ||
    !serverSource.includes('export function armSecurityDecisionEventRecorder(): void') ||
    !serverSource.includes(
      'Answerability-bearing security decisions require the journal before the decision can proceed.',
    )
  ) {
    findings.push(`${serverPath}: a security decision without a journal must fail closed`);
  }

  const decisionSites = loadDecisionSiteCensus(readText, findings);
  findings.push(
    ...decisionSiteCensusFindings(decisionSites, sourceFiles, readText),
    ...productionRecorderBoundaryFindings(readText),
  );

  const exportPath = 'packages/server/src/security-event-export.ts';
  const exportSource = readText(exportPath);
  if (
    !exportSource.includes('doors: SECURITY_EVENT_INCIDENT_DOORS') ||
    !exportSource.includes("schema: 'kovo-security-event-coverage/v1'")
  ) {
    findings.push(`${exportPath}: export must carry the exact incident-door coverage denominator`);
  }

  const cliPath = 'packages/cli/src/commands/incident-scope.ts';
  const cliSource = readText(cliPath);
  const cliDoors = literalArray(parse(cliPath, cliSource), 'INCIDENT_DOORS');
  if (JSON.stringify(cliDoors) !== JSON.stringify(EXPECTED_DOORS)) {
    findings.push(`${cliPath}: CLI incident-door denominator drifted from the runtime door`);
  }
  if (
    !cliSource.includes('unanswerable within the covered doors') ||
    !cliSource.includes('this is not a no-impact claim')
  ) {
    findings.push(
      `${cliPath}: CLI must fail closed instead of turning absent evidence into no impact`,
    );
  }

  return { findings, ok: findings.length === 0 };
}

function loadDecisionSiteCensus(readText, findings) {
  let parsed;
  try {
    parsed = JSON.parse(readText(DECISION_SITE_CENSUS));
  } catch {
    findings.push(`${DECISION_SITE_CENSUS}: missing or unreadable decision-site census`);
    return [];
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    parsed.schema !== 'kovo-security-event-decision-sites/v1' ||
    !Array.isArray(parsed.decisionSites)
  ) {
    findings.push(`${DECISION_SITE_CENSUS}: invalid decision-site census`);
    return [];
  }
  return parsed.decisionSites;
}

function decisionSiteCensusFindings(decisionSites, sourceFiles, readText) {
  const findings = [];
  const reviewedMarkers = new Set();
  const reviewedSites = new Set();
  const projectedDoors = [];

  for (const row of decisionSites) {
    if (!validDecisionSiteRow(row)) {
      findings.push(`${DECISION_SITE_CENSUS}: decision-site census contains an invalid row`);
      continue;
    }
    const expectedKind = EXPECTED_RESOURCE_KINDS[row.door];
    if (row.resourceKind !== expectedKind) {
      findings.push(
        `${DECISION_SITE_CENSUS}: ${row.decisionSite} must use resource kind ${expectedKind}`,
      );
    }
    if (!row.decisionSite.startsWith(`framework:${row.door}:`)) {
      findings.push(`${DECISION_SITE_CENSUS}: ${row.decisionSite} does not match door ${row.door}`);
    }
    const markerIdentity = `${row.file}\0${row.marker}`;
    if (reviewedMarkers.has(markerIdentity)) {
      findings.push(`${DECISION_SITE_CENSUS}: duplicate marker ${row.file} ${row.marker}`);
    }
    reviewedMarkers.add(markerIdentity);
    if (reviewedSites.has(row.decisionSite)) {
      findings.push(`${DECISION_SITE_CENSUS}: duplicate decision site ${row.decisionSite}`);
    }
    reviewedSites.add(row.decisionSite);
    projectedDoors.push(row.door);

    let source;
    try {
      source = readText(row.file);
    } catch {
      findings.push(`${row.file}: enrolled security decision source is missing`);
      continue;
    }
    const markerMatches = [...source.matchAll(new RegExp(escapeRegExp(row.marker), 'gu'))];
    if (markerMatches.length !== 1) {
      findings.push(`${row.file}: enrolled marker must occur exactly once: ${row.marker}`);
    }
    findings.push(...decisionEmissionFindings(row, source));
  }

  const exactProjection = [...new Set(projectedDoors)].sort(compareStrings);
  const expectedProjection = [...EXPECTED_DOORS].sort(compareStrings);
  if (
    decisionSites.length !== EXPECTED_DOORS.length ||
    JSON.stringify(exactProjection) !== JSON.stringify(expectedProjection)
  ) {
    findings.push(
      `${DECISION_SITE_CENSUS}: decision-site projection must enroll exactly one site for every incident door`,
    );
  }

  const discoveredMarkers = new Set();
  const discoveredSites = new Set();
  for (const file of sourceFiles) {
    let source;
    try {
      source = readText(file);
    } catch {
      continue;
    }
    for (const match of source.matchAll(DECISION_MARKER_PATTERN)) {
      discoveredMarkers.add(`${file}\0${match[0]}`);
    }
    const sourceFile = parse(file, source);
    visit(sourceFile, (node) => {
      if (!ts.isObjectLiteralExpression(node)) return;
      const site = stringProperty(node, 'decisionSite');
      const type = stringProperty(node, 'type');
      if (site?.startsWith('framework:') && type === 'security-decision') {
        discoveredSites.add(site);
      }
    });
  }
  for (const identity of discoveredMarkers) {
    if (!reviewedMarkers.has(identity)) {
      const [file, marker] = identity.split('\0');
      findings.push(`${file}: unreviewed security decision marker ${marker}`);
    }
  }
  for (const identity of reviewedMarkers) {
    if (!discoveredMarkers.has(identity)) {
      const [file, marker] = identity.split('\0');
      findings.push(`${file}: stale security decision census marker ${marker}`);
    }
  }
  for (const site of discoveredSites) {
    if (!reviewedSites.has(site)) {
      findings.push(`${site}: security decision emission is not enrolled in the closed census`);
    }
  }
  for (const site of reviewedSites) {
    if (!discoveredSites.has(site)) {
      findings.push(`${site}: enrolled decision site has no complete production emission`);
    }
  }
  return findings;
}

function validDecisionSiteRow(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
  const keys = Object.keys(row).sort(compareStrings);
  if (
    JSON.stringify(keys) !==
    JSON.stringify(['decisionSite', 'door', 'file', 'marker', 'recorder', 'resourceKind'])
  ) {
    return false;
  }
  return (
    typeof row.decisionSite === 'string' &&
    EXPECTED_DOORS.includes(row.door) &&
    typeof row.file === 'string' &&
    typeof row.marker === 'string' &&
    (row.recorder === 'securityEvent' || row.recorder === 'core-bridge') &&
    typeof row.resourceKind === 'string'
  );
}

function decisionEmissionFindings(row, source) {
  const findings = [];
  const sourceFile = parse(row.file, source);
  const emissions = [];
  visit(sourceFile, (node) => {
    if (
      ts.isObjectLiteralExpression(node) &&
      stringProperty(node, 'decisionSite') === row.decisionSite
    ) {
      emissions.push(node);
    }
  });
  if (emissions.length !== 1) {
    findings.push(`${row.file}: ${row.decisionSite} must have exactly one emission constructor`);
    return findings;
  }
  const emission = emissions[0];
  const fields = objectPropertyNames(emission);
  if (JSON.stringify(fields) !== JSON.stringify(REQUIRED_DECISION_FIELDS)) {
    findings.push(`${row.file}: ${row.decisionSite} must emit the complete no-payload fact set`);
  }
  if (
    stringProperty(emission, 'door') !== row.door ||
    stringProperty(emission, 'type') !== 'security-decision'
  ) {
    findings.push(`${row.file}: ${row.decisionSite} door/type binding drifted`);
  }
  const resourceScope = objectProperty(emission, 'resourceScope');
  if (
    resourceScope === undefined ||
    JSON.stringify(objectPropertyNames(resourceScope)) !== JSON.stringify(['identity', 'kind']) ||
    stringProperty(resourceScope, 'kind') !== row.resourceKind
  ) {
    findings.push(`${row.file}: ${row.decisionSite} must emit only opaque identity/resource kind`);
  }
  const call = nearestCallExpression(emission);
  const expectedRecorder =
    row.recorder === 'securityEvent' ? 'securityEvent' : 'emitCoreSecurityDecision';
  if (
    call === undefined ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== expectedRecorder
  ) {
    findings.push(`${row.file}: ${row.decisionSite} must route through ${expectedRecorder}`);
  }
  const markerIndex = source.indexOf(row.marker);
  const aroundMarker = source.slice(Math.max(0, markerIndex - 6_000), markerIndex + 6_000);
  if (!aroundMarker.includes("'allow'") || !aroundMarker.includes("'deny'")) {
    findings.push(`${row.file}: ${row.decisionSite} must retain explicit allow and deny outcomes`);
  }
  return findings;
}

function productionRecorderBoundaryFindings(readText) {
  const findings = [];
  const registryPath = 'packages/server/src/generated-runtime-posture-registry.ts';
  const registry = readText(registryPath);
  const bridge = registry.indexOf('installCoreSecurityDecisionBridge(coreSecurityDecisionBridge);');
  const journal = registry.indexOf('installSecurityEventJournal(createSecurityEventJournal');
  const arm = registry.indexOf('armSecurityDecisionEventRecorder();');
  if (bridge < 0 || journal < 0 || arm < 0 || bridge > arm || journal > arm) {
    findings.push(
      `${registryPath}: generated registration must install the core bridge and journal before arming decisions`,
    );
  }

  const buildPath = 'packages/cli/src/commands/build-export.ts';
  const build = readText(buildPath);
  if (
    !build.includes('if (registry.runtimePosture === undefined)') ||
    !build.includes(
      'Production runtime emission requires the generated runtime posture registration boundary.',
    ) ||
    !build.includes(
      'registerGeneratedRuntimePostureManifest(${stringifyBuildValue(registry.runtimePosture)});',
    )
  ) {
    findings.push(`${buildPath}: production runtime emission must require posture registration`);
  }
  const registryImport = build.indexOf("import './runtime-registry.mjs';");
  const appEvaluation = build.indexOf('const appModule = await runWithGeneratedLiveTargetRegistry');
  if (registryImport < 0 || appEvaluation < 0 || registryImport > appEvaluation) {
    findings.push(`${buildPath}: production registry must evaluate before the authored app module`);
  }

  const bridgePath = 'packages/core/src/internal/security-decision.ts';
  const bridgeSource = readText(bridgePath);
  if (
    !bridgeSource.includes('installedBridge?.(event);') ||
    (bridgeSource.includes('journal') && !bridgeSource.includes('owns no journal'))
  ) {
    findings.push(`${bridgePath}: core transport must remain a journal-free bridge`);
  }
  return findings;
}

function visit(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => visit(child, visitor));
}

function stringProperty(object, name) {
  const value = propertyInitializer(object, name);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function objectProperty(object, name) {
  const value = propertyInitializer(object, name);
  return value && ts.isObjectLiteralExpression(value) ? value : undefined;
}

function propertyInitializer(object, name) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== name) continue;
    return unwrap(property.initializer);
  }
  return undefined;
}

function objectPropertyNames(object) {
  const names = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return [];
    }
    const name = propertyName(property.name);
    if (name === undefined) return [];
    names.push(name);
  }
  return names.sort(compareStrings);
}

function nearestCallExpression(node) {
  let current = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isCallExpression(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function compareStrings(left, right) {
  return String(left).localeCompare(String(right));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parse(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function declarationInitializer(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      return unwrap(declaration.initializer);
    }
  }
  return undefined;
}

function literalArray(sourceFile, name) {
  let value = declarationInitializer(sourceFile, name);
  if (ts.isCallExpression(value)) value = unwrap(value.arguments[0]);
  if (!ts.isArrayLiteralExpression(value)) return [];
  const values = [];
  for (const element of value.elements) {
    if (!ts.isStringLiteralLike(element)) return [];
    values.push(element.text);
  }
  return values;
}

function literalObject(sourceFile, name) {
  let value = declarationInitializer(sourceFile, name);
  if (ts.isCallExpression(value)) value = unwrap(value.arguments[0]);
  if (!ts.isObjectLiteralExpression(value)) return {};
  const entries = [];
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) return {};
    const key = propertyName(property.name);
    const initializer = unwrap(property.initializer);
    if (key === undefined || !ts.isStringLiteralLike(initializer)) return {};
    entries.push([key, initializer.text]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function interfaceProperties(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== name) continue;
    const names = [];
    const optional = [];
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member)) continue;
      const property = propertyName(member.name);
      if (property === undefined) continue;
      names.push(property);
      if (member.questionToken !== undefined) optional.push(property);
    }
    names.sort((left, right) => left.localeCompare(right));
    optional.sort((left, right) => left.localeCompare(right));
    return { names, optional };
  }
  return { names: [], optional: [] };
}

function typeAliasObjectArms(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== name) continue;
    const types = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type];
    return types.map((type) => {
      const names = [];
      const optional = [];
      if (!ts.isTypeLiteralNode(type)) return { names, optional };
      for (const member of type.members) {
        if (!ts.isPropertySignature(member)) continue;
        const property = propertyName(member.name);
        if (property === undefined) continue;
        names.push(property);
        if (member.questionToken !== undefined) optional.push(property);
      }
      names.sort((left, right) => left.localeCompare(right));
      optional.sort((left, right) => left.localeCompare(right));
      return { names, optional };
    });
  }
  return [];
}

function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function unwrap(value) {
  while (
    value &&
    (ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isParenthesizedExpression(value))
  ) {
    value = value.expression;
  }
  return value;
}

export function main(options = {}) {
  const result = checkSecurityEventAnswerability(options);
  if (result.ok) {
    process.stdout.write(
      `check-security-event-answerability/v1 OK doors=${EXPECTED_DOORS.length} requiredFacts=${REQUIRED_DECISION_FIELDS.length}\n`,
    );
    return true;
  }
  process.stderr.write(
    `check-security-event-answerability/v1 FAIL findings=${result.findings.length}\n${result.findings.join('\n')}\n`,
  );
  return false;
}

if (isMainEntry(import.meta.url)) process.exitCode = main() ? 0 : 1;
