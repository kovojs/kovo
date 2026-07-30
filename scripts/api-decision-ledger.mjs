#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPublicApiInventory } from './public-api-inventory.mjs';
import { repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const API_DECISION_LEDGER_SCHEMA = 'kovo-api-decision-ledger/v1';
export const PACKED_EXAMPLE_EVIDENCE = 'generated:api-surface-packed-example/v1';

const DECISIONS = new Set(['keep', 'move', 'internalize', 'remove']);
const STATES = new Set(['public', 'removed']);
const GENERATED_FAMILY_PACKAGES = new Set(['@kovojs/icons', '@kovojs/ui']);
const ROOT_HEALTH_PACKAGES = ['@kovojs/core', '@kovojs/server'];
const OWNER_PATTERN = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u;
const NON_TASK_HOME_PATTERN = /(?:^|\/)(?:advanced|types)(?:$|\/)/u;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function declarationId(declaration) {
  return `${declaration.specifier}#${declaration.symbol}`;
}

function canonicalRepoPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    path.posix.normalize(value) === value &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function wildcardMatch(pattern, value) {
  if (pattern === value) return true;
  const first = pattern.indexOf('*');
  if (first < 0 || first !== pattern.lastIndexOf('*')) return false;
  return value.startsWith(pattern.slice(0, first)) && value.endsWith(pattern.slice(first + 1));
}

function familyMatchesDeclaration(rule, declaration) {
  return (
    rule.package === declaration.package &&
    wildcardMatch(rule.subpathPattern, declaration.subpath) &&
    wildcardMatch(rule.symbolPattern, declaration.symbol)
  );
}

function familyMatchesSubpath(rule, unit) {
  return rule.package === unit.package && wildcardMatch(rule.subpathPattern, unit.subpath);
}

function validateEvidenceFile(findings, repoRoot, label, file, { test = false } = {}) {
  if (!canonicalRepoPath(file)) {
    findings.push(`${label} must be a canonical repository-relative path`);
    return;
  }
  if (!existsSync(path.join(repoRoot, file))) {
    findings.push(`${label} does not exist: ${file}`);
  }
  if (test && !/(?:^|\/).+\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) {
    findings.push(`${label} must name a contract test: ${file}`);
  }
}

function validateStory(findings, label, story, evidenceIds, repoRoot) {
  if (!isRecord(story)) {
    findings.push(`${label} must be an object`);
    return;
  }
  if (typeof story.userStory !== 'string' || story.userStory.trim().length < 30) {
    findings.push(`${label}.userStory must state a concrete app-author task`);
  }
  if (typeof story.owner !== 'string' || !OWNER_PATTERN.test(story.owner)) {
    findings.push(`${label}.owner must be a stable lowercase team/area identifier`);
  }
  if (
    typeof story.spec !== 'string' ||
    !/^(?:SPEC\.md|spec\/[0-9]{2}[-a-z]+\.md) §[0-9]+(?:\.[0-9]+)*$/u.test(story.spec)
  ) {
    findings.push(`${label}.spec must be a precise SPEC section citation`);
  } else {
    const [file, section] = story.spec.split(' §');
    const absolute = path.join(repoRoot, file);
    if (!existsSync(absolute)) {
      findings.push(`${label}.spec file does not exist: ${file}`);
    } else {
      const heading = new RegExp(
        `(?:^|\\n)#{1,6}\\s+${section.replaceAll('.', '\\.')}[\\s.:—-]`,
        'u',
      );
      if (!heading.test(readFileSync(absolute, 'utf8'))) {
        findings.push(`${label}.spec section does not exist: ${story.spec}`);
      }
    }
  }
  if (typeof story.evidence !== 'string' || !evidenceIds.has(story.evidence)) {
    findings.push(`${label}.evidence must reference a declared evidence bundle`);
  }
}

function validateCanonicalHome(findings, label, row) {
  if (row.decision === 'keep' && row.canonicalHome !== row.specifier) {
    findings.push(`${label}: keep canonicalHome must equal the current specifier`);
  } else if (
    row.decision === 'move' &&
    (typeof row.canonicalHome !== 'string' ||
      !row.canonicalHome.startsWith('@kovojs/') ||
      row.canonicalHome === row.specifier)
  ) {
    findings.push(`${label}: move canonicalHome must name a different @kovojs task home`);
  } else if (row.decision === 'move' && NON_TASK_HOME_PATTERN.test(row.canonicalHome)) {
    findings.push(`${label}: move canonicalHome cannot use a /types or /advanced junk drawer`);
  } else if (row.decision === 'internalize' && row.canonicalHome !== `internal:${row.package}`) {
    findings.push(`${label}: internalize canonicalHome must be internal:${row.package}`);
  } else if (row.decision === 'remove' && row.canonicalHome !== 'none') {
    findings.push(`${label}: remove canonicalHome must be "none"`);
  }
}

function validateIntroducedEvidence(findings, repoRoot, label, row, declaration) {
  if (!isRecord(row.introduced)) {
    findings.push(`${label}: a declaration outside the frozen baseline needs introduced evidence`);
    return;
  }
  validateEvidenceFile(
    findings,
    repoRoot,
    `${label}.introduced.releaseNote`,
    row.introduced.releaseNote,
  );
  validateEvidenceFile(
    findings,
    repoRoot,
    `${label}.introduced.contractTest`,
    row.introduced.contractTest,
    { test: true },
  );
  if (declaration?.kind.includes('value')) {
    validateEvidenceFile(
      findings,
      repoRoot,
      `${label}.introduced.nonTestExample`,
      row.introduced.nonTestExample,
    );
    const authoredFiles = new Set([
      ...declaration.consumers.authoredExamples.files,
      ...declaration.consumers.authoredDocs.files,
    ]);
    if (!authoredFiles.has(row.introduced.nonTestExample)) {
      findings.push(
        `${label}.introduced.nonTestExample must import the new value in authored docs/examples`,
      );
    }
    if (!declaration.consumers.tests.files.includes(row.introduced.contractTest)) {
      findings.push(`${label}.introduced.contractTest must import the new value`);
    }
  }
}

/**
 * Validate the versioned public decision ledger against the cleaned Track 2 inventory.
 * Generated family rules are deliberately limited to UI and icons; every other declaration
 * receives an exact symbol row so a package-wide wildcard cannot launder API growth.
 */
export function validateApiDecisionLedger({ inventory, ledger, repoRoot = defaultRepoRoot }) {
  const findings = [];
  if (!isRecord(ledger) || ledger.schema !== API_DECISION_LEDGER_SCHEMA) {
    return {
      findings: [`api-surface-decisions.json: schema must be ${API_DECISION_LEDGER_SCHEMA}`],
    };
  }
  if (
    typeof ledger.reviewedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(ledger.reviewedAt) ||
    Number.isNaN(new Date(`${ledger.reviewedAt}T00:00:00.000Z`).getTime())
  ) {
    findings.push('reviewedAt must be an ISO UTC date');
  }
  if (typeof ledger.authority !== 'string' || !ledger.authority.includes('SPEC.md')) {
    findings.push('authority must identify the plan and preserve SPEC.md as normative');
  }

  const evidence = isRecord(ledger.evidence) ? ledger.evidence : {};
  const evidenceIds = new Set(Object.keys(evidence));
  for (const [id, bundle] of Object.entries(evidence)) {
    const label = `evidence.${id}`;
    if (!isRecord(bundle)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (bundle.packedExample !== PACKED_EXAMPLE_EVIDENCE) {
      findings.push(`${label}.packedExample must use the packed declaration compiler`);
    }
    if (!Array.isArray(bundle.contractTests) || bundle.contractTests.length === 0) {
      findings.push(`${label}.contractTests must name at least one behavioral contract test`);
    } else {
      for (const [index, file] of bundle.contractTests.entries()) {
        validateEvidenceFile(findings, repoRoot, `${label}.contractTests[${index}]`, file, {
          test: true,
        });
      }
    }
  }

  const stories = isRecord(ledger.stories) ? ledger.stories : {};
  for (const [id, story] of Object.entries(stories)) {
    validateStory(findings, `stories.${id}`, story, evidenceIds, repoRoot);
  }

  const familyRules = Array.isArray(ledger.generatedFamilies) ? ledger.generatedFamilies : [];
  const familyIds = new Set();
  for (const [index, rule] of familyRules.entries()) {
    const label = `generatedFamilies[${index}]`;
    if (!isRecord(rule)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (typeof rule.id !== 'string' || familyIds.has(rule.id)) {
      findings.push(`${label}.id must be unique`);
    }
    familyIds.add(rule.id);
    if (!GENERATED_FAMILY_PACKAGES.has(rule.package)) {
      findings.push(`${label}: family rules are limited to reviewed UI/icon generators`);
    }
    if (rule.subpathPattern !== './*' || rule.symbolPattern !== '*') {
      findings.push(`${label}: generated family rules must bind the exact ./* family`);
    }
    if (rule.decision !== 'keep' || rule.canonicalHome !== '{specifier}') {
      findings.push(`${label}: generated families must keep their per-member canonical homes`);
    }
    if (rule.state !== 'public') findings.push(`${label}.state must be public`);
    if (!Object.hasOwn(stories, rule.story)) findings.push(`${label}.story is unknown`);
    if (!Object.hasOwn(evidence, rule.evidence)) findings.push(`${label}.evidence is unknown`);
    if (stories[rule.story]?.evidence !== rule.evidence) {
      findings.push(`${label}.evidence must match the selected story`);
    }
  }

  const symbolRows = Array.isArray(ledger.symbols) ? ledger.symbols : [];
  const symbolById = new Map();
  for (const [index, row] of symbolRows.entries()) {
    const label = `symbols[${index}]`;
    if (!isRecord(row)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    const expectedId = `${row.specifier}#${row.symbol}`;
    if (row.id !== expectedId) findings.push(`${label}.id must equal ${expectedId}`);
    if (symbolById.has(row.id)) findings.push(`${label}.id is duplicated: ${row.id}`);
    symbolById.set(row.id, row);
    if (!DECISIONS.has(row.decision)) findings.push(`${label}.decision is invalid`);
    if (!STATES.has(row.state)) findings.push(`${label}.state is invalid`);
    if (!Object.hasOwn(stories, row.story)) findings.push(`${label}.story is unknown`);
    if (!Object.hasOwn(evidence, row.evidence)) findings.push(`${label}.evidence is unknown`);
    if (stories[row.story]?.evidence !== row.evidence) {
      findings.push(`${label}.evidence must match the selected story`);
    }
    validateCanonicalHome(findings, label, row);
    if (row.state === 'removed' && typeof row.migrationBatch !== 'string') {
      findings.push(`${label}: removed rows require migrationBatch`);
    }
  }

  const subpathRows = Array.isArray(ledger.subpaths) ? ledger.subpaths : [];
  const subpathBySpecifier = new Map();
  for (const [index, row] of subpathRows.entries()) {
    const label = `subpaths[${index}]`;
    if (!isRecord(row)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (subpathBySpecifier.has(row.specifier)) {
      findings.push(`${label}.specifier is duplicated: ${row.specifier}`);
    }
    subpathBySpecifier.set(row.specifier, row);
    if (typeof row.task !== 'string' || row.task.trim().length < 24) {
      findings.push(`${label}.task must document the app-author task`);
    }
    if (typeof row.owner !== 'string' || !OWNER_PATTERN.test(row.owner)) {
      findings.push(`${label}.owner must be a stable team/area identifier`);
    }
    if (!Object.hasOwn(stories, row.story)) findings.push(`${label}.story is unknown`);
    if (!STATES.has(row.state)) findings.push(`${label}.state is invalid`);
    if (row.state === 'removed' && typeof row.migrationBatch !== 'string') {
      findings.push(`${label}: removed subpaths require migrationBatch`);
    }
  }

  const currentDeclarations = new Map(
    inventory.exportedDeclarations.map((declaration) => [declarationId(declaration), declaration]),
  );
  const publicHomesByPackageSymbol = new Map();
  for (const declaration of inventory.exportedDeclarations) {
    const key = `${declaration.package}#${declaration.symbol}`;
    const homes = publicHomesByPackageSymbol.get(key) ?? new Set();
    homes.add(declaration.specifier);
    publicHomesByPackageSymbol.set(key, homes);
  }
  for (const [key, homes] of publicHomesByPackageSymbol) {
    if (homes.size > 1) {
      findings.push(
        `${key}: public declaration has multiple homes: ${[...homes].sort().join(', ')}`,
      );
    }
  }
  for (const row of symbolRows) {
    if (
      !isRecord(row) ||
      row.state !== 'removed' ||
      (row.decision !== 'internalize' && row.decision !== 'remove')
    ) {
      continue;
    }
    const publicHomes = publicHomesByPackageSymbol.get(`${row.package}#${row.symbol}`);
    if (publicHomes && publicHomes.size > 0) {
      findings.push(
        `${row.id}: ${row.decision} symbol remains public at ${[...publicHomes].sort().join(', ')}`,
      );
    }
  }
  for (const [id, declaration] of currentDeclarations) {
    const exact = symbolById.get(id);
    const families = familyRules.filter((rule) => familyMatchesDeclaration(rule, declaration));
    if (exact && families.length > 0) {
      findings.push(`${id}: exact row overlaps generated family ${families[0].id}`);
    } else if (!exact && families.length !== 1) {
      findings.push(
        `${id}: expected one exact decision row or reviewed generated-family rule, found ${families.length}`,
      );
    } else if (exact && exact.state !== 'public') {
      findings.push(`${id}: current public declaration is marked ${exact.state}`);
    }
  }
  for (const [id, row] of symbolById) {
    if (row.state === 'public' && !currentDeclarations.has(id)) {
      findings.push(
        `${id}: public ledger row no longer exists; mark removed with migration evidence`,
      );
    }
  }

  const currentSubpaths = new Map(
    inventory.manifestPublicSubpaths.map((unit) => [unit.specifier, unit]),
  );
  for (const [specifier, unit] of currentSubpaths) {
    const exact = subpathBySpecifier.get(specifier);
    const families = familyRules.filter((rule) => familyMatchesSubpath(rule, unit));
    if (exact && families.length > 0) {
      findings.push(`${specifier}: exact subpath row overlaps generated family ${families[0].id}`);
    } else if (!exact && families.length !== 1) {
      findings.push(
        `${specifier}: public subpath lacks one documented task row or generated-family rule`,
      );
    } else if (exact && exact.state !== 'public') {
      findings.push(`${specifier}: current public subpath is marked ${exact.state}`);
    }
  }
  for (const [specifier, row] of subpathBySpecifier) {
    if (row.state === 'public' && !currentSubpaths.has(specifier)) {
      findings.push(`${specifier}: public subpath row no longer exists; record its migration`);
    }
  }

  const baselineDeclarations = Array.isArray(ledger.baseline?.declarations)
    ? ledger.baseline.declarations
    : [];
  const baselineSubpaths = Array.isArray(ledger.baseline?.subpaths) ? ledger.baseline.subpaths : [];
  if (JSON.stringify(baselineDeclarations) !== JSON.stringify(sortedUnique(baselineDeclarations))) {
    findings.push('baseline.declarations must be sorted and unique');
  }
  if (JSON.stringify(baselineSubpaths) !== JSON.stringify(sortedUnique(baselineSubpaths))) {
    findings.push('baseline.subpaths must be sorted and unique');
  }

  const baselineDeclarationSet = new Set(baselineDeclarations);
  for (const [id, declaration] of currentDeclarations) {
    if (baselineDeclarationSet.has(id)) continue;
    const row = symbolById.get(id);
    if (!row || row.decision !== 'keep' || row.state !== 'public') {
      findings.push(`${id}: declaration growth requires an exact public keep row`);
      continue;
    }
    validateIntroducedEvidence(findings, repoRoot, id, row, declaration);
  }
  for (const id of baselineDeclarations) {
    if (currentDeclarations.has(id)) continue;
    const row = symbolById.get(id);
    if (!row || row.state !== 'removed' || typeof row.migrationBatch !== 'string') {
      findings.push(`${id}: baseline declaration disappeared without a removed migration row`);
    }
  }

  const baselineSubpathSet = new Set(baselineSubpaths);
  for (const [specifier] of currentSubpaths) {
    if (baselineSubpathSet.has(specifier)) continue;
    const row = subpathBySpecifier.get(specifier);
    if (!row || row.state !== 'public' || !isRecord(row.introduced)) {
      findings.push(`${specifier}: new public subpath requires an exact reviewed task row`);
    }
  }
  for (const specifier of baselineSubpaths) {
    if (currentSubpaths.has(specifier)) continue;
    const row = subpathBySpecifier.get(specifier);
    if (!row || row.state !== 'removed' || typeof row.migrationBatch !== 'string') {
      findings.push(`${specifier}: baseline subpath disappeared without migration evidence`);
    }
  }

  const packageCounts = {};
  const rootCounts = {};
  for (const declaration of inventory.exportedDeclarations) {
    packageCounts[declaration.package] = (packageCounts[declaration.package] ?? 0) + 1;
    if (declaration.subpath === '.') {
      rootCounts[declaration.package] = (rootCounts[declaration.package] ?? 0) + 1;
    }
  }
  const decisionCounts = {};
  for (const declaration of inventory.exportedDeclarations) {
    const exact = symbolById.get(declarationId(declaration));
    const decision =
      exact?.decision ??
      familyRules.find((rule) => familyMatchesDeclaration(rule, declaration))?.decision;
    if (decision) decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
  }
  const rootTargets = ledger.healthTargets?.rootDeclarations;
  if (!isRecord(rootTargets)) {
    findings.push('healthTargets.rootDeclarations must be an object');
  } else {
    for (const packageName of ROOT_HEALTH_PACKAGES) {
      if (!Number.isInteger(rootTargets[packageName]) || rootTargets[packageName] < 1) {
        findings.push(`healthTargets.rootDeclarations.${packageName} must be a positive integer`);
      }
    }
    for (const packageName of Object.keys(rootTargets)) {
      if (!Object.hasOwn(rootCounts, packageName)) {
        findings.push(`healthTargets.rootDeclarations names unknown root ${packageName}`);
        continue;
      }
      const target = rootTargets[packageName];
      if (Number.isInteger(target) && target > 0 && rootCounts[packageName] > target) {
        findings.push(
          `healthTargets.rootDeclarations.${packageName}=${target} is exceeded by ${rootCounts[packageName]} declarations`,
        );
      }
    }
  }

  return {
    findings: sortedUnique(findings),
    report: {
      declarations: inventory.exportedDeclarations.length,
      subpaths: inventory.manifestPublicSubpaths.length,
      decisions: decisionCounts,
      packageCounts,
      rootCounts,
      rootTargets: isRecord(rootTargets) ? rootTargets : {},
    },
  };
}

export function runApiDecisionLedger({
  repoRoot = defaultRepoRoot,
  ledgerPath = path.join(repoRoot, 'api-surface-decisions.json'),
} = {}) {
  if (!existsSync(ledgerPath)) {
    throw new Error('api-surface-decisions.json: checked public decision ledger is missing');
  }
  const inventory = buildPublicApiInventory({ repoRoot });
  const ledger = readJson(ledgerPath);
  const result = validateApiDecisionLedger({ inventory, ledger, repoRoot });
  if (result.findings.length > 0) {
    process.stderr.write(
      `api-decision-ledger: ${result.findings.length} finding(s):\n  ${result.findings.join('\n  ')}\n`,
    );
    return { ...result, ok: false };
  }
  const report = result.report;
  process.stdout.write(
    `api-decision-ledger/v1 declarations=${report.declarations} subpaths=${report.subpaths} decisions=${Object.entries(
      report.decisions,
    )
      .map(([decision, count]) => `${decision}:${count}`)
      .join(',')}\n`,
  );
  process.stdout.write(
    `api-decision-ledger/roots ${Object.entries(report.rootCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packageName, count]) => {
        const target = report.rootTargets[packageName];
        return `${packageName}=${count}${Number.isInteger(target) ? `/target:${target}` : ''}`;
      })
      .join(' ')}\n`,
  );
  return { ...result, ok: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runApiDecisionLedger();
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
