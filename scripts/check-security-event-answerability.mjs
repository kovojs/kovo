#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

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

/** Validate the single event-door denominator and its export/CLI consumers. */
export function checkSecurityEventAnswerability(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const findings = [];
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
    !serverSource.includes(
      'Answerability-bearing security decisions require the journal before the decision can proceed.',
    )
  ) {
    findings.push(`${serverPath}: a security decision without a journal must fail closed`);
  }

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
