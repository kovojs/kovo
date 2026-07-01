#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(thisFile), '..');

export const SECURITY_BUILD_CERTIFICATION_CODES = [
  'KV414',
  'KV422',
  'KV426',
  'KV435',
  'KV311',
  'KV330',
];

export const SECURITY_BUILD_CERTIFICATION_SOURCES = [
  {
    description: 'Phase 0 metamorphic fixture-only security seeds',
    file: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
  },
];

export const SECURITY_BUILD_PROOFS = [
  {
    buildInvocation: 'cli-main-build',
    code: 'KV414',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName: 'runs Drizzle security extractors before artifact emission',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV422',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'fails project-mode data-plane analysis for JS source without Drizzle import spellings',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV426',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName: 'resolves local trustedHtml/trustedUrl barrels during production build preflight',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV426',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    requiredProofFileNeedles: ["import * as safeHtml from './safe-html.js';"],
    requiredNeedles: [
      'KV426',
      "export * from './safe-html-root'",
      'trustedHtmlStarBarrelElementAccessPreflightComponentSource()',
    ],
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'resolves star trustedHtml/trustedUrl barrels and literal element access during production build preflight',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'blocks local-helper Better Auth credential laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    code: 'KV311',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    requiredNeedles: [
      'buildProductionArtifact(root)',
      'expect(pageErrors).toEqual([])',
      'expect(consoleErrors).toEqual([])',
    ],
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'hydrates destructured state aliases from the production artifact without stale or throwing derives',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV330',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName: 'blocks task and webhook direct DB writes during build check preflight',
  },
];

export const PRODUCTION_BUILD_HELPERS = {
  'starter-build-production-artifact': {
    file: 'packages/create-kovo/src/index.build.test-support.ts',
    requiredNeedles: [
      'export function buildProductionArtifact',
      'execFileSync',
      "['build', './src/app.tsx', '--no-cache']",
    ],
  },
};

const BUILD_INVOCATION_PATTERNS = {
  'cli-main-build': [/mainAsync\(\s*\[\s*['"]build['"]/],
  'starter-build-production-artifact': [/\bbuildProductionArtifact\(/],
};

export function securityTestBuildGateViolations({
  certificationSources = SECURITY_BUILD_CERTIFICATION_SOURCES,
  proofs = SECURITY_BUILD_PROOFS,
  repoRoot = defaultRepoRoot,
  securityCodes = SECURITY_BUILD_CERTIFICATION_CODES,
} = {}) {
  const violations = [];
  const enrolledSecurityCodes = new Set(securityCodes);
  const sourceCodes = new Map();
  const knownSources = new Set(certificationSources.map((source) => source.file));

  for (const source of certificationSources) {
    const sourcePath = path.join(repoRoot, source.file);
    if (!existsSync(sourcePath)) {
      violations.push(`${source.file}: certification source does not exist`);
      continue;
    }
    const sourceText = readFileSync(sourcePath, 'utf8');
    const codes = extractMetamorphicSeedCodes(sourceText).filter((code) =>
      enrolledSecurityCodes.has(code),
    );
    sourceCodes.set(source.file, new Set(codes));
    for (const code of codes) {
      if (!proofs.some((proof) => proof.sourceFile === source.file && proof.code === code)) {
        violations.push(
          `${source.file} ${code}: security certification has no real kovo build proof`,
        );
      }
    }
  }

  for (const proof of proofs) {
    validateProof(proof, {
      enrolledSecurityCodes,
      knownSources,
      repoRoot,
      sourceCodes,
      violations,
    });
  }

  return violations;
}

export function extractMetamorphicSeedCodes(sourceText) {
  return [
    ...new Set([...sourceText.matchAll(/\bcode:\s*['"](KV\d{3})['"]/g)].map((match) => match[1])),
  ].sort((left, right) => left.localeCompare(right));
}

export function extractNamedTestBlock(sourceText, testName) {
  const nameIndex = sourceText.indexOf(testName);
  if (nameIndex === -1) return undefined;

  const testStartPattern = /(^|\n)\s*(?:it|test)(?:\.(?:skip|todo|only))?\s*\(/g;
  const starts = [...sourceText.matchAll(testStartPattern)].map((match) => match.index ?? 0);
  const start = starts.filter((index) => index <= nameIndex).at(-1) ?? nameIndex;
  const end = starts.find((index) => index > nameIndex) ?? sourceText.length;
  return sourceText.slice(start, end);
}

function validateProof(
  proof,
  { enrolledSecurityCodes, knownSources, repoRoot, sourceCodes, violations },
) {
  const label = `${proof.sourceFile} ${proof.code} -> ${proof.proofFile}`;
  if (!enrolledSecurityCodes.has(proof.code)) {
    violations.push(`${label}: proof code is not enrolled as a security certification code`);
  }
  if (!knownSources.has(proof.sourceFile)) {
    violations.push(`${label}: proof references an unknown certification source`);
  }
  if (sourceCodes.has(proof.sourceFile) && !sourceCodes.get(proof.sourceFile).has(proof.code)) {
    violations.push(`${label}: proof is stale; source does not certify ${proof.code}`);
  }

  const proofPath = path.join(repoRoot, proof.proofFile);
  if (!existsSync(proofPath)) {
    violations.push(`${label}: proof file does not exist`);
    return;
  }

  const proofText = readFileSync(proofPath, 'utf8');
  const testBlock = extractNamedTestBlock(proofText, proof.testName);
  if (testBlock === undefined) {
    violations.push(`${label}: proof test "${proof.testName}" was not found`);
    return;
  }

  if (proofTestIsSkippedOrTodo(testBlock)) {
    violations.push(`${label}: proof test is skipped or todo`);
  }

  const requiredNeedles = proof.requiredNeedles ?? [proof.code];
  for (const needle of requiredNeedles) {
    if (!testBlock.includes(needle)) {
      violations.push(
        `${label}: proof test is missing required evidence ${JSON.stringify(needle)}`,
      );
    }
  }
  for (const needle of proof.requiredProofFileNeedles ?? []) {
    if (!proofText.includes(needle)) {
      violations.push(
        `${label}: proof file is missing required evidence ${JSON.stringify(needle)}`,
      );
    }
  }
  if (!testBlockHasBuildInvocation(testBlock, proof.buildInvocation)) {
    violations.push(
      `${label}: proof test does not exercise the declared production build path (${proof.buildInvocation})`,
    );
  }
  validateBuildHelper(proof.buildInvocation, { repoRoot, violations });
}

function proofTestIsSkippedOrTodo(testBlock) {
  return /(^|\n)\s*(?:it|test)\.(?:skip|todo)\s*\(/.test(testBlock);
}

function testBlockHasBuildInvocation(testBlock, buildInvocation) {
  const patterns = BUILD_INVOCATION_PATTERNS[buildInvocation];
  return patterns?.some((pattern) => pattern.test(testBlock)) ?? false;
}

function validateBuildHelper(buildInvocation, { repoRoot, violations }) {
  const helper = PRODUCTION_BUILD_HELPERS[buildInvocation];
  if (!helper) return;

  const helperPath = path.join(repoRoot, helper.file);
  if (!existsSync(helperPath)) {
    violations.push(`${helper.file}: production build helper does not exist`);
    return;
  }
  const helperText = readFileSync(helperPath, 'utf8');
  for (const needle of helper.requiredNeedles) {
    if (!helperText.includes(needle)) {
      violations.push(
        `${helper.file}: ${buildInvocation} helper is missing required build evidence ${JSON.stringify(
          needle,
        )}`,
      );
    }
  }
}

function main() {
  const violations = securityTestBuildGateViolations();
  if (violations.length > 0) {
    process.stderr.write(`Security test build gate failed:\n`);
    for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Security test build gate passed (${SECURITY_BUILD_PROOFS.length} real-build proofs).\n`,
  );
}

if (process.argv[1] === thisFile) main();
