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
  'KV433',
  'KV435',
  'KV311',
  'KV330',
];

export const SECURITY_BUILD_CERTIFICATION_SOURCES = [
  {
    claimExtractor: 'metamorphic-seed-codes',
    description: 'Phase 0 metamorphic fixture-only security seeds',
    file: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'Production artifact security certification tests',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'Production artifact island derive certification tests',
    file: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'CLI build preflight security certification tests',
    file: 'packages/cli/src/index.kovo-build.test.ts',
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
    claimId: 'local-helper-credential-laundering',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addAuthSecretLeakProof(root)',
      'buildProductionArtifact(root)',
      'KV435',
      'Secret query value reaches the client wire',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper Better Auth credential laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'storage-query-write-prod-artifact',
    code: 'KV433',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addStorageQueryWriteProof(root)',
      'buildProductionArtifact(root)',
      'KV433',
      'operation=put',
      'operation=store',
      'operation=upload',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'blocks storage writes from query loaders in the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'trusted-output-prod-artifact',
    code: 'KV426',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addTrustedOutputProvenanceBuildProof(root)',
      'buildProductionArtifact(root)',
      'KV426',
      'trustedUrl() sends query-derived data',
      'renderedHtml() sends query-derived data',
      'trustedHtml() sends request-derived data',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'blocks trusted output provenance leaks through the production build artifact',
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
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'island-derive-prod-artifact',
    code: 'KV311',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    requiredNeedles: [
      'buildProductionArtifact(root)',
      'assertProdArtifactSinkCensus(root',
      'expect(pageErrors).toEqual([])',
      'expect(consoleErrors).toEqual([])',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
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
  {
    buildInvocation: 'cli-main-build',
    claimId: 'handler-direct-db-build-preflight',
    code: 'KV330',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    requiredNeedles: [
      'handlerWriteSinkPreflightAppModuleSource()',
      "mainAsync(['build', './app.ts', '--out', './dist', '--no-cache'])",
      'Direct db access in a mutation handler',
      'Direct db access in a task run body',
      'Direct db access in a webhook handler',
    ],
    sourceFile: 'packages/cli/src/index.kovo-build.test.ts',
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
  const sourceClaims = new Map();
  const knownSources = new Set(certificationSources.map((source) => source.file));

  for (const source of certificationSources) {
    const sourcePath = path.join(repoRoot, source.file);
    if (!existsSync(sourcePath)) {
      violations.push(`${source.file}: certification source does not exist`);
      continue;
    }
    const sourceText = readFileSync(sourcePath, 'utf8');
    const claims = extractCertificationClaims(source, sourceText, violations).filter((claim) =>
      enrolledSecurityCodes.has(claim.code),
    );
    sourceClaims.set(source.file, claims);
    for (const claim of claims) {
      if (!proofs.some((proof) => proofMatchesClaim(proof, source.file, claim))) {
        violations.push(
          `${formatClaimLabel(source.file, claim)}: security certification has no real kovo build proof`,
        );
      }
    }
  }

  for (const proof of proofs) {
    validateProof(proof, {
      enrolledSecurityCodes,
      knownSources,
      repoRoot,
      sourceClaims,
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

export function extractSecurityCertificationMarkers(sourceText) {
  return [
    ...sourceText.matchAll(/@kovo-security-certifies\s+(KV\d{3})(?:\s+([A-Za-z0-9_.:/-]+))?/g),
  ]
    .map((match) => ({
      claimId: match[2] ?? 'source-marker',
      code: match[1],
    }))
    .sort((left, right) =>
      left.code === right.code
        ? left.claimId.localeCompare(right.claimId)
        : left.code.localeCompare(right.code),
    );
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
  { enrolledSecurityCodes, knownSources, repoRoot, sourceClaims, violations },
) {
  const label = formatProofLabel(proof);
  if (!enrolledSecurityCodes.has(proof.code)) {
    violations.push(`${label}: proof code is not enrolled as a security certification code`);
  }
  if (!knownSources.has(proof.sourceFile)) {
    violations.push(`${label}: proof references an unknown certification source`);
  }
  if (
    sourceClaims.has(proof.sourceFile) &&
    !sourceClaims
      .get(proof.sourceFile)
      .some((claim) => proofMatchesClaim(proof, proof.sourceFile, claim))
  ) {
    violations.push(`${label}: proof is stale; source does not certify ${formatProofClaim(proof)}`);
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

function extractCertificationClaims(source, sourceText, violations) {
  const extractor = source.claimExtractor ?? 'metamorphic-seed-codes';
  if (extractor === 'metamorphic-seed-codes') {
    return extractMetamorphicSeedCodes(sourceText).map((code) => ({
      claimId: undefined,
      code,
    }));
  }
  if (extractor === 'security-certification-markers') {
    return extractSecurityCertificationMarkers(sourceText);
  }
  violations.push(`${source.file}: unknown security certification claim extractor ${extractor}`);
  return [];
}

function proofMatchesClaim(proof, sourceFile, claim) {
  if (proof.sourceFile !== sourceFile || proof.code !== claim.code) return false;
  return claim.claimId === undefined || proof.claimId === claim.claimId;
}

function formatClaimLabel(sourceFile, claim) {
  return `${sourceFile} ${formatClaim(claim)}`;
}

function formatProofLabel(proof) {
  return `${proof.sourceFile} ${formatProofClaim(proof)} -> ${proof.proofFile}`;
}

function formatProofClaim(proof) {
  return proof.claimId === undefined ? proof.code : `${proof.code}/${proof.claimId}`;
}

function formatClaim(claim) {
  return claim.claimId === undefined ? claim.code : `${claim.code}/${claim.claimId}`;
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
