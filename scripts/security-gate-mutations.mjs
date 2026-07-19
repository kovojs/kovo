#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build as buildWithEsbuild } from 'esbuild';
import { Project, SyntaxKind, ts } from 'ts-morph';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import * as authorizationMatrixGate from './check-authorization-matrix.mjs';
import * as sinkPolicyGate from './check-sink-policy-gate.mjs';
import * as fundamentalFixesCensusGate from './fundamental-fixes-census-gate.mjs';
import * as securityTestBuildGate from './security-test-build-gate.mjs';
import * as threatMatrixGate from './threat-matrix-gate.mjs';
import * as requestIngressPolicy from '../packages/server/src/request-ingress-policy.ts';

const repoRoot = findRepoRoot();
const scriptsDir = path.join(repoRoot, 'scripts');
const authorizationMatrixPath = path.join(repoRoot, 'security/authorization-matrix.json');
const sinkPolicyGatePath = path.join(scriptsDir, 'check-sink-policy-gate.mjs');
const fundamentalFixesCensusGatePath = path.join(scriptsDir, 'fundamental-fixes-census-gate.mjs');
const fundamentalFixesCensusManifestPath = path.join(
  scriptsDir,
  'fundamental-fixes-census.manifest.json',
);
const fundamentalFixesFollowupPlanPath = path.join(repoRoot, 'plans/fundamental-fixes-followup.md');
const securityTestBuildGatePath = path.join(scriptsDir, 'security-test-build-gate.mjs');
const coreFrameworkIdentityPath = path.join(
  repoRoot,
  'packages/core/src/internal/framework-identity.ts',
);
const compilerCompilePath = path.join(repoRoot, 'packages/compiler/src/compile.ts');
const compilerVitePath = path.join(repoRoot, 'packages/compiler/src/vite.ts');
const compilerSecuritySemanticGraphPath = path.join(
  repoRoot,
  'packages/compiler/src/scan/security-operation-ir.ts',
);
const compilerFiniteSecurityValidatorPath = path.join(
  repoRoot,
  'packages/compiler/src/validate/security-operation-ir.ts',
);
const compilerAuthoringSurfaceValidatorPath = path.join(
  repoRoot,
  'packages/compiler/src/validate/authoring-surface.ts',
);
const compilerOutputContextValidatorPath = path.join(
  repoRoot,
  'packages/compiler/src/security/output-context.ts',
);
const coreSinkPolicyPath = path.join(repoRoot, 'packages/core/src/internal/sink-policy.ts');
const inlineLoaderBuildPath = path.join(repoRoot, 'packages/browser/src/inline-loader-build.ts');
const compilerCapabilityClosureScannerPath = path.join(
  repoRoot,
  'packages/compiler/src/scan/capability-closure.ts',
);
const threatMatrixGatePath = path.join(scriptsDir, 'threat-matrix-gate.mjs');
const drizzleSessionProvenancePath = path.join(
  repoRoot,
  'packages/drizzle/src/static/session-provenance.ts',
);
const drizzleSummariesPath = path.join(repoRoot, 'packages/drizzle/src/static/summaries.ts');
const drizzleDerivationPath = path.join(repoRoot, 'packages/drizzle/src/static/derivation.ts');
const drizzleSymbolProvenancePath = path.join(
  repoRoot,
  'packages/drizzle/src/static/symbol-provenance.ts',
);
const drizzleTrustEscapesPath = path.join(repoRoot, 'packages/drizzle/src/trust-escapes-static.ts');
const trustedHtmlProvenancePath = path.join(
  repoRoot,
  'packages/compiler/src/validate/trusted-html-provenance.ts',
);
const sqlSafeHandlePath = path.join(repoRoot, 'packages/server/src/sql-safe-handle.ts');
const queryWireHtmlPath = path.join(repoRoot, 'packages/server/src/wire-html.ts');
const serverEgressPath = path.join(repoRoot, 'packages/server/src/egress.ts');
const taskRunnerPath = path.join(repoRoot, 'packages/server/src/task-runner.ts');
const webhookPath = path.join(repoRoot, 'packages/server/src/webhook.ts');
const betterAuthCredentialRuntimeGatePath = path.join(
  repoRoot,
  'packages/better-auth/src/internal/credential-runtime-gate.ts',
);
const requestIngressPolicyPath = path.join(
  repoRoot,
  'packages/server/src/request-ingress-policy.ts',
);
const serverBuildPath = path.join(repoRoot, 'packages/server/src/build.ts');

const runtimeSelectedExecutableReferenceClosureBranch =
  '      appendRuntimeSelectedExecutableReferenceDiagnostics(found, diagnostics, element);';
const removedRuntimeSelectedExecutableReferenceClosureBranch =
  '      // runtime-selected executable-reference closure removed by mutant';
const authoredExecutableReferenceClosureBranch = [
  '    appendAuthoredExecutableReferenceDiagnostics(',
  '      diagnostics,',
  '      options.fileName,',
  '      options.source,',
  '      model,',
  '    );',
].join('\n');
const removedAuthoredExecutableReferenceClosureBranch =
  '    // authored executable-reference provenance closure removed by mutant';
const dynamicBindingControlPlaneClosureBranch = [
  "  if (options.posture === 'dynamic-binding' && isGeneratedOnlySemanticAttribute(name)) {",
  '    return blockedDecision(',
  '      name,',
  "      'framework-control',",
  '      value,',
  "      'dynamic binding cannot mint or replace compiler-generated control-plane markup',",
  '    );',
  '  }',
].join('\n');
const removedDynamicBindingControlPlaneClosureBranch =
  '  // dynamic-binding control-plane closure removed by mutant';
const dynamicGeneratedControlTargetClosureBranch =
  '  return name !== null && isGeneratedOnlySemanticAttribute(name) ? name : null;';
const removedDynamicGeneratedControlTargetClosureBranch = '  return null;';
const inlineDynamicControlPlaneClosureBranch = [
  '    if (isGeneratedOnlyAttribute(n)) {',
  '      bns.removeElementAttribute(el, name);',
  '      return;',
  '    }',
].join('\n');
const removedInlineDynamicControlPlaneClosureBranch =
  '    // inline dynamic-binding control-plane closure removed by mutant';

const browserRtcNetworkCapabilityBranch = [
  'const globalCapabilities = new Map<string, RawCapabilityKind>([',
  "  ['Bun', 'process'],",
  "  ['Deno', 'process'],",
  "  ['EventSource', 'network'],",
  "  ['Function', 'vm'],",
  "  ['RTCPeerConnection', 'network'],",
].join('\n');
const weakenedBrowserRtcNetworkCapabilityBranch = [
  'const globalCapabilities = new Map<string, RawCapabilityKind>([',
  "  ['Bun', 'process'],",
  "  ['Deno', 'process'],",
  "  ['EventSource', 'network'],",
  "  ['Function', 'vm'],",
].join('\n');

const canonicalPostMethodBranch =
  "    if (equalsAsciiCaseInsensitive(method, 'post')) return method === 'POST';";
const weakenedCanonicalPostMethodBranch =
  "    if (equalsAsciiCaseInsensitive(method, 'post')) return true;";

const dualSchemeAuthorityIdentityBranch = [
  '      http.host === value &&',
  '      https.host === value &&',
].join('\n');
const weakenedDualSchemeAuthorityIdentityBranch = [
  '      http.host === value &&',
  '      true &&',
].join('\n');

const rawHttp1HostEvidenceBranch =
  '    if (input.rawHostHeaderCount !== 1 || input.rawHostHeaderValue !== input.host) return undefined;';
const weakenedRawHttp1HostEvidenceBranch =
  '    if (input.rawHostHeaderCount !== 1) return undefined;';

const exactIngressSchemeBranch = "    return value === 'http' || value === 'https'";
const weakenedExactIngressSchemeBranch = [
  "    if (value === 'HTTPS') return { ok: true, scheme: 'https' };",
  "    return value === 'http' || value === 'https'",
].join('\n');

const encodedIngressTargetBranch = [
  "        contains(rawTarget, '#') ||",
  '        containsEncodedPathControl(rawTarget)',
].join('\n');
const weakenedEncodedIngressTargetBranch = [
  "        contains(rawTarget, '#') ||",
  '        false',
].join('\n');

const h2IncompatibleSourceBranch = [
  "        input.httpVersion[0] !== '2' ||",
  '        input.host !== undefined ||',
  '        input.forwardedProto !== undefined ||',
].join('\n');
const weakenedH2IncompatibleSourceBranch = [
  "        input.httpVersion[0] !== '2' ||",
  '        input.forwardedProto !== undefined ||',
].join('\n');

const canonicalVercelClientBranch =
  '      if (clientIp === undefined || clientIp !== input.platformClientIp) {';
const weakenedCanonicalVercelClientBranch =
  '      if (false && (clientIp === undefined || clientIp !== input.platformClientIp)) {';

const preparedVercelIngressBranch = [
  '    const prepared = prepareVercelRequestIngress(nodeRequest);',
  '    if (rejectPreparedNodeRequestIngress(prepared, nodeResponse)) return;',
  '    const transport = preparedNodeRequestTransportMetadata(prepared);',
].join('\n');
const weakenedPreparedVercelIngressBranch = [
  '    const prepared = prepareVercelRequestIngress(nodeRequest);',
  '    if (rejectPreparedNodeRequestIngress(prepared, nodeResponse)) return;',
  '    const transport = preparedNodeRequestTransportMetadata(prepareVercelRequestIngress(nodeRequest));',
].join('\n');

const ownerReadCanary = [
  '      "id": "endpoint-builder-act-as-owner",',
  '      "principal": ["act-as-owner"],',
  '      "ownership": ["own", "other"],',
  '      "operation": "read",',
  '      "queryFamily": ["builder"],',
  '      "surface": "endpoint",',
  '      "expected": "allow-own-only"',
].join('\n');
const weakenedOwnerReadCanary = ownerReadCanary.replace(
  '"expected": "allow-own-only"',
  '"expected": "allow"',
);

const rawWriteCanary = [
  '      "id": "mutation-raw-cross-owner",',
  '      "principal": ["session-owner"],',
  '      "ownership": ["other"],',
  '      "operation": "insert",',
  '      "queryFamily": ["raw-sql"],',
  '      "surface": "mutation",',
  '      "expected": "deny"',
].join('\n');
const weakenedRawWriteCanary = rawWriteCanary.replace('"expected": "deny"', '"expected": "allow"');

const provisionRoleCanary = [
  '      "id": "runtime-provision-role-assumption-denied",',
  '      "principal": ["runtime-login"],',
  '      "ownership": ["not-applicable"],',
  '      "operation": "boot",',
  '      "queryFamily": ["none"],',
  '      "surface": "closure-audit",',
  '      "expected": "deny"',
].join('\n');
const weakenedProvisionRoleCanary = provisionRoleCanary.replace(
  '"expected": "deny"',
  '"expected": "allow"',
);

const definerFunctionCanary = [
  '      "id": "closure-cross-schema-definer-function-refusal",',
  '      "principal": ["runtime-login"],',
  '      "ownership": ["other", "unclassified"],',
  '      "operation": "boot",',
  '      "queryFamily": ["function"],',
  '      "surface": "closure-audit",',
  '      "expected": "boot-refuse"',
].join('\n');
const weakenedDefinerFunctionCanary = definerFunctionCanary.replace(
  '"expected": "boot-refuse"',
  '"expected": "allow"',
);

const durableTaskCanary = [
  '      "id": "durable-task-act-as-owner",',
  '      "principal": ["act-as-owner"],',
  '      "ownership": ["own", "other"],',
  '      "operation": "schedule",',
  '      "queryFamily": ["builder"],',
  '      "surface": "durable-task",',
  '      "expected": "allow-own-only"',
].join('\n');
const weakenedDurableTaskCanary = durableTaskCanary.replace(
  '"expected": "allow-own-only"',
  '"expected": "deny"',
);

const missingRealBuildProofBranch = [
  '      if (!proofs.some((proof) => proofMatchesClaim(proof, source.file, claim))) {',
  '        violations.push(',
  '          `${formatClaimLabel(source.file, claim)}: security proof-scope enrollment has no real kovo build proof`,',
  '        );',
  '      }',
].join('\n');

const removedMissingRealBuildProofBranch = [
  '      if (false && !proofs.some((proof) => proofMatchesClaim(proof, source.file, claim))) {',
  '        violations.push(',
  '          `${formatClaimLabel(source.file, claim)}: security proof-scope enrollment has no real kovo build proof`,',
  '        );',
  '      }',
].join('\n');

const securityCertificationMarkerExtractorBranch = [
  "  if (extractor === 'security-certification-markers') {",
  '    return extractSecurityCertificationMarkers(sourceText);',
  '  }',
].join('\n');

const removedSecurityCertificationMarkerExtractorBranch = [
  "  if (false && extractor === 'security-certification-markers') {",
  '    return extractSecurityCertificationMarkers(sourceText);',
  '  }',
].join('\n');

const staleProofRowBranch = [
  '  if (',
  '    sourceClaims.has(proof.sourceFile) &&',
  '    !sourceClaims',
  '      .get(proof.sourceFile)',
  '      .some((claim) => proofMatchesClaim(proof, proof.sourceFile, claim))',
  '  ) {',
  '    violations.push(`${label}: proof is stale; source does not enroll ${formatProofClaim(proof)}`);',
  '  }',
].join('\n');

const removedStaleProofRowBranch = [
  '  if (',
  '    false &&',
  '    sourceClaims.has(proof.sourceFile) &&',
  '    !sourceClaims',
  '      .get(proof.sourceFile)',
  '      .some((claim) => proofMatchesClaim(proof, proof.sourceFile, claim))',
  '  ) {',
  '    violations.push(`${label}: proof is stale; source does not enroll ${formatProofClaim(proof)}`);',
  '  }',
].join('\n');

const skippedProofBranch = [
  '  if (proofTestIsSkippedOrTodo(testBlock)) {',
  '    violations.push(`${label}: proof test is skipped or todo`);',
  '  }',
].join('\n');

const removedSkippedProofBranch = [
  '  if (false && proofTestIsSkippedOrTodo(testBlock)) {',
  '    violations.push(`${label}: proof test is skipped or todo`);',
  '  }',
].join('\n');

const requiredProofEvidenceBranch = [
  '    if (!testBlock.includes(needle)) {',
  '      violations.push(',
  '        `${label}: proof test is missing required evidence ${JSON.stringify(needle)}`,',
  '      );',
  '    }',
].join('\n');

const removedRequiredProofEvidenceBranch = [
  '    if (false && !testBlock.includes(needle)) {',
  '      violations.push(',
  '        `${label}: proof test is missing required evidence ${JSON.stringify(needle)}`,',
  '      );',
  '    }',
].join('\n');

const requiredProofFileEvidenceBranch = [
  '    if (!proofText.includes(needle)) {',
  '      violations.push(',
  '        `${label}: proof file is missing required evidence ${JSON.stringify(needle)}`,',
  '      );',
  '    }',
].join('\n');

const removedRequiredProofFileEvidenceBranch = [
  '    if (false && !proofText.includes(needle)) {',
  '      violations.push(',
  '        `${label}: proof file is missing required evidence ${JSON.stringify(needle)}`,',
  '      );',
  '    }',
].join('\n');

const jsToTsSiblingProofNeedle = `    requiredProofFileNeedles: ["import * as safeHtml from './safe-html.js';"],`;

const weakenedJsToTsSiblingProofNeedle = `    requiredProofFileNeedles: ["import * as safeHtml from './safe-html';"],`;

const kv311IslandDeriveProofEnrollmentBranch = [
  "    claimId: 'island-derive-prod-artifact',",
  "    code: 'KV311',",
  "    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',",
  '    requiredNeedles: [',
  "      'buildReusableProductionArtifact(root)',",
  "      'assertProdArtifactSinkCensus(root',",
  "      'state.count',",
  "      'state.items[0]',",
  '      \'state.extra["computed-key"]\',',
  "      'frameworkDataRequestsAfterInteraction',",
  "      'expect(pageErrors).toEqual([])',",
  "      'expect(consoleErrors).toEqual([])',",
  '    ],',
].join('\n');

const weakenedKv311IslandDeriveProofEnrollmentBranch = [
  "    claimId: 'island-derive-prod-artifact',",
  "    code: 'KV311',",
  "    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',",
  '    requiredNeedles: [',
  "      'buildReusableProductionArtifact(root)',",
  "      'expect(pageErrors).toEqual([])',",
  '    ],',
].join('\n');

const kv435SafeSiblingProofNeedle = `      'addAuthSecretLeakProof(safeRoot, { leakToWire: false })',`;

const weakenedKv435SafeSiblingProofNeedle = `      'addAuthSecretLeakProof(safeRoot)',`;

const kv426TrustedOutputSafeSiblingProofNeedle = `      'addTrustedOutputProvenanceBuildProof(safeRoot, { unsafe: false })',`;

const weakenedKv426TrustedOutputSafeSiblingProofNeedle = `      'addTrustedOutputProvenanceBuildProof(safeRoot)',`;

const kv426TrustedOutputGeneratedSinkNeedles = `      ...trustedOutputSinkPositionProofNeedles(),`;

const removedKv426TrustedOutputGeneratedSinkNeedles = `      // generated SINK-position proof needles removed by mutant`;

const readSourceGeneratedNeedles = `      ...readSourceFamilyProofNeedles().filter((needle) => needle.includes('derived data')),`;

const removedReadSourceGeneratedNeedles = `      // generated read-SOURCE proof needles removed by mutant`;

const wrappingGeneratedNeedles = `      ...securityWrappingProofNeedles().filter((needle) => needle.includes('derived data')),`;

const removedWrappingGeneratedNeedles = `      // generated wrapping proof needles removed by mutant`;

const paranoidAcceptanceGeneratedNeedles = [
  '    requiredNeedles: paranoidGeneratorAcceptanceProofNeedles().filter(',
  '      (needle) => needle !== "KOVO_PARANOID: \'1\'",',
  '    ),',
].join('\n');

const removedParanoidAcceptanceGeneratedNeedles = [
  '      // generated paranoid acceptance proof needles removed by mutant',
].join('\n');

const kv426TrustedUrlAttributeProofNeedle = `      'addTrustedUrlAttributeTypeGateProof(root)',`;

const weakenedKv426TrustedUrlAttributeProofNeedle = `      'TrustedUrl',`;

const kv433StorageDeleteProofNeedle = `      'operation=delete',`;

const weakenedKv433StorageDeleteProofNeedle = `      'storage-delete-write-query',`;

const kv330WebhookContextTxEscapeProofEnrollmentBranch = [
  "    claimId: 'webhook-context-tx-raw-driver-escape-prod-artifact',",
  "    code: 'KV330',",
  "    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',",
  '    requiredNeedles: [',
  "      'addRuntimeMutationSafetyProofs(root, { includeWebhookTxEscapeAttempt: true })',",
  "      'captureProductionBuildFailure(() => buildProductionArtifact(root))',",
  "      'KV330',",
  "      'Direct db access in a webhook handler',",
  "      'runtime-safety-proofs.ts',",
  '    ],',
].join('\n');

const weakenedKv330WebhookContextTxEscapeProofEnrollmentBranch = [
  "    claimId: 'webhook-context-tx-raw-driver-escape-prod-artifact',",
  "    code: 'KV330',",
  "    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',",
  '    requiredNeedles: [',
  "      'KV330',",
  '    ],',
].join('\n');

const trustedHtmlCallTaintFailClosedBranch = `    return firstProvenance([argumentProvenance, calleeProvenance]) ?? 'unprovable';`;

const weakenedTrustedHtmlCallTaintFailClosedBranch = `    return firstProvenance([argumentProvenance, calleeProvenance]);`;

const productionBuildInvocationBranch = [
  '  if (!testBlockHasBuildInvocation(testBlock, proof.buildInvocation)) {',
  '    violations.push(',
  '      `${label}: proof test does not exercise the declared production build path (${proof.buildInvocation})`,',
  '    );',
  '  }',
].join('\n');

const removedProductionBuildInvocationBranch = [
  '  if (false && !testBlockHasBuildInvocation(testBlock, proof.buildInvocation)) {',
  '    violations.push(',
  '      `${label}: proof test does not exercise the declared production build path (${proof.buildInvocation})`,',
  '    );',
  '  }',
].join('\n');

const buildHelperEvidenceBranch = [
  '    if (!helperText.includes(needle)) {',
  '      violations.push(',
  '        `${helper.file}: ${buildInvocation} helper is missing required build evidence ${JSON.stringify(',
  '          needle,',
  '        )}`,',
  '      );',
  '    }',
].join('\n');

const removedBuildHelperEvidenceBranch = [
  '    if (false && !helperText.includes(needle)) {',
  '      violations.push(',
  '        `${helper.file}: ${buildInvocation} helper is missing required build evidence ${JSON.stringify(',
  '          needle,',
  '        )}`,',
  '      );',
  '    }',
].join('\n');

const sqlGuardEnvBranch = [
  '  if (/\\bKOVO_SQL_GUARD\\b/.test(source)) {',
  "    addFinding('KOVO_SQL_GUARD env knob');",
  '  }',
].join('\n');

const removedSqlGuardEnvBranch = [
  '  if (false && /\\bKOVO_SQL_GUARD\\b/.test(source)) {',
  "    addFinding('KOVO_SQL_GUARD env knob');",
  '  }',
].join('\n');

const managedDbThrowBranch = [
  '    if (!returnsOnValidThenThrows) {',
  '      findings.push(`${filePath}: managed DB handle must throw on failed SQL validation`);',
  '    }',
].join('\n');

const removedManagedDbThrowBranch = [
  '    if (false && !returnsOnValidThenThrows) {',
  '      findings.push(`${filePath}: managed DB handle must throw on failed SQL validation`);',
  '    }',
].join('\n');

const managedRawDriverEscapeBranch = [
  '      if (writePolicy !== undefined && isManagedRawDriverEscapeProperty(prop)) {',
  '        throw new Error(',
  '          `KV422: managed DB raw driver escape ${describeSqlMethod(prop)} is not exposed from framework-owned handles (SPEC §10.2/§10.3). Use the managed SQL methods so statement provenance and declared-table enforcement remain attached.`,',
  '        );',
  '      }',
].join('\n');

const removedManagedRawDriverEscapeBranch = [
  '      if (false && writePolicy !== undefined && isManagedRawDriverEscapeProperty(prop)) {',
  '        throw new Error(',
  '          `KV422: managed DB raw driver escape ${describeSqlMethod(prop)} is not exposed from framework-owned handles (SPEC §10.2/§10.3). Use the managed SQL methods so statement provenance and declared-table enforcement remain attached.`,',
  '        );',
  '      }',
].join('\n');

const responseFragmentTrustedHtmlRouteBranch = [
  '  if (trustedHtmlSinkRoutes.length !== 2) {',
  '    findings.push(',
  '      `${filePath}: response-fragment HTML sink must route exactly two membrane parse inputs through the injected createHTML control; found ${trustedHtmlSinkRoutes.length}`,',
  '    );',
  '  }',
].join('\n');

const removedResponseFragmentTrustedHtmlRouteBranch = [
  '  if (false && trustedHtmlSinkRoutes.length !== 2) {',
  '    findings.push(',
  '      `${filePath}: response-fragment HTML sink must route exactly two membrane parse inputs through the injected createHTML control; found ${trustedHtmlSinkRoutes.length}`,',
  '    );',
  '  }',
].join('\n');

const queryWireHtmlEscapeBranch = '${escapeHtml(stringifyKovoWireValue(options.value))}';

const removedQueryWireHtmlEscapeBranch = '${stringifyKovoWireValue(options.value)}';

const betterAuthCredentialResultIdentityBranch =
  '  if (registered === undefined || registered.consumer !== consumer) {';

const removedBetterAuthCredentialResultIdentityBranch =
  '  if (registered === undefined || false) {';

const betterAuthCredentialSourceIdentityBranch = '  if (contract.source !== source) {';

const removedBetterAuthCredentialSourceIdentityBranch = '  if (false) {';

const m5ForbiddenStatusBranch = [
  '  } else if (FORBIDDEN_STATUS_PATTERN.test(row.status)) {',
  '    violations.push(`${label}: M5 forbids status ${JSON.stringify(row.status)}`);',
].join('\n');

const removedM5ForbiddenStatusBranch = [
  '  } else if (false && FORBIDDEN_STATUS_PATTERN.test(row.status)) {',
  '    violations.push(`${label}: M5 forbids status ${JSON.stringify(row.status)}`);',
].join('\n');

const closedRowM1EvidenceBranch =
  "    if (row.status === 'closed') validateClosedRow(row, manifest?.adversarialGate, violations);";

const removedClosedRowM1EvidenceBranch =
  "    if (false && row.status === 'closed') validateClosedRow(row, manifest?.adversarialGate, violations);";

const dialectMatrixRequirementBranch = '  validateDialectMatrixRows(rows, violations);';

const removedDialectMatrixRequirementBranch =
  '  if (false) validateDialectMatrixRows(rows, violations);';

const resolverExpressionKindDenominatorBranch =
  "export const REQUIRED_RESOLVER_EXPRESSION_KINDS = [...typescriptExpressionKindNames(), 'default'];";

const driftedResolverExpressionKindDenominatorBranch =
  "export const REQUIRED_RESOLVER_EXPRESSION_KINDS = ['default'];";

const resolverStatusRequirementBranch = [
  '    if (!ALLOWED_RESOLVER_STATUSES.includes(row.resolverStatus)) {',
  '      violations.push(',
  "        `${row.id ?? '<missing-id>'}: resolverStatus must be one of ${ALLOWED_RESOLVER_STATUSES.join(",
  "          ', ',",
  '        )}`,',
  '      );',
  '    }',
].join('\n');

const removedResolverStatusRequirementBranch = [
  '    if (false && !ALLOWED_RESOLVER_STATUSES.includes(row.resolverStatus)) {',
  '      violations.push(',
  "        `${row.id ?? '<missing-id>'}: resolverStatus must be one of ${ALLOWED_RESOLVER_STATUSES.join(",
  "          ', ',",
  '        )}`,',
  '      );',
  '    }',
].join('\n');

const resolverCoverageExpectationRequirementBranch = [
  '    if (',
  "      typeof row.coverageExpectation !== 'string' ||",
  '      row.coverageExpectation.trim().length === 0 ||',
  '      PLACEHOLDER_EVIDENCE_PATTERN.test(row.coverageExpectation.trim())',
  '    ) {',
  "      violations.push(`${row.id ?? '<missing-id>'}: resolver row is missing coverageExpectation`);",
  '    }',
].join('\n');

const removedResolverCoverageExpectationRequirementBranch = [
  '    if (',
  '      false &&',
  "      (typeof row.coverageExpectation !== 'string' ||",
  '        row.coverageExpectation.trim().length === 0 ||',
  '        PLACEHOLDER_EVIDENCE_PATTERN.test(row.coverageExpectation.trim()))',
  '    ) {',
  "      violations.push(`${row.id ?? '<missing-id>'}: resolver row is missing coverageExpectation`);",
  '    }',
].join('\n');

const unknownResolverExpressionKindBranch = [
  '    if (',
  "      typeof row.expressionKind === 'string' &&",
  '      !REQUIRED_RESOLVER_EXPRESSION_KINDS.includes(row.expressionKind)',
  '    ) {',
  '      violations.push(`${row.id}: unknown resolver expressionKind ${row.expressionKind}`);',
  '    }',
].join('\n');

const removedUnknownResolverExpressionKindBranch = [
  '    if (',
  '      false &&',
  "      typeof row.expressionKind === 'string' &&",
  '      !REQUIRED_RESOLVER_EXPRESSION_KINDS.includes(row.expressionKind)',
  '    ) {',
  '      violations.push(`${row.id}: unknown resolver expressionKind ${row.expressionKind}`);',
  '    }',
].join('\n');

const coreElementAccessResolverBranch = [
  '    case ts.SyntaxKind.ElementAccessExpression:',
  "      return 'resolve-element-access';",
].join('\n');

const removedCoreElementAccessResolverBranch = [
  '    case ts.SyntaxKind.ElementAccessExpression:',
  "      return 'fail-closed';",
].join('\n');

const coreElementAccessCanonicalBranch = [
  "    case 'resolve-element-access': {",
  '      if (!ts.isElementAccessExpression(node)) return undefined;',
  '      const member = elementAccessMemberName(ts, node);',
  '      return member',
  '        ? namespaceMemberIdentity(ts, sourceFile, node.expression, member, options, seen, depth + 1)',
  '        : undefined;',
  '    }',
].join('\n');

const removedCoreElementAccessCanonicalBranch = [
  "    case 'resolve-element-access': {",
  '      return undefined;',
  '    }',
].join('\n');

const coreExportStarResolverBranch = [
  '      if (!exportClause) {',
  '        if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) continue;',
  '        const specifier = moduleSpecifier.text;',
  '        const starIdentity =',
  '          specifierExportIdentity(specifier, exportName) ??',
  '          localModuleExportIdentity(',
  '            ts,',
  '            sourceFile,',
  '            specifier,',
  '            exportName,',
  '            options,',
  '            seen,',
  '            depth + 1,',
  '          );',
  '        if (starIdentity) return starIdentity;',
  '      }',
].join('\n');

const removedCoreExportStarResolverBranch = [
  '      if (!exportClause) {',
  '        continue;',
  '      }',
].join('\n');

const compileSiblingRegistrationBranch = [
  '  registerFrameworkIdentityProject(',
  '    sourceFile,',
  "    compilerMapDense(options.extraFiles, 'Compiler framework-identity files', (file) =>",
  '      parseSourceFile(file.fileName, file.source),',
  '    ),',
  '  );',
].join('\n');

const removedCompileSiblingRegistrationBranch = ['  return;'].join('\n');

const viteJsToTsSiblingCandidatesBranch = [
  "      case '.js':",
  '        return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`, basePath];',
].join('\n');

const weakenedViteJsToTsSiblingCandidatesBranch = [
  "      case '.js':",
  '        return [basePath];',
].join('\n');

const frameworkEgressOriginCheck =
  '  const originBlocked = evaluateFrameworkDestinationOrigin({ host, port, protocol, policy });';
const removedFrameworkEgressOriginCheck = '  const originBlocked = null;';
const frameworkEgressDispatcherPin =
  '  request = egressRequestWithDispatcher(request, dispatcher);';
const removedFrameworkEgressDispatcherPin = '  request = request;';
const taskEgressCapabilitySeal =
  "    return taskDefineDataProperty(context, 'fetch', frameworkEgressFetch);";
const removedTaskEgressCapabilitySeal = '    return context;';
const webhookEgressCapabilitySeal = [
  "  witnessDefineProperty(context, 'fetch', {",
  '    configurable: false,',
  '    enumerable: true,',
  '    value: frameworkEgressFetch,',
  '    writable: false,',
  '  });',
].join('\n');
const removedWebhookEgressCapabilitySeal = '';

const semanticCycleClosureBranch =
  '  if (signature !== undefined && compilerSetHas(state.active, signature)) {';
const removedSemanticCycleClosureBranch =
  '  if (false && signature !== undefined && compilerSetHas(state.active, signature)) {';
const semanticDepthClosureBranch =
  '          if (depth + 1 > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) {';
const removedSemanticDepthClosureBranch =
  '          if (false && depth + 1 > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) {';
const semanticNodeBudgetClosureBranch = '    if (state.nodes > SECURITY_SEMANTIC_NODE_BUDGET) {';
const removedSemanticNodeBudgetClosureBranch =
  '    if (false && state.nodes > SECURITY_SEMANTIC_NODE_BUDGET) {';
const semanticOperationBudgetClosureBranch =
  '      if (state.operations > SECURITY_SEMANTIC_OPERATION_BUDGET) {';
const removedSemanticOperationBudgetClosureBranch =
  '      if (false && state.operations > SECURITY_SEMANTIC_OPERATION_BUDGET) {';
const semanticSummaryBudgetClosureBranch =
  '    if (state.summaries > SECURITY_SEMANTIC_SUMMARY_BUDGET) {';
const removedSemanticSummaryBudgetClosureBranch =
  '    if (false && state.summaries > SECURITY_SEMANTIC_SUMMARY_BUDGET) {';
const semanticSurfacePropagationBranch = [
  '            state,',
  '            surface,',
  '            transfers: nextTransfers,',
].join('\n');
const weakenedSemanticSurfacePropagationBranch = [
  '            state,',
  "            surface: 'endpoint',",
  '            transfers: nextTransfers,',
].join('\n');
const semanticOperationMemberClosureBranch =
  "  if (compilerStringStartsWith(receiver, 'operation:')) return 'unknown-authority';";
const weakenedSemanticOperationMemberClosureBranch =
  "  if (compilerStringStartsWith(receiver, 'operation:')) return receiver;";
const semanticMemberMutationClosureBranch =
  '      if (!ts.isIdentifier(left) && serverExpressionCarriesAuthority(left, aliases)) {';
const removedSemanticMemberMutationClosureBranch =
  '      if (false && !ts.isIdentifier(left) && serverExpressionCarriesAuthority(left, aliases)) {';
const semanticArgumentsClosureBranch =
  '  if (authorityInputs.length > 0 && semanticBodyUsesArguments(callable.body)) {';
const removedSemanticArgumentsClosureBranch =
  '  if (false && authorityInputs.length > 0 && semanticBodyUsesArguments(callable.body)) {';
const semanticNestedCaptureClosureBranch =
  '      if (nestedServerFunctionCapturesAuthority(node, aliases)) {';
const removedSemanticNestedCaptureClosureBranch =
  '      if (false && nestedServerFunctionCapturesAuthority(node, aliases)) {';
const semanticOpaqueContainerClosureBranch =
  "      if (initializerProvenance === 'unknown-authority') {";
const removedSemanticOpaqueContainerClosureBranch =
  "      if (false && initializerProvenance === 'unknown-authority') {";
const semanticRestArgumentClosureBranch =
  '      } else if (restParameterIndex !== undefined && index >= restParameterIndex) {';
const removedSemanticRestArgumentClosureBranch =
  '      } else if (false && restParameterIndex !== undefined && index >= restParameterIndex) {';
const semanticTableNamespaceClosureBranch = [
  "    return member === 'all' || member === 'count' || member === 'get' || member === 'values'",
  "      ? serverOperationProvenance('server.database.read')",
  "      : 'unknown-authority';",
].join('\n');
const weakenedSemanticTableNamespaceClosureBranch = [
  '    const kind = databaseOperationKind(member);',
  "    return kind ? serverOperationProvenance(kind) : 'unknown-authority';",
].join('\n');

const semanticV2SourceByteEqualityBranch =
  '    if (!sourceFile || !semanticSource || semanticSource.source !== file.source) return new Map();';
const weakenedSemanticV2SourceByteEqualityBranch =
  '    if (!sourceFile || !semanticSource) return new Map();';
const semanticV2SchemaBranch =
  "      if (graph.schema !== 'kovo-security-semantic-graph/v2') return new Map();";
const weakenedSemanticV2SchemaBranch =
  "      if (false && graph.schema !== 'kovo-security-semantic-graph/v2') return new Map();";
const semanticV2FactoryRootBranch = [
  '    requestCompilerSemanticRootForFactoryCall(binding.factory, factoryCall, fileName) !==',
  '      root.root ||',
].join('\n');
const weakenedSemanticV2FactoryRootBranch = '    false ||';
const semanticV2CallableSpanBranch = [
  '      binding.callableSpan.start !== root.declaration.getStart() ||',
  '      binding.callableSpan.end !== root.declaration.getEnd() ||',
].join('\n');
const weakenedSemanticV2CallableSpanBranch = ['      false ||', '      false ||'].join('\n');
const semanticV2HelperCallableSpanLookupBranch =
  '  return session.compilerSemanticHelperProofs.get(key) ?? [];';
const weakenedSemanticV2HelperCallableSpanLookupBranch = [
  '  return (',
  '    session.compilerSemanticHelperProofs.get(key) ??',
  '    [...session.compilerSemanticHelperProofs.values()].flat()',
  '  );',
].join('\n');
const semanticV2FactoryCallSpanBranch = [
  '      binding.factoryCallSpan.start !== rootFactoryCall.getStart() ||',
  '      binding.factoryCallSpan.end !== rootFactoryCall.getEnd() ||',
].join('\n');
const weakenedSemanticV2FactoryCallSpanBranch = ['      false ||', '      false ||'].join('\n');
const semanticV2HelperCallSpanBranch = [
  '      proof.callSpan.start !== call.getStart() ||',
  '      proof.callSpan.end !== call.getEnd() ||',
].join('\n');
const weakenedSemanticV2HelperCallSpanBranch = ['      false ||', '      false ||'].join('\n');
const semanticV2ArgumentSpanBranch = [
  '      invocation.argumentSpans.length !== invocationCall.getArguments().length ||',
  '      invocation.argumentSpans.some(',
  '        (span, index) =>',
  '          !requestCompilerSemanticSpanIsValid(span, sourceLength) ||',
  '          span.start !== invocationCall.getArguments()[index]?.getStart() ||',
  '          span.end !== invocationCall.getArguments()[index]?.getEnd(),',
  '      ) ||',
].join('\n');
const weakenedSemanticV2ArgumentSpanBranch = '      false ||';
const semanticV2AuthorityReconstructionBranch = [
  '      proof.authorityInputs.length !== expectedAuthorityInputs.length ||',
  '      proof.authorityInputs.some(',
  '        (authority, index) => authority !== expectedAuthorityInputs[index],',
  '      ) ||',
].join('\n');
const weakenedSemanticV2AuthorityReconstructionBranch = '      false ||';
const semanticV2OperationInventoryBranch = [
  '      !requestCompilerSemanticDatabaseOperationInventoryMatches(',
  '        proof.operationKinds,',
  '        expectedDatabaseOperations,',
  '      ) ||',
].join('\n');
const weakenedSemanticV2OperationInventoryBranch = '      false ||';
const semanticV2ClosedRootBranch =
  "        const rootClosed = root.traces.some((trace) => trace.verdict === 'closed');";
const weakenedSemanticV2ClosedRootBranch = '        const rootClosed = false;';
const semanticV2ClosedSiblingBranch = '  for (const key of invalidProofKeys) proofs.delete(key);';
const weakenedSemanticV2ClosedSiblingBranch = '  void invalidProofKeys;';

const exactTrustedAssignIdentityBranch =
  '  if (frameworkIdentityIn(frameworkIdentity, SERVER_REVIEWED_DATA_HELPER_IDENTITIES)) {';
const weakenedExactTrustedAssignIdentityBranch = [
  '  if (',
  '    frameworkIdentityIn(frameworkIdentity, SERVER_REVIEWED_DATA_HELPER_IDENTITIES) ||',
  "    (ts.isIdentifier(callee) && callee.text === 'trustedAssign')",
  '  ) {',
].join('\n');
const ambientErrorStabilityBranch = [
  '            (compilerSetHas(serverPureConstructors, callee.text) &&',
  '              securityIrMemberCallableIsStable(sourceFile, callee, node))) &&',
].join('\n');
const weakenedAmbientErrorStabilityBranch =
  '            compilerSetHas(serverPureConstructors, callee.text)) &&';
const ambientCryptoRandomUuidStabilityBranch =
  '    securityIrMemberCallableIsStable(sourceFile, callee, call) &&';
const weakenedAmbientCryptoRandomUuidStabilityBranch = '    true &&';
const finiteManagedDatabaseContinuationBranch =
  '      compilerSetHas(serverReviewedDatabaseBuilderMethods, member.name) &&';
const weakenedFiniteManagedDatabaseContinuationBranch = '      true &&';
const managedDatabaseForeignArgumentClosureBranch =
  '      !serverArgumentsContainUnreviewedForeignExecutable(sourceFile, call.arguments, aliases)';
const weakenedManagedDatabaseForeignArgumentClosureBranch = '      true';
const exactProjectSchemaFactoryIdentityBranch =
  '  return frameworkIdentityIn(factoryIdentity, SERVER_REVIEWED_DATABASE_TABLE_FACTORY_IDENTITIES);';
const weakenedExactProjectSchemaFactoryIdentityBranch = '  return factoryIdentity !== undefined;';
const immutableProjectSchemaBindingBranch = [
  '  if (!declaration?.initializer || serverBindingOrMemberIsAssigned(target, imported.exportName)) {',
  '    return false;',
  '  }',
].join('\n');
const weakenedImmutableProjectSchemaBindingBranch = [
  '  if (!declaration?.initializer) {',
  '    return false;',
  '  }',
].join('\n');
const renderEquivalenceProjectIdentityBranch = [
  '  const registryFactsOptions = {',
  '    fileName: parsed.compileOptions.fileName,',
  '    ...(parsed.compileOptions.extraFiles?.length',
  '      ? { extraFiles: parsed.compileOptions.extraFiles }',
  '      : {}),',
  '    ...(parsed.compileOptions.registryFacts',
  '      ? { registryFacts: parsed.compileOptions.registryFacts }',
  '      : {}),',
  '  };',
].join('\n');
const weakenedRenderEquivalenceProjectIdentityBranch = [
  '  const registryFactsOptions = {',
  '    fileName: parsed.compileOptions.fileName,',
  '    ...(parsed.compileOptions.registryFacts',
  '      ? { registryFacts: parsed.compileOptions.registryFacts }',
  '      : {}),',
  '  };',
].join('\n');

const exactContextFetchInvocationBranch = [
  '    !Node.isPropertyAccessExpression(callee) ||',
  '    callee.getQuestionDotTokenNode() ||',
  '    call.getQuestionDotTokenNode() ||',
  "    callee.getName() !== 'fetch' ||",
  '    !requestExpressionIsExactFrameworkContext(callee.getExpression(), callable, session)',
].join('\n');
const weakenedExactContextFetchInvocationBranch = [
  '    false ||',
  '    false ||',
  '    false ||',
  "    callee.getName() !== 'fetch' ||",
  '    !requestExpressionIsExactFrameworkContext(callee.getExpression(), callable, session)',
].join('\n');

const analyzerSummaryStructuralProofBranch =
  '    const proven = exactLocalPrivateScopeHelperProvenance(helper, sourceFile);';
const weakenedAnalyzerSummaryStructuralProofBranch = '    const proven = declared;';
const analyzerSummaryCallCarrierBranch = [
  '    return privateScopeHelperCallCarrierIsProven(expression)',
  '      ? helperSummaryForCallCallee(callee, context.helpers)',
  '      : undefined;',
].join('\n');
const weakenedAnalyzerSummaryCallCarrierBranch =
  '    return helperSummaryForCallCallee(callee, context.helpers);';
const analyzerSummarySoleCarrierArgumentBranch = [
  '  const args = call.getArguments();',
  '  // SPEC §6.6/§10.3 requires the exact carrier as the sole argument. Extra argument evaluation can',
  '  // mutate that carrier before the helper body reads it, including through a strict-TS widened',
  '  // direct alias; a spread is an independent evaluation channel even when its static tuple is empty.',
  '  if (args.length !== 1 || args.some(Node.isSpreadElement)) return false;',
].join('\n');
const weakenedAnalyzerSummarySoleCarrierArgumentBranch = [
  '  const args = call.getArguments();',
  '  // SPEC §6.6/§10.3 requires the exact carrier as the sole argument. Extra argument evaluation can',
  '  // mutate that carrier before the helper body reads it, including through a strict-TS widened',
  '  // direct alias; a spread is an independent evaluation channel even when its static tuple is empty.',
  '  if (args.length === 0 || args.some(Node.isSpreadElement)) return false;',
].join('\n');
const analyzerSummaryDirectAliasSnapshotBranch = [
  '  addLocalHelperSummaryAliases(sourceFile, new Map(summaries), summaries);',
  '  return summaries;',
].join('\n');
const weakenedAnalyzerSummaryDirectAliasSnapshotBranch = [
  '  addLocalHelperSummaryAliases(sourceFile, summaries, summaries);',
  '  return summaries;',
].join('\n');
const analyzerSummaryOppAliasChainClosureBranch = [
  '  // The shared helper map already contains the structurally proved callable and at most one direct',
  '  // immutable alias. Recursing through another const initializer would create an unreviewed second',
  '  // hop in only this OPP consumer (SPEC §6.6/§10.3).',
  '  return undefined;',
].join('\n');
const weakenedAnalyzerSummaryOppAliasChainClosureBranch = [
  '  // The shared helper map already contains the structurally proved callable and at most one direct',
  '  // immutable alias. Recursing through another const initializer would create an unreviewed second',
  '  // hop in only this OPP consumer (SPEC §6.6/§10.3).',
  '  if (Node.isIdentifier(node)) {',
  '    const initializer = stableLocalConstInitializer(node);',
  '    return initializer',
  '      ? summarizedStaticCallablePrivateScope(initializer, sessionContext, depth + 1)',
  '      : undefined;',
  '  }',
  '  return undefined;',
].join('\n');
const analyzerSummaryUnenrolledCarrierClosureBranch = '  if (frameworkRole !== true) return false;';
const weakenedAnalyzerSummaryUnenrolledCarrierClosureBranch =
  '  if (frameworkRole === false) return false;';
const analyzerSummaryCarrierIntegrityBranch =
  '  return privateScopeCarrierBindingIsStableAtUse(parameter, callable, auditedUse);';
const weakenedAnalyzerSummaryCarrierIntegrityBranch = '  return true;';
const analyzerSummaryDirectCarrierIntegrityBranch =
  '  if (!privateScopeCarrierBindingIsProven(segments.root, expression)) return undefined;';
const weakenedAnalyzerSummaryDirectCarrierIntegrityBranch =
  '  if (false && !privateScopeCarrierBindingIsProven(segments.root, expression)) return undefined;';
const analyzerSummaryDestructuredCarrierProofBranch =
  '  return segments !== undefined && privateScopeCarrierBindingIsProven(segments.root, node);';
const weakenedAnalyzerSummaryDestructuredCarrierProofBranch = '  return segments !== undefined;';
const analyzerSummarySessionAliasCarrierProofBranch = [
  'function directNonNullableSessionScopePath(node: Node): string | undefined {',
  '  const expression = unwrappedStaticExpressionNode(node);',
  '  const segments = staticAccessSegments(node);',
  '  if (!segments) return undefined;',
  '  if (!privateScopeCarrierBindingIsProven(segments.root, expression)) return undefined;',
].join('\n');
const weakenedAnalyzerSummarySessionAliasCarrierProofBranch = [
  'function directNonNullableSessionScopePath(node: Node): string | undefined {',
  '  const expression = unwrappedStaticExpressionNode(node);',
  '  const segments = staticAccessSegments(node);',
  '  if (!segments) return undefined;',
  '  if (false && !privateScopeCarrierBindingIsProven(segments.root, expression)) return undefined;',
].join('\n');
const analyzerSummaryAcceptedGuardCarrierProofBranch = [
  'function directGuardPrivateScopePath(node: Node): string | undefined {',
  '  const expression = unwrappedStaticExpressionNode(node);',
  '  const segments = staticAccessSegments(node);',
  '  if (!segments) return undefined;',
  '  if (!privateScopeCarrierBindingIsProven(segments.root, expression)) return undefined;',
].join('\n');
const weakenedAnalyzerSummaryAcceptedGuardCarrierProofBranch = [
  'function directGuardPrivateScopePath(node: Node): string | undefined {',
  '  const expression = unwrappedStaticExpressionNode(node);',
  '  const segments = staticAccessSegments(node);',
  '  if (!segments) return undefined;',
  '  if (false && !privateScopeCarrierBindingIsProven(segments.root, expression)) return undefined;',
].join('\n');
const analyzerSummaryOpaqueCarrierEscapeBranch = [
  '    if (referenceKey !== parameterKey || nodeContains(auditedUse, reference)) continue;',
  '    if (!privateScopeCarrierReferenceHasReviewedConsumer(reference, parameterKey, body)) return false;',
].join('\n');
const weakenedAnalyzerSummaryOpaqueCarrierEscapeBranch = [
  '    if (referenceKey !== parameterKey || nodeContains(auditedUse, reference)) continue;',
  '    continue;',
].join('\n');
const analyzerSummaryPrivatePathPrefixBranch =
  "  return privateIndex === 0 || (privateIndex === 1 && path[0] === 'request');";
const weakenedAnalyzerSummaryPrivatePathPrefixBranch = '  return privateIndex >= 0;';
const analyzerSummaryDirectPrivatePathPrefixBranch = [
  '    // Query contexts expose private request state through `.request`; other enrolled callbacks',
  "    // receive the request directly. A carrier's app-controlled `.input.guard`-style subtree is",
  '    // never principal provenance merely because one of its nested property names matches.',
  '    if (!privateScopePathHasExactCarrierPrefix(segments.path, index)) continue;',
].join('\n');
const weakenedAnalyzerSummaryDirectPrivatePathPrefixBranch = [
  '    // Query contexts expose private request state through `.request`; other enrolled callbacks',
  "    // receive the request directly. A carrier's app-controlled `.input.guard`-style subtree is",
  '    // never principal provenance merely because one of its nested property names matches.',
  '    if (false && !privateScopePathHasExactCarrierPrefix(segments.path, index)) continue;',
].join('\n');
const analyzerSummaryDestructuringDefaultClosureBranch =
  '  if (segmentElements.some((element) => element.getInitializer() !== undefined)) return undefined;';
const weakenedAnalyzerSummaryDestructuringDefaultClosureBranch =
  '  if (false && segmentElements.some((element) => element.getInitializer() !== undefined)) return undefined;';
const analyzerSummaryMutableScalarTransferClosureBranch =
  '  return definitelyImmutablePrivateScopeScalarType(expression.getType());';
const weakenedAnalyzerSummaryMutableScalarTransferClosureBranch = '  return true;';
const analyzerSummaryFiniteExitGrammarBranch = [
  '  // Framework failure/redirect/not-found helpers return typed outcomes. A bare expression call—',
  '  // exact or merely same-named—does not exit JavaScript control flow; the app must return it.',
  '  return false;',
].join('\n');
const weakenedAnalyzerSummaryFiniteExitGrammarBranch = [
  '  // Framework failure/redirect/not-found helpers return typed outcomes. A bare expression call—',
  '  // exact or merely same-named—does not exit JavaScript control flow; the app must return it.',
  '  return Node.isExpressionStatement(statement);',
].join('\n');
const analyzerSummaryExactAliasIdentityBranch =
  '  return key ? context.aliases.get(key) : context.aliases.get(`name:${expression.getText()}`);';
const weakenedAnalyzerSummaryExactAliasIdentityBranch =
  '  return (key ? context.aliases.get(key) : undefined) ?? context.aliases.get(`name:${expression.getText()}`);';
const analyzerSummaryImmutableBindingBranch = [
  '  return helper && symbolKey && !sourceFileMutatesSymbol(sourceFile, symbolKey)',
  '    ? helper',
  '    : undefined;',
].join('\n');
const weakenedAnalyzerSummaryImmutableBindingBranch = [
  '  return helper && symbolKey',
  '    ? helper',
  '    : undefined;',
].join('\n');
const analyzerSummaryDirectCallableGrammarBranch = [
  '  } else if (!Node.isFunctionDeclaration(declaration)) {',
  '    // SPEC §6.6/§10.3: the positive grammar is deliberately limited to one direct,',
  '    // immutable same-file callable binding. A method/property declaration lives behind a mutable',
  '    // object identity: Object.assign/defineProperty, Reflect.set, aliases, and opaque mutators can',
  "    // replace it without mutating the property's TypeScript symbol. Enumerating those write shapes",
  '    // is not a proof, so object-carried summary targets fail closed unconditionally.',
  '    return undefined;',
  '  }',
].join('\n');
const weakenedAnalyzerSummaryDirectCallableGrammarBranch = [
  '  } else if (Node.isPropertyAssignment(declaration)) {',
  '    declaration = declaration.getInitializer();',
  '  }',
].join('\n');
const analyzerSummaryThisCarrierClosureBranch = [
  '  const root = unwrappedStaticExpressionNode(carrier);',
  '  // SPEC §6.6/§10.3 admits only a structurally enrolled request/context parameter. `this` is the',
  '  // caller-controlled receiver/definition object and cannot mint private principal provenance.',
  '  if (Node.isThisExpression(root)) return false;',
].join('\n');
const weakenedAnalyzerSummaryThisCarrierClosureBranch = [
  '  const root = unwrappedStaticExpressionNode(carrier);',
  '  // SPEC §6.6/§10.3 admits only a structurally enrolled request/context parameter. `this` is the',
  '  // caller-controlled receiver/definition object and cannot mint private principal provenance.',
  '  if (Node.isThisExpression(root)) return true;',
].join('\n');
const analyzerSummaryStaticCallCarrierBranch =
  '  if (!privateScopeHelperCallCarrierIsProven(node)) return undefined;';
const weakenedAnalyzerSummaryStaticCallCarrierBranch =
  '  if (false && !privateScopeHelperCallCarrierIsProven(node)) return undefined;';
const analyzerSummaryDirectCallCalleeBranch = [
  '  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {',
  '    // SPEC §6.6/§10.3: a const receiver is not an immutable property cell. Reflective',
  '    // writes, aliases, opaque mutators, and cross-file writes can replace an object/tuple member',
  '    // without rebinding its root. Positive private provenance therefore admits only direct helper',
  '    // identifiers or direct const aliases below, never a property/container invocation.',
  '    return undefined;',
  '  }',
].join('\n');
const weakenedAnalyzerSummaryDirectCallCalleeBranch = [
  '  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {',
  '    return strictHelperSummaryForStaticReference(node, sessionContext.helpers);',
  '  }',
].join('\n');
const analyzerSummaryOwnerValueContainerClosureBranch = [
  '  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {',
  '    // Direct framework-carrier chains were handled above. Extending a local object/container alias',
  '    // would trust a mutable property cell that reflective or opaque writes can replace.',
  '    return undefined;',
  '  }',
].join('\n');
const weakenedAnalyzerSummaryOwnerValueContainerClosureBranch = [
  '  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {',
  '    return privateScopeForExpression(expression.getExpression(), context, depth + 1);',
  '  }',
].join('\n');
const analyzerSummaryServerValueContainerClosureBranch = [
  '  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {',
  '    // `serverValue` shares the same direct-carrier grammar. A const receiver does not make one of',
  '    // its property cells immutable, so local object/tuple projections remain unknown.',
  '    return undefined;',
  '  }',
].join('\n');
const weakenedAnalyzerSummaryServerValueContainerClosureBranch = [
  '  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {',
  '    return privateScopeSourceForExpression(expression.getExpression(), context, depth + 1);',
  '  }',
].join('\n');
const analyzerSummaryConstValueAliasBranch =
  '  if (!isConstVariableBindingDeclaration(declaration)) return false;';
const weakenedAnalyzerSummaryConstValueAliasBranch =
  '  if (false && !isConstVariableBindingDeclaration(declaration)) return false;';
const analyzerSummaryValueAliasEscapeClosureBranch = [
  '      return !(',
  '        bindingIsImmutableScalar &&',
  '        privateScopeScalarReferenceHasReviewedConsumer(candidate, used.statement)',
  '      );',
].join('\n');
const weakenedAnalyzerSummaryValueAliasEscapeClosureBranch = ['      return false;'].join('\n');
const analyzerSummaryConditionalEffectClosureBranch = [
  'function privateScopeConditionIsEffectFree(condition: Node): boolean {',
  '  for (const node of [condition, ...condition.getDescendants()]) {',
].join('\n');
const weakenedAnalyzerSummaryConditionalEffectClosureBranch = [
  'function privateScopeConditionIsEffectFree(condition: Node): boolean {',
  '  return true;',
  '  for (const node of [condition, ...condition.getDescendants()]) {',
].join('\n');
const serverValueMissingInputClosureBranch = [
  '      if (!inner) {',
  "        return { ok: false, provenance: 'unknown', detail: expression.getText() };",
  '      }',
].join('\n');
const weakenedServerValueMissingInputClosureBranch = [
  '      if (!inner) {',
  "        return { ok: true, provenance: 'unknown' };",
  '      }',
].join('\n');
const serverValuePositiveProofBranch =
  "      return innerVerdict.ok ? { ok: true, provenance: 'unknown' } : innerVerdict;";
const weakenedServerValuePositiveProofBranch =
  "      return innerVerdict.provenance === 'input' ? innerVerdict : { ok: true, provenance: 'unknown' };";
const opaqueSymbolCallClosureBranch =
  '  if (Node.isCallExpression(expression)) return unknownProvenance;';
const weakenedOpaqueSymbolCallClosureBranch =
  '  if (Node.isCallExpression(expression)) return serverProvenance;';
const trustedAssignNestedReviewBranch = [
  '  if (requestCallIsExactTrustedAssignOutput(call)) {',
  '    // SPEC §6.6/§10.3: trustedAssign is an authored, audit-visible escape, not a proof',
  '    // boundary. Review every nested expression before admitting the exact wrapper so an opaque',
  '    // helper or ambient authority cannot be laundered merely by placing it in the first argument.',
  '    scanRequestFunctionArguments(call, context);',
  '    return true;',
  '  }',
].join('\n');
const weakenedTrustedAssignNestedReviewBranch = [
  '  if (requestCallIsExactTrustedAssignOutput(call)) {',
  '    return true;',
  '  }',
].join('\n');

const staticBuildAuthoritativeProjectBranch = [
  'export function collectStaticBuildTrustFactsFromProject(options: TrustEscapeProjectOptions): {',
  '  capabilities: CapabilityExplain[];',
  '  cookieDowngrades: CookieDowngradeExplain[];',
  '  unregisteredSinks: UnregisteredSinkFact[];',
  '} {',
  '  const { sourceFiles, dispose } = createSyntacticProject(options.files);',
].join('\n');
const bypassedStaticBuildAuthoritativeProjectBranch = [
  'export function collectStaticBuildTrustFactsFromProject(options: TrustEscapeProjectOptions): {',
  '  capabilities: CapabilityExplain[];',
  '  cookieDowngrades: CookieDowngradeExplain[];',
  '  unregisteredSinks: UnregisteredSinkFact[];',
  '} {',
  '  if (!options.buildConfigEntryFileName) {',
  '    return { capabilities: [], cookieDowngrades: [], unregisteredSinks: [] };',
  '  }',
  '  const { sourceFiles, dispose } = createSyntacticProject(options.files);',
].join('\n');
const taskBImperativeHandlerOnlyBranch =
  '  // `element.onclick = () => {...}` style property assignments to on* handlers.';
const restoredTaskBJsxNameScannerBranch = [
  '  // JSX attributes whose name starts with `on` (onClick, on:click, onSubmit, ...).',
  '  for (const attribute of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {',
  '    const name = attribute.getNameNode().getText();',
  '    if (!/^on[:A-Z]/.test(name) && !/^on[a-z]/.test(name)) continue;',
  '    const initializer = attribute.getInitializer();',
  '    if (initializer && Node.isJsxExpression(initializer)) add(initializer.getExpression());',
  '  }',
  '',
  taskBImperativeHandlerOnlyBranch,
].join('\n');

const reviewedCommandCapabilityDoorBranch =
  '  if (frameworkExportEquals(frameworkIdentity, RUN_COMMAND_IDENTITY)) {';
const removedReviewedCommandCapabilityDoorBranch =
  '  if (false && frameworkExportEquals(frameworkIdentity, RUN_COMMAND_IDENTITY)) {';
const reviewedModuleStorageFactoryBranch = [
  '  // SPEC §6.6: a module-scope immutable result of the exact reviewed storage factory is a finite',
  '  // storage capability. Request-time factories and mutable/aliased/lookalike callables never reach',
  '  // this module-constant fixed point.',
  "  return 'storage';",
].join('\n');
const removedReviewedModuleStorageFactoryBranch = [
  '  // SPEC §6.6: a module-scope immutable result of the exact reviewed storage factory is a finite',
  '  // storage capability. Request-time factories and mutable/aliased/lookalike callables never reach',
  '  // this module-constant fixed point.',
  "  return 'unknown-authority';",
].join('\n');
const reviewedStorageStatBranch =
  "    if (member === 'get' || member === 'list' || member === 'signUrl' || member === 'stat') {";
const removedReviewedStorageStatBranch =
  "    if (member === 'get' || member === 'list' || member === 'signUrl') {";
const reviewedTrustedSqlRawDoorBranch = '  if (serverCallIsExactTrustedSqlRaw(sourceFile, call)) {';
const removedReviewedTrustedSqlRawDoorBranch =
  '  if (false && serverCallIsExactTrustedSqlRaw(sourceFile, call)) {';
const reviewedDeclaredSecretReadDoorBranch =
  '  if (serverCallIsExactDeclaredSecretReadCapability(sourceFile, call, aliases)) {';
const removedReviewedDeclaredSecretReadDoorBranch =
  '  if (false && serverCallIsExactDeclaredSecretReadCapability(sourceFile, call, aliases)) {';
const reviewedDeclaredSecretReadExecutionBranch =
  '  if (serverCallIsExactDeclaredSecretReadExecution(sourceFile, call, aliases)) {';
const removedReviewedDeclaredSecretReadExecutionBranch =
  '  if (false && serverCallIsExactDeclaredSecretReadExecution(sourceFile, call, aliases)) {';
const reviewedTrustedRevealDoorBranch =
  '  if (serverCallIsExactTrustedReveal(sourceFile, call, aliases)) {';
const removedReviewedTrustedRevealDoorBranch =
  '  if (false && serverCallIsExactTrustedReveal(sourceFile, call, aliases)) {';
const reviewedSecretBoxDoorBranch =
  '  if (serverCallIsExactSecretBox(sourceFile, call, aliases)) {';
const removedReviewedSecretBoxDoorBranch =
  '  if (false && serverCallIsExactSecretBox(sourceFile, call, aliases)) {';
const reviewedDrizzleAliasDoorBranch =
  '  if (serverCallIsExactDrizzleTableAlias(sourceFile, call, aliases)) {';
const removedReviewedDrizzleAliasDoorBranch =
  '  if (false && serverCallIsExactDrizzleTableAlias(sourceFile, call, aliases)) {';
const reviewedInnerJoinContinuationBranch = "  'innerJoin',";
const removedReviewedInnerJoinContinuationBranch = "  // 'innerJoin',";
const reviewedUnionContinuationBranch = "  'union',";
const removedReviewedUnionContinuationBranch = "  // 'union',";

const threatMatrixMissingSinkDenominatorBranch = [
  '  const missing = [...expectedSinks.keys()].filter((sink) => !seen.has(sink));',
  "  if (missing.length > 0) findings.push(`C9 sink mappings missing: ${missing.sort().join(', ')}`);",
].join('\n');
const weakenedThreatMatrixMissingSinkDenominatorBranch = [
  '  const missing = [...expectedSinks.keys()].filter((sink) => !seen.has(sink));',
  "  if (false && missing.length > 0) findings.push(`C9 sink mappings missing: ${missing.sort().join(', ')}`);",
].join('\n');
const threatMatrixMissingAuditedEscapeDenominatorBranch = [
  '  const missing = [...expected].filter((key) => !seen.has(key));',
  '  if (missing.length > 0) {',
  "    findings.push(`audited escape mappings missing: ${missing.sort().join(', ')}`);",
  '  }',
].join('\n');
const weakenedThreatMatrixMissingAuditedEscapeDenominatorBranch = [
  '  const missing = [...expected].filter((key) => !seen.has(key));',
  '  if (false && missing.length > 0) {',
  "    findings.push(`audited escape mappings missing: ${missing.sort().join(', ')}`);",
  '  }',
].join('\n');
const threatMatrixMissingPublicSurfaceDenominatorBranch = [
  '  const missing = [...expected].filter((id) => !seen.has(id));',
  '  if (missing.length > 0) {',
  "    findings.push(`public security surface mappings missing: ${missing.sort().join(', ')}`);",
  '  }',
].join('\n');
const weakenedThreatMatrixMissingPublicSurfaceDenominatorBranch = [
  '  const missing = [...expected].filter((id) => !seen.has(id));',
  '  if (false && missing.length > 0) {',
  "    findings.push(`public security surface mappings missing: ${missing.sort().join(', ')}`);",
  '  }',
].join('\n');

export const SECURITY_GATE_MUTANTS = [
  {
    description:
      'Deletes compiler provenance closure for app-authored static lowered executable references.',
    expectedKiller:
      'app source must not mint executable wire authority without compiler-owned lowering',
    name: 'compiler-finite-ir/drop-authored-executable-reference-provenance',
    replacement: removedAuthoredExecutableReferenceClosureBranch,
    search: authoredExecutableReferenceClosureBranch,
    sourceFile: compilerAuthoringSurfaceValidatorPath,
    sourceOnly: true,
    test: assertAuthoredExecutableReferenceClosureBehavior,
  },
  {
    behavioralTypeScript: true,
    description:
      'Lets state/query values replace compiler-generated handler, renderer, and allowlist markup.',
    expectedKiller:
      'dynamic bindings must remove generated control-plane attributes without stripping compiler wire',
    name: 'runtime-sink/drop-dynamic-binding-control-plane-closure',
    replacement: removedDynamicBindingControlPlaneClosureBranch,
    search: dynamicBindingControlPlaneClosureBranch,
    sourceFile: coreSinkPolicyPath,
    test: assertDynamicBindingControlPlaneClosureBehavior,
  },
  {
    description:
      'Deletes compiler output-context closure for bindings that target generated control markup.',
    expectedKiller:
      'direct, static-spread, and primitive-attrs dynamic control targets must diagnose KV236',
    name: 'compiler-output-context/drop-dynamic-generated-control-target-closure',
    replacement: removedDynamicGeneratedControlTargetClosureBranch,
    search: dynamicGeneratedControlTargetClosureBranch,
    sourceFile: compilerOutputContextValidatorPath,
    sourceOnly: true,
    test: assertDynamicGeneratedControlTargetCompilerBehavior,
  },
  {
    description:
      'Deletes the always-loaded inline runtime floor for state-selected compiler control markup.',
    expectedKiller:
      'readable and freshly minified inline state writes must remove generated control attributes',
    name: 'inline-runtime/drop-dynamic-binding-control-plane-closure',
    replacement: removedInlineDynamicControlPlaneClosureBranch,
    search: inlineDynamicControlPlaneClosureBranch,
    sourceFile: inlineLoaderBuildPath,
    sourceOnly: true,
    test: assertInlineDynamicControlPlaneClosureBehavior,
  },
  {
    description:
      'Deletes compiler closure for request/query-selected executable module/export references.',
    expectedKiller:
      'finite browser IR must reject runtime-selected executable references before emission',
    name: 'compiler-finite-ir/drop-runtime-executable-reference-closure',
    replacement: removedRuntimeSelectedExecutableReferenceClosureBranch,
    search: runtimeSelectedExecutableReferenceClosureBranch,
    sourceFile: compilerFiniteSecurityValidatorPath,
    sourceOnly: true,
    test: assertRuntimeSelectedExecutableReferenceClosureBehavior,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets a compiler semantic verdict authorize different authored source bytes.',
    expectedKiller: 'semantic-v2 proofs must remain bound to the exact authored source carrier',
    name: 'drizzle-semantic-v2/drop-source-byte-equality',
    replacement: weakenedSemanticV2SourceByteEqualityBranch,
    search: semanticV2SourceByteEqualityBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2SourceByteEqualityIsEnforced,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets an unknown semantic graph schema mint request-helper authority.',
    expectedKiller: 'the Drizzle consumer must accept only the exact semantic-v2 schema',
    name: 'drizzle-semantic-v2/allow-unknown-schema',
    replacement: weakenedSemanticV2SchemaBranch,
    search: semanticV2SchemaBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2SchemaIsEnforced,
  },
  {
    behavioralTypeScript: true,
    description: 'Stops reconstructing the claimed root from the authored factory call.',
    expectedKiller: 'semantic-v2 root identity must be reconstructed from authored factory syntax',
    name: 'drizzle-semantic-v2/drop-factory-root-reconstruction',
    replacement: weakenedSemanticV2FactoryRootBranch,
    search: semanticV2FactoryRootBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2FactoryRootIsReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets a root binding claim a different callback byte range.',
    expectedKiller: 'semantic-v2 callback spans must identify the exact authored root callable',
    name: 'drizzle-semantic-v2/drop-callable-span-reconstruction',
    replacement: weakenedSemanticV2CallableSpanBranch,
    search: semanticV2CallableSpanBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2CallableSpanIsReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Falls back to an unrelated helper proof when the callable byte range misses.',
    expectedKiller: 'semantic-v2 helper callable spans must key the exact authored declaration',
    name: 'drizzle-semantic-v2/drop-helper-callable-span-reconstruction',
    replacement: weakenedSemanticV2HelperCallableSpanLookupBranch,
    search: semanticV2HelperCallableSpanLookupBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2HelperCallableSpanIsReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets a root binding point at a different same-name factory call.',
    expectedKiller: 'semantic-v2 factory spans must identify the exact authored root call',
    name: 'drizzle-semantic-v2/drop-factory-call-span-reconstruction',
    replacement: weakenedSemanticV2FactoryCallSpanBranch,
    search: semanticV2FactoryCallSpanBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2FactoryCallSpanIsReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets a helper proof point at a same-shaped call outside the request root.',
    expectedKiller: 'semantic-v2 helper call spans must identify the exact authored invocation',
    name: 'drizzle-semantic-v2/drop-helper-call-span-reconstruction',
    replacement: weakenedSemanticV2HelperCallSpanBranch,
    search: semanticV2HelperCallSpanBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2HelperCallSpanIsReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets compiler-declared argument ranges drift from the authored helper call.',
    expectedKiller: 'semantic-v2 argument spans must exactly cover every authored argument',
    name: 'drizzle-semantic-v2/drop-argument-span-reconstruction',
    replacement: weakenedSemanticV2ArgumentSpanBranch,
    search: semanticV2ArgumentSpanBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2ArgumentSpansAreReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Trusts the compiler-declared authority role without reconstructing call inputs.',
    expectedKiller: 'semantic-v2 authority inputs must be reconstructed from authored arguments',
    name: 'drizzle-semantic-v2/drop-authority-reconstruction',
    replacement: weakenedSemanticV2AuthorityReconstructionBranch,
    search: semanticV2AuthorityReconstructionBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2AuthorityIsReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Trusts a compiler operation inventory that disagrees with the helper body.',
    expectedKiller: 'semantic-v2 DB operations must be reconstructed from the authored helper',
    name: 'drizzle-semantic-v2/drop-operation-inventory-reconstruction',
    replacement: weakenedSemanticV2OperationInventoryBranch,
    search: semanticV2OperationInventoryBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2OperationInventoryIsReconstructed,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets a proved helper survive another closed path in the same semantic root.',
    expectedKiller: 'a closed semantic-v2 root must quarantine every helper proof in that root',
    name: 'drizzle-semantic-v2/drop-closed-root-quarantine',
    replacement: weakenedSemanticV2ClosedRootBranch,
    search: semanticV2ClosedRootBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2ClosedRootIsQuarantined,
  },
  {
    behavioralTypeScript: true,
    description: 'Lets a proved helper survive a closed same-span semantic sibling.',
    expectedKiller: 'a closed semantic-v2 sibling must quarantine the shared callable span',
    name: 'drizzle-semantic-v2/drop-closed-sibling-quarantine',
    replacement: weakenedSemanticV2ClosedSiblingBranch,
    search: semanticV2ClosedSiblingBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertSemanticV2ClosedSiblingIsQuarantined,
  },
  {
    description: 'Trusts an app analyzer declaration without proving the helper body.',
    expectedKiller: 'private analyzer summaries must retain exact same-file structural proof',
    name: 'drizzle-analyzer-summary/drop-structural-body-proof',
    replacement: weakenedAnalyzerSummaryStructuralProofBranch,
    search: analyzerSummaryStructuralProofBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryStructuralProofIsPinned,
  },
  {
    description:
      'Lets a verified private helper receive client input instead of a context carrier.',
    expectedKiller: 'private helper calls must retain exact request/context carrier proof',
    name: 'drizzle-analyzer-summary/drop-call-carrier-proof',
    replacement: weakenedAnalyzerSummaryCallCarrierBranch,
    search: analyzerSummaryCallCarrierBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryCallCarrierIsPinned,
  },
  {
    behavioralTypeScript: true,
    description:
      'Lets extra argument evaluation run before a proved private helper reads its carrier.',
    expectedKiller: 'private helper calls must retain the sole carrier argument grammar',
    name: 'drizzle-analyzer-summary/allow-extra-carrier-argument',
    replacement: weakenedAnalyzerSummarySoleCarrierArgumentBranch,
    search: analyzerSummarySoleCarrierArgumentBranch,
    sourceFile: drizzleSessionProvenancePath,
    test: assertAnalyzerSummarySoleCarrierArgumentIsEnforced,
  },
  {
    description: 'Lets derived helper aliases become provenance for another alias hop.',
    expectedKiller: 'private helper aliases must derive only from the direct proved snapshot',
    name: 'drizzle-analyzer-summary/allow-transitive-helper-alias',
    replacement: weakenedAnalyzerSummaryDirectAliasSnapshotBranch,
    search: analyzerSummaryDirectAliasSnapshotBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryDirectAliasSnapshotIsPinned,
  },
  {
    behavioralInstrumentation: [
      '',
      'export { summarizedStaticCallablePrivateScope as __summarizedStaticCallablePrivateScope };',
      "export { sessionProvenanceContextForNodes } from './session-provenance.js';",
      '',
    ].join('\n'),
    behavioralTypeScript: true,
    description: 'Restores recursive const-alias expansion in the OPP private-scope consumer.',
    expectedKiller: 'OPP private helper aliases must stop after one direct alias',
    name: 'drizzle-analyzer-summary/allow-opp-alias-chain',
    replacement: weakenedAnalyzerSummaryOppAliasChainClosureBranch,
    search: analyzerSummaryOppAliasChainClosureBranch,
    sourceFile: drizzleSummariesPath,
    test: assertAnalyzerSummaryOppAliasChainClosureIsEnforced,
  },
  {
    description: 'Lets an unenrolled positional parameter pass as private context.',
    expectedKiller: 'private helper calls must reject positional/name/type carrier guesses',
    name: 'drizzle-analyzer-summary/trust-renamed-input-carrier',
    replacement: weakenedAnalyzerSummaryUnenrolledCarrierClosureBranch,
    search: analyzerSummaryUnenrolledCarrierClosureBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryUnenrolledCarrierClosureIsPinned,
  },
  {
    behavioralTypeScript: true,
    description: 'Skips the whole-callback integrity proof for an enrolled private carrier.',
    expectedKiller: 'private carriers must retain the exact binding-integrity proof',
    name: 'drizzle-analyzer-summary/drop-carrier-integrity-proof',
    replacement: weakenedAnalyzerSummaryCarrierIntegrityBranch,
    search: analyzerSummaryCarrierIntegrityBranch,
    sourceFile: drizzleSessionProvenancePath,
    test: assertAnalyzerSummaryCarrierIntegrityIsEnforced,
  },
  {
    description: 'Lets direct guard/session/tenant reads bypass carrier integrity.',
    expectedKiller: 'direct private reads must use the same carrier-integrity proof',
    name: 'drizzle-analyzer-summary/drop-direct-carrier-integrity-proof',
    replacement: weakenedAnalyzerSummaryDirectCarrierIntegrityBranch,
    search: analyzerSummaryDirectCarrierIntegrityBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryDirectCarrierIntegrityIsPinned,
  },
  {
    description: 'Lets a request-like validated-input name mint provenance through destructuring.',
    expectedKiller: 'destructured private aliases must retain exact carrier-role proof',
    name: 'drizzle-analyzer-summary/trust-destructured-input-carrier',
    replacement: weakenedAnalyzerSummaryDestructuredCarrierProofBranch,
    search: analyzerSummaryDestructuredCarrierProofBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryDestructuredCarrierProofIsPinned,
  },
  {
    description: 'Lets a non-null session local recover private provenance from named input.',
    expectedKiller: 'session-local recovery must retain exact carrier-role proof',
    name: 'drizzle-analyzer-summary/trust-input-session-local',
    replacement: weakenedAnalyzerSummarySessionAliasCarrierProofBranch,
    search: analyzerSummarySessionAliasCarrierProofBranch,
    sourceFile: drizzleSummariesPath,
    sourceOnly: true,
    test: assertAnalyzerSummarySessionAliasCarrierProofIsPinned,
  },
  {
    description: 'Lets accepted-guard dominance trust a guard path rooted in named input.',
    expectedKiller: 'accepted guard paths must retain exact carrier-role proof',
    name: 'drizzle-analyzer-summary/trust-input-accepted-guard',
    replacement: weakenedAnalyzerSummaryAcceptedGuardCarrierProofBranch,
    search: analyzerSummaryAcceptedGuardCarrierProofBranch,
    sourceFile: drizzleSummariesPath,
    sourceOnly: true,
    test: assertAnalyzerSummaryAcceptedGuardCarrierProofIsPinned,
  },
  {
    description: 'Lets a framework carrier escape through an opaque call before private use.',
    expectedKiller: 'private carriers must close after opaque call escape',
    name: 'drizzle-analyzer-summary/allow-opaque-carrier-escape',
    replacement: weakenedAnalyzerSummaryOpaqueCarrierEscapeBranch,
    search: analyzerSummaryOpaqueCarrierEscapeBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryOpaqueCarrierEscapeIsPinned,
  },
  {
    description: 'Lets an arbitrary wrapper prefix before guard/session/tenant mint private scope.',
    expectedKiller: 'private summary paths must allow only direct or exact request prefixes',
    name: 'drizzle-analyzer-summary/allow-arbitrary-private-path-prefix',
    replacement: weakenedAnalyzerSummaryPrivatePathPrefixBranch,
    search: analyzerSummaryPrivatePathPrefixBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryPrivatePathPrefixIsPinned,
  },
  {
    description: 'Lets a carrier-owned input.guard subtree mint direct private provenance.',
    expectedKiller: 'direct private paths must allow only direct or exact request prefixes',
    name: 'drizzle-analyzer-summary/allow-direct-carrier-input-prefix',
    replacement: weakenedAnalyzerSummaryDirectPrivatePathPrefixBranch,
    search: analyzerSummaryDirectPrivatePathPrefixBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryDirectPrivatePathPrefixIsPinned,
  },
  {
    description: 'Lets client-controlled destructuring defaults preserve private provenance.',
    expectedKiller: 'defaulted private destructuring must remain closed',
    name: 'drizzle-analyzer-summary/allow-private-destructuring-default',
    replacement: weakenedAnalyzerSummaryDestructuringDefaultClosureBranch,
    search: analyzerSummaryDestructuringDefaultClosureBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryDestructuringDefaultClosureIsPinned,
  },
  {
    description: 'Lets mutable object captures pass the immutable scalar transfer rule.',
    expectedKiller: 'private carrier transfer must remain limited to immutable scalar values',
    name: 'drizzle-analyzer-summary/allow-mutable-private-scalar-transfer',
    replacement: weakenedAnalyzerSummaryMutableScalarTransferClosureBranch,
    search: analyzerSummaryMutableScalarTransferClosureBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryMutableScalarTransferClosureIsPinned,
  },
  {
    description: 'Treats a bare expression call as a control-flow exit for guard dominance.',
    expectedKiller: 'private guard dominance must require an explicit return or throw',
    name: 'drizzle-analyzer-summary/allow-nonexiting-outcome-call',
    replacement: weakenedAnalyzerSummaryFiniteExitGrammarBranch,
    search: analyzerSummaryFiniteExitGrammarBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryFiniteExitGrammarIsPinned,
  },
  {
    description: 'Lets a resolved lexical shadow inherit a same-text private alias.',
    expectedKiller: 'private alias consumers must bind exact lexical symbols',
    name: 'drizzle-analyzer-summary/allow-same-text-private-alias-shadow',
    replacement: weakenedAnalyzerSummaryExactAliasIdentityBranch,
    search: analyzerSummaryExactAliasIdentityBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryExactAliasIdentityIsPinned,
  },
  {
    description: 'Keeps a summary trusted after its callable binding is reassigned.',
    expectedKiller: 'private summary helpers must retain immutable callable identity',
    name: 'drizzle-analyzer-summary/allow-mutated-helper-binding',
    replacement: weakenedAnalyzerSummaryImmutableBindingBranch,
    search: analyzerSummaryImmutableBindingBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryImmutableBindingIsPinned,
  },
  {
    description: 'Restores mutable object properties as positive analyzer-summary callables.',
    expectedKiller: 'private summary targets must remain direct same-file callable bindings',
    name: 'drizzle-analyzer-summary/allow-object-property-callable',
    replacement: weakenedAnalyzerSummaryDirectCallableGrammarBranch,
    search: analyzerSummaryDirectCallableGrammarBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryDirectCallableGrammarIsPinned,
  },
  {
    description: 'Lets a caller-controlled `this` receiver mint private context provenance.',
    expectedKiller: 'private helper calls must reject `this` as a request/context carrier',
    name: 'drizzle-analyzer-summary/trust-this-carrier',
    replacement: weakenedAnalyzerSummaryThisCarrierClosureBranch,
    search: analyzerSummaryThisCarrierClosureBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryThisCarrierClosureIsPinned,
  },
  {
    description: 'Drops the call-carrier proof from the static summary consumer.',
    expectedKiller: 'every static summary consumer must retain the same call-carrier proof',
    name: 'drizzle-analyzer-summary/drop-static-call-carrier-proof',
    replacement: weakenedAnalyzerSummaryStaticCallCarrierBranch,
    search: analyzerSummaryStaticCallCarrierBranch,
    sourceFile: drizzleSummariesPath,
    sourceOnly: true,
    test: assertAnalyzerSummaryStaticCallCarrierIsPinned,
  },
  {
    description: 'Restores mutable property/container invocations as positive private summaries.',
    expectedKiller: 'private summary calls must use a direct helper or direct const alias',
    name: 'drizzle-analyzer-summary/allow-property-callable-invocation',
    replacement: weakenedAnalyzerSummaryDirectCallCalleeBranch,
    search: analyzerSummaryDirectCallCalleeBranch,
    sourceFile: drizzleSummariesPath,
    sourceOnly: true,
    test: assertAnalyzerSummaryDirectCallCalleeIsPinned,
  },
  {
    description: 'Lets a mutable local value-container cell preserve owner provenance.',
    expectedKiller: 'owner predicates must reject private provenance through local containers',
    name: 'drizzle-analyzer-summary/allow-owner-value-container',
    replacement: weakenedAnalyzerSummaryOwnerValueContainerClosureBranch,
    search: analyzerSummaryOwnerValueContainerClosureBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryOwnerValueContainerClosureIsPinned,
  },
  {
    description: 'Lets serverValue trust a private value routed through a mutable container cell.',
    expectedKiller: 'serverValue must reject private provenance through local containers',
    name: 'drizzle-analyzer-summary/allow-server-value-container',
    replacement: weakenedAnalyzerSummaryServerValueContainerClosureBranch,
    search: analyzerSummaryServerValueContainerClosureBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryServerValueContainerClosureIsPinned,
  },
  {
    description: 'Lets a reassignable local value binding preserve private provenance.',
    expectedKiller: 'private value aliases must retain immutable bindings',
    name: 'drizzle-analyzer-summary/allow-mutable-value-alias',
    replacement: weakenedAnalyzerSummaryConstValueAliasBranch,
    search: analyzerSummaryConstValueAliasBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryConstValueAliasIsPinned,
  },
  {
    description: 'Lets an escaped or reflectively mutated local value preserve provenance.',
    expectedKiller: 'private value aliases must close after any intervening use',
    name: 'drizzle-analyzer-summary/allow-value-alias-escape',
    replacement: weakenedAnalyzerSummaryValueAliasEscapeClosureBranch,
    search: analyzerSummaryValueAliasEscapeClosureBranch,
    sourceFile: drizzleSessionProvenancePath,
    sourceOnly: true,
    test: assertAnalyzerSummaryValueAliasEscapeClosureIsPinned,
  },
  {
    description: 'Lets side effects in a conditional rewrite private authority before capture.',
    expectedKiller: 'private-value conditional conditions must remain effect-free',
    name: 'drizzle-analyzer-summary/allow-conditional-authority-mutation',
    replacement: weakenedAnalyzerSummaryConditionalEffectClosureBranch,
    search: analyzerSummaryConditionalEffectClosureBranch,
    sourceFile: drizzleSummariesPath,
    sourceOnly: true,
    test: assertAnalyzerSummaryConditionalEffectClosureIsPinned,
  },
  {
    description: 'Lets serverValue treat a missing value as proven non-input.',
    expectedKiller: 'serverValue must reject a missing provenance input',
    name: 'drizzle-server-value/allow-missing-value',
    replacement: weakenedServerValueMissingInputClosureBranch,
    search: serverValueMissingInputClosureBranch,
    sourceFile: drizzleDerivationPath,
    sourceOnly: true,
    test: assertServerValueMissingInputClosureIsPinned,
  },
  {
    description: 'Lets serverValue treat opaque unknown provenance as non-input.',
    expectedKiller: 'serverValue must require a positive non-input proof',
    name: 'drizzle-server-value/allow-opaque-value',
    replacement: weakenedServerValuePositiveProofBranch,
    search: serverValuePositiveProofBranch,
    sourceFile: drizzleDerivationPath,
    sourceOnly: true,
    test: assertServerValuePositiveProofIsPinned,
  },
  {
    description: 'Treats every opaque helper call as server provenance.',
    expectedKiller: 'opaque symbol-provenance calls must remain unknown',
    name: 'drizzle-symbol-provenance/trust-opaque-calls',
    replacement: weakenedOpaqueSymbolCallClosureBranch,
    search: opaqueSymbolCallClosureBranch,
    sourceFile: drizzleSymbolProvenancePath,
    sourceOnly: true,
    test: assertOpaqueSymbolCallClosureIsPinned,
  },
  {
    description: 'Lets trustedAssign hide an opaque helper or ambient-authority expression.',
    expectedKiller: 'trustedAssign must retain recursive review of every nested expression',
    name: 'drizzle-trusted-assign/drop-nested-expression-review',
    replacement: weakenedTrustedAssignNestedReviewBranch,
    search: trustedAssignNestedReviewBranch,
    sourceFile: drizzleTrustEscapesPath,
    sourceOnly: true,
    test: assertTrustedAssignNestedReviewIsPinned,
  },
  {
    description: 'Deletes WebRTC peer construction from raw browser network authority.',
    expectedKiller: 'capability closure must retain RTCPeerConnection as raw network authority',
    name: 'compiler-capability-closure/drop-webrtc-network-global',
    replacement: weakenedBrowserRtcNetworkCapabilityBranch,
    search: browserRtcNetworkCapabilityBranch,
    sourceFile: compilerCapabilityClosureScannerPath,
    sourceOnly: true,
    test: assertBrowserRtcNetworkCapabilityIsPinned,
  },
  {
    behavioralTypeScript: true,
    description: 'Restores an early empty-result bypass before authoritative TASK B analysis.',
    expectedKiller: 'static build trust facts must always construct and run the authoritative pass',
    name: 'drizzle-task-b/restore-static-build-analysis-bypass',
    replacement: bypassedStaticBuildAuthoritativeProjectBranch,
    search: staticBuildAuthoritativeProjectBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertStaticBuildAuthoritativeProjectIsExecuted,
  },
  {
    behavioralTypeScript: true,
    description: 'Restores the superseded per-name JSX handler sink traversal.',
    expectedKiller: 'compiler-owned JSX handlers must stay exclusively on finite IR',
    name: 'drizzle-task-b/restore-jsx-name-scanner',
    replacement: restoredTaskBJsxNameScannerBranch,
    search: taskBImperativeHandlerOnlyBranch,
    sourceFile: drizzleTrustEscapesPath,
    test: assertTaskBJsxNameScannerRetirementIsEnforced,
  },
  {
    description: 'Deletes the exact reviewed runCommand capability-door admission.',
    expectedKiller: 'finite IR must retain the exact runtime-validated command capability door',
    name: 'compiler-finite-ir/drop-reviewed-command-door',
    replacement: removedReviewedCommandCapabilityDoorBranch,
    search: reviewedCommandCapabilityDoorBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedCommandCapabilityDoorIsPinned,
  },
  {
    description:
      'Stops exact immutable module-scope storage factories from minting storage provenance.',
    expectedKiller: 'finite IR must retain exact module-scope storage factory provenance',
    name: 'compiler-finite-ir/drop-module-storage-factory-provenance',
    replacement: removedReviewedModuleStorageFactoryBranch,
    search: reviewedModuleStorageFactoryBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedModuleStorageFactoryIsPinned,
  },
  {
    description: 'Deletes storage.stat from the finite storage-read vocabulary.',
    expectedKiller: 'finite IR must retain storage.stat as a reviewed storage read',
    name: 'compiler-finite-ir/drop-storage-stat-read',
    replacement: removedReviewedStorageStatBranch,
    search: reviewedStorageStatBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedStorageStatIsPinned,
  },
  {
    description: 'Deletes exact static sql.raw composition from the trustedSql reviewed door.',
    expectedKiller: 'finite IR must retain exact trustedSql(sql.raw(static literal)) admission',
    name: 'compiler-finite-ir/drop-trusted-sql-raw-door',
    replacement: removedReviewedTrustedSqlRawDoorBranch,
    search: reviewedTrustedSqlRawDoorBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedTrustedSqlRawDoorIsPinned,
  },
  {
    description: 'Deletes the exact public declared secret-read capability door.',
    expectedKiller: 'finite IR must retain exact declared secret-read capability admission',
    name: 'compiler-finite-ir/drop-declared-secret-read-door',
    replacement: removedReviewedDeclaredSecretReadDoorBranch,
    search: reviewedDeclaredSecretReadDoorBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedDeclaredSecretReadDoorIsPinned,
  },
  {
    description: 'Deletes the exact declaration-before-one-execution secret-read door.',
    expectedKiller: 'finite IR must retain exact declared secret-read execution admission',
    name: 'compiler-finite-ir/drop-declared-secret-read-execution-door',
    replacement: removedReviewedDeclaredSecretReadExecutionBranch,
    search: reviewedDeclaredSecretReadExecutionBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedDeclaredSecretReadExecutionIsPinned,
  },
  {
    description: 'Deletes the exact audited trustedReveal data door.',
    expectedKiller: 'finite IR must retain exact trustedReveal admission',
    name: 'compiler-finite-ir/drop-trusted-reveal-door',
    replacement: removedReviewedTrustedRevealDoorBranch,
    search: reviewedTrustedRevealDoorBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedTrustedRevealDoorIsPinned,
  },
  {
    description: 'Deletes the exact framework secret boxing data door.',
    expectedKiller: 'finite IR must retain exact secret(value) admission',
    name: 'compiler-finite-ir/drop-secret-box-door',
    replacement: removedReviewedSecretBoxDoorBranch,
    search: reviewedSecretBoxDoorBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedSecretBoxDoorIsPinned,
  },
  {
    description: 'Deletes exact Drizzle table alias construction from reviewed data.',
    expectedKiller: 'finite IR must retain exact alias(table, static name) admission',
    name: 'compiler-finite-ir/drop-drizzle-table-alias-door',
    replacement: removedReviewedDrizzleAliasDoorBranch,
    search: reviewedDrizzleAliasDoorBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedDrizzleAliasDoorIsPinned,
  },
  {
    description: 'Deletes innerJoin from the finite managed-read continuation vocabulary.',
    expectedKiller: 'finite IR must retain inline managed innerJoin continuation admission',
    name: 'compiler-finite-ir/drop-inner-join-continuation',
    replacement: removedReviewedInnerJoinContinuationBranch,
    search: reviewedInnerJoinContinuationBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedInnerJoinContinuationIsPinned,
  },
  {
    description: 'Deletes union from the finite managed-read continuation vocabulary.',
    expectedKiller: 'finite IR must retain inline managed union continuation admission',
    name: 'compiler-finite-ir/drop-union-continuation',
    replacement: removedReviewedUnionContinuationBranch,
    search: reviewedUnionContinuationBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertReviewedUnionContinuationIsPinned,
  },
  {
    description: 'Deletes normalized helper-cycle absorption.',
    expectedKiller: 'recursive helper summaries must retain the helper-cycle closed verdict',
    name: 'compiler-semantic-graph/drop-helper-cycle-closure',
    replacement: removedSemanticCycleClosureBranch,
    search: semanticCycleClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticCycleClosureIsPinned,
  },
  {
    description: 'Deletes the normalized helper call-depth ceiling.',
    expectedKiller: 'helper summary paths must retain deterministic call-depth closure',
    name: 'compiler-semantic-graph/drop-call-depth-closure',
    replacement: removedSemanticDepthClosureBranch,
    search: semanticDepthClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticDepthClosureIsPinned,
  },
  {
    description: 'Deletes the normalized interpreted-node ceiling.',
    expectedKiller: 'semantic roots must retain deterministic AST-node budget closure',
    name: 'compiler-semantic-graph/drop-node-budget-closure',
    replacement: removedSemanticNodeBudgetClosureBranch,
    search: semanticNodeBudgetClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticNodeBudgetClosureIsPinned,
  },
  {
    description: 'Deletes the normalized finite-operation ceiling.',
    expectedKiller: 'semantic roots must retain deterministic operation budget closure',
    name: 'compiler-semantic-graph/drop-operation-budget-closure',
    replacement: removedSemanticOperationBudgetClosureBranch,
    search: semanticOperationBudgetClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticOperationBudgetClosureIsPinned,
  },
  {
    description: 'Deletes the normalized helper-summary ceiling.',
    expectedKiller: 'semantic roots must retain deterministic summary budget closure',
    name: 'compiler-semantic-graph/drop-summary-budget-closure',
    replacement: removedSemanticSummaryBudgetClosureBranch,
    search: semanticSummaryBudgetClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticSummaryBudgetClosureIsPinned,
  },
  {
    description: 'Forgets the query/task/mutation root posture when entering a helper summary.',
    expectedKiller: 'helper summaries must preserve the originating security surface',
    name: 'compiler-semantic-graph/drop-root-surface-propagation',
    replacement: weakenedSemanticSurfacePropagationBranch,
    search: semanticSurfacePropagationBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticSurfacePropagationIsPinned,
  },
  {
    description: 'Treats members of an exact operation function as the same reviewed sink.',
    expectedKiller: 'operation-function call/apply/bind laundering must remain opaque',
    name: 'compiler-semantic-graph/allow-operation-member-laundering',
    replacement: weakenedSemanticOperationMemberClosureBranch,
    search: semanticOperationMemberClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticOperationMemberClosureIsPinned,
  },
  {
    description: 'Deletes capability-member mutation closure from normalized semantics.',
    expectedKiller: 'authority-bearing members must remain immutable in the semantic lattice',
    name: 'compiler-semantic-graph/drop-member-mutation-closure',
    replacement: removedSemanticMemberMutationClosureBranch,
    search: semanticMemberMutationClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticMemberMutationClosureIsPinned,
  },
  {
    description: 'Allows authority recovery through a helper arguments object.',
    expectedKiller: 'arguments-object recovery must remain outside finite helper summaries',
    name: 'compiler-semantic-graph/allow-arguments-authority-recovery',
    replacement: removedSemanticArgumentsClosureBranch,
    search: semanticArgumentsClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticArgumentsClosureIsPinned,
  },
  {
    description: 'Allows authority capture by an unsummarized nested callable.',
    expectedKiller: 'nested callable captures must remain absorbing semantic closure',
    name: 'compiler-semantic-graph/allow-nested-authority-capture',
    replacement: removedSemanticNestedCaptureClosureBranch,
    search: semanticNestedCaptureClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticNestedCaptureClosureIsPinned,
  },
  {
    description: 'Allows authority to move through an opaque container or join.',
    expectedKiller: 'opaque authority containers must remain closed',
    name: 'compiler-semantic-graph/allow-opaque-authority-container',
    replacement: removedSemanticOpaqueContainerClosureBranch,
    search: semanticOpaqueContainerClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticOpaqueContainerClosureIsPinned,
  },
  {
    description: 'Allows authority to enter a helper rest-parameter mapping.',
    expectedKiller: 'authority-bearing rest arguments must remain outside finite summaries',
    name: 'compiler-semantic-graph/allow-rest-authority-mapping',
    replacement: removedSemanticRestArgumentClosureBranch,
    search: semanticRestArgumentClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticRestArgumentClosureIsPinned,
  },
  {
    description: 'Treats arbitrary raw-driver-shaped DB namespaces as managed operations.',
    expectedKiller: 'generic DB table namespaces must stay limited to finite read terminals',
    name: 'compiler-semantic-graph/allow-raw-database-namespace-chain',
    replacement: weakenedSemanticTableNamespaceClosureBranch,
    search: semanticTableNamespaceClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertSemanticTableNamespaceClosureIsPinned,
  },
  {
    description:
      'Lets a same-spelled local or foreign trustedAssign bypass exact @kovojs/server identity.',
    expectedKiller: 'trustedAssign admission must retain exact framework export identity',
    name: 'compiler-finite-ir/allow-spelled-trusted-assign',
    replacement: weakenedExactTrustedAssignIdentityBranch,
    search: exactTrustedAssignIdentityBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertExactTrustedAssignIdentityIsPinned,
  },
  {
    description: 'Lets a replaced ambient Error constructor pass as the reviewed intrinsic.',
    expectedKiller: 'ambient Error admission must retain callable stability proof',
    name: 'compiler-finite-ir/drop-ambient-error-stability',
    replacement: weakenedAmbientErrorStabilityBranch,
    search: ambientErrorStabilityBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertAmbientErrorStabilityIsPinned,
  },
  {
    description: 'Lets a replaced ambient crypto.randomUUID member pass as reviewed data.',
    expectedKiller: 'ambient crypto.randomUUID admission must retain member stability proof',
    name: 'compiler-finite-ir/drop-random-uuid-stability',
    replacement: weakenedAmbientCryptoRandomUuidStabilityBranch,
    search: ambientCryptoRandomUuidStabilityBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertAmbientCryptoRandomUuidStabilityIsPinned,
  },
  {
    description: 'Admits any inline managed-DB continuation instead of the finite method set.',
    expectedKiller: 'managed-DB continuations must retain the exact finite method vocabulary',
    name: 'compiler-finite-ir/allow-unknown-managed-db-continuation',
    replacement: weakenedFiniteManagedDatabaseContinuationBranch,
    search: finiteManagedDatabaseContinuationBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertFiniteManagedDatabaseContinuationIsPinned,
  },
  {
    description: 'Lets an imported executable value enter a reviewed managed-DB continuation.',
    expectedKiller: 'managed-DB continuations must reject unreviewed foreign executable arguments',
    name: 'compiler-finite-ir/allow-foreign-managed-db-argument',
    replacement: weakenedManagedDatabaseForeignArgumentClosureBranch,
    search: managedDatabaseForeignArgumentClosureBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertManagedDatabaseForeignArgumentClosureIsPinned,
  },
  {
    description: 'Treats any imported project factory call as a reviewed Drizzle schema table.',
    expectedKiller: 'project schema admission must retain exact pgTable/sqliteTable identity',
    name: 'compiler-finite-ir/allow-foreign-project-schema-factory',
    replacement: weakenedExactProjectSchemaFactoryIdentityBranch,
    search: exactProjectSchemaFactoryIdentityBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertExactProjectSchemaFactoryIdentityIsPinned,
  },
  {
    description: 'Keeps a project schema value reviewed after its exported binding is reassigned.',
    expectedKiller: 'project schema admission must retain immutable exported binding proof',
    name: 'compiler-finite-ir/allow-reassigned-project-schema',
    replacement: weakenedImmutableProjectSchemaBindingBranch,
    search: immutableProjectSchemaBindingBranch,
    sourceFile: compilerSecuritySemanticGraphPath,
    sourceOnly: true,
    test: assertImmutableProjectSchemaBindingIsPinned,
  },
  {
    description:
      'Drops project identity files while reparsing emitted source for render equivalence.',
    expectedKiller: 'render equivalence must preserve exact project schema identity files',
    name: 'compiler-render-equivalence/drop-project-identity-files',
    replacement: weakenedRenderEquivalenceProjectIdentityBranch,
    search: renderEquivalenceProjectIdentityBranch,
    sourceFile: compilerCompilePath,
    sourceOnly: true,
    test: assertRenderEquivalenceProjectIdentityIsPinned,
  },
  {
    description: 'Allows computed or optional framework-context fetch invocation shapes.',
    expectedKiller: 'framework egress calls must retain exact direct context.fetch provenance',
    name: 'drizzle-egress/allow-inexact-context-fetch-call',
    replacement: weakenedExactContextFetchInvocationBranch,
    search: exactContextFetchInvocationBranch,
    sourceFile: drizzleTrustEscapesPath,
    sourceOnly: true,
    test: assertExactContextFetchInvocationIsPinned,
  },
  {
    description: 'Weakens the session-owner builder cell to allow cross-owner reads.',
    expectedKiller: 'authorization matrix owner-read canary must retain allow-own-only',
    name: 'authorization-matrix/allow-cross-owner-builder-read',
    replacement: weakenedOwnerReadCanary,
    search: ownerReadCanary,
    sourceFile: authorizationMatrixPath,
    sourceOnly: true,
    test: assertAuthorizationMatrixDocumentIsClosed,
  },
  {
    description: 'Weakens the raw-SQL mutation cell to allow a cross-owner insert.',
    expectedKiller: 'authorization matrix raw-write canary must retain engine denial',
    name: 'authorization-matrix/allow-cross-owner-raw-write',
    replacement: weakenedRawWriteCanary,
    search: rawWriteCanary,
    sourceFile: authorizationMatrixPath,
    sourceOnly: true,
    test: assertAuthorizationMatrixDocumentIsClosed,
  },
  {
    description: 'Lets the ordinary runtime assume the provision role.',
    expectedKiller: 'authorization matrix must deny provision-role assumption',
    name: 'authorization-matrix/allow-provision-role-assumption',
    replacement: weakenedProvisionRoleCanary,
    search: provisionRoleCanary,
    sourceFile: authorizationMatrixPath,
    sourceOnly: true,
    test: assertAuthorizationMatrixDocumentIsClosed,
  },
  {
    description: 'Allows a reader-reachable cross-schema SECURITY DEFINER function.',
    expectedKiller: 'authorization matrix closure audit must refuse the definer function',
    name: 'authorization-matrix/allow-cross-schema-definer-function',
    replacement: weakenedDefinerFunctionCanary,
    search: definerFunctionCanary,
    sourceFile: authorizationMatrixPath,
    sourceOnly: true,
    test: assertAuthorizationMatrixDocumentIsClosed,
  },
  {
    description: 'Turns the durable-task act-as owner path into a surviving denial.',
    expectedKiller: 'authorization matrix durable-task canary must retain its owner-only success',
    name: 'authorization-matrix/deny-durable-task-owner-read',
    replacement: weakenedDurableTaskCanary,
    search: durableTaskCanary,
    sourceFile: authorizationMatrixPath,
    sourceOnly: true,
    test: assertAuthorizationMatrixDocumentIsClosed,
  },
  {
    baseModule: threatMatrixGate,
    description: 'Deletes the denominator check for an authoritative C9 sink with no live mapping.',
    expectedKiller: 'threat-matrix liveness must reject every unmapped authoritative C9 sink',
    name: 'threat-matrix-gate/drop-missing-sink-denominator',
    replacement: weakenedThreatMatrixMissingSinkDenominatorBranch,
    search: threatMatrixMissingSinkDenominatorBranch,
    sourceFile: threatMatrixGatePath,
    test: assertThreatMatrixMissingSinkDenominatorIsPinned,
  },
  {
    baseModule: threatMatrixGate,
    description: 'Deletes the denominator check for a newly registered audited escape kind.',
    expectedKiller: 'threat-matrix liveness must reject every unmapped audited escape kind',
    name: 'threat-matrix-gate/drop-missing-audited-escape-denominator',
    replacement: weakenedThreatMatrixMissingAuditedEscapeDenominatorBranch,
    search: threatMatrixMissingAuditedEscapeDenominatorBranch,
    sourceFile: threatMatrixGatePath,
    test: assertThreatMatrixMissingAuditedEscapeDenominatorIsPinned,
  },
  {
    baseModule: threatMatrixGate,
    description: 'Deletes the denominator check for a new public security capability surface.',
    expectedKiller: 'threat-matrix liveness must reject every unmapped public security surface',
    name: 'threat-matrix-gate/drop-missing-public-surface-denominator',
    replacement: weakenedThreatMatrixMissingPublicSurfaceDenominatorBranch,
    search: threatMatrixMissingPublicSurfaceDenominatorBranch,
    sourceFile: threatMatrixGatePath,
    test: assertThreatMatrixMissingPublicSurfaceDenominatorIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the branch that turns an enrolled fixture-only security seed without a real build proof into a violation.',
    expectedKiller:
      'fixture-only security seed without production build proof must report the missing proof',
    name: 'security-test-build-gate/drop-missing-real-build-proof',
    replacement: removedMissingRealBuildProofBranch,
    search: missingRealBuildProofBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertMissingRealBuildProofIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the branch that reads explicit non-metamorphic security proof-scope enrollment markers.',
    expectedKiller:
      'enrolled unit or fixture security proof-scope enrollment markers must require real build proof',
    name: 'security-test-build-gate/drop-security-certification-marker-extractor',
    replacement: removedSecurityCertificationMarkerExtractorBranch,
    search: securityCertificationMarkerExtractorBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertSecurityCertificationMarkerIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the branch that rejects stale proof rows.',
    expectedKiller: 'stale security proof rows must not enroll a removed or renamed source claim',
    name: 'security-test-build-gate/drop-stale-proof-row-rejection',
    replacement: removedStaleProofRowBranch,
    search: staleProofRowBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertStaleProofRowIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the branch that rejects skipped or todo real-build proof tests.',
    expectedKiller: 'skipped security proof tests must not claim M2 build fidelity',
    name: 'security-test-build-gate/drop-skipped-proof-rejection',
    replacement: removedSkippedProofBranch,
    search: skippedProofBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertSkippedProofIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the branch that requires proof-specific diagnostic or artifact evidence.',
    expectedKiller: 'KV435 and KV311 proof rows must assert their enrolled evidence',
    name: 'security-test-build-gate/drop-required-proof-evidence',
    replacement: removedRequiredProofEvidenceBranch,
    search: requiredProofEvidenceBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertRequiredProofEvidenceIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the branch that requires proof-file-wide evidence outside the named test block.',
    expectedKiller:
      'B3 resolver .js-to-TS sibling fallback proof must pin the explicit .js import source',
    name: 'security-test-build-gate/drop-required-proof-file-evidence',
    replacement: removedRequiredProofFileEvidenceBranch,
    search: requiredProofFileEvidenceBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertRequiredProofFileEvidenceIsCaught,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Weakens the KV426 star-barrel proof enrollment so it no longer pins the .js import to a TS sibling.',
    expectedKiller:
      'KV426 star-barrel proof enrollment must retain the explicit ./safe-html.js import needle',
    name: 'security-test-build-gate/weaken-js-to-ts-sibling-proof-enrollment',
    replacement: weakenedJsToTsSiblingProofNeedle,
    search: jsToTsSiblingProofNeedle,
    sourceFile: securityTestBuildGatePath,
    test: assertJsToTsSiblingProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Weakens the KV311 island-derive proof enrollment so it no longer pins sink-census and console-error evidence.',
    expectedKiller:
      'KV311 island-derive production proof enrollment must retain artifact census plus no-console-error evidence',
    name: 'security-test-build-gate/weaken-kv311-island-derive-proof-enrollment',
    replacement: weakenedKv311IslandDeriveProofEnrollmentBranch,
    search: kv311IslandDeriveProofEnrollmentBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertKv311IslandDeriveProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Weakens the KV435 value-flow proof enrollment so the safe sibling no longer proves server-only secret reads stay green.',
    expectedKiller:
      'KV435 value-flow proof enrollment must retain the explicit safe sibling build needle',
    name: 'security-test-build-gate/weaken-kv435-safe-sibling-proof-enrollment',
    replacement: weakenedKv435SafeSiblingProofNeedle,
    search: kv435SafeSiblingProofNeedle,
    sourceFile: securityTestBuildGatePath,
    test: assertKv435SafeSiblingProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Weakens the KV426 trusted-output proof enrollment so the safe sibling no longer proves audited trusted output stays green.',
    expectedKiller:
      'KV426 trusted-output proof enrollment must retain the explicit safe sibling build needle',
    name: 'security-test-build-gate/weaken-kv426-trusted-output-safe-sibling-proof-enrollment',
    replacement: weakenedKv426TrustedOutputSafeSiblingProofNeedle,
    search: kv426TrustedOutputSafeSiblingProofNeedle,
    sourceFile: securityTestBuildGatePath,
    test: assertKv426TrustedOutputSafeSiblingProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the generated KV426 trusted-output SINK-position proof evidence from the real-build gate.',
    expectedKiller:
      'KV426 trusted-output proof enrollment must consume DEC-G generated SINK-position needles',
    name: 'security-test-build-gate/drop-kv426-generated-sink-position-proof-enrollment',
    replacement: removedKv426TrustedOutputGeneratedSinkNeedles,
    search: kv426TrustedOutputGeneratedSinkNeedles,
    sourceFile: securityTestBuildGatePath,
    sourceOnly: true,
    test: assertKv426TrustedOutputGeneratedSinkPositionProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the generated read-SOURCE proof evidence from the real-build gate.',
    expectedKiller:
      'security proof enrollment must consume DEC-G generated read-SOURCE family needles',
    name: 'security-test-build-gate/drop-generated-read-source-proof-enrollment',
    replacement: removedReadSourceGeneratedNeedles,
    search: readSourceGeneratedNeedles,
    sourceFile: securityTestBuildGatePath,
    sourceOnly: true,
    test: assertGeneratedReadSourceProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the generated wrapping grammar proof evidence from the real-build gate.',
    expectedKiller:
      'security proof enrollment must consume DEC-G generated wrapping grammar needles',
    name: 'security-test-build-gate/drop-generated-wrapping-proof-enrollment',
    replacement: removedWrappingGeneratedNeedles,
    search: wrappingGeneratedNeedles,
    sourceFile: securityTestBuildGatePath,
    sourceOnly: true,
    test: assertGeneratedWrappingProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the generated Phase 5.1 paranoid acceptance evidence from the real-build gate.',
    expectedKiller:
      'paranoid runtime proof enrollment must consume generated read and write acceptance needles',
    name: 'security-test-build-gate/drop-generated-paranoid-acceptance-proof-enrollment',
    replacement: removedParanoidAcceptanceGeneratedNeedles,
    search: paranoidAcceptanceGeneratedNeedles,
    sourceFile: securityTestBuildGatePath,
    sourceOnly: true,
    test: assertGeneratedParanoidAcceptanceProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Weakens the KV426 TrustedUrl attribute proof enrollment so it no longer pins the injected non-URL attribute fixture.',
    expectedKiller:
      'KV426 TrustedUrl attribute proof enrollment must retain the non-URL attribute fixture helper',
    name: 'security-test-build-gate/weaken-kv426-trusted-url-attribute-proof-enrollment',
    replacement: weakenedKv426TrustedUrlAttributeProofNeedle,
    search: kv426TrustedUrlAttributeProofNeedle,
    sourceFile: securityTestBuildGatePath,
    test: assertKv426TrustedUrlAttributeProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Weakens the KV433 storage-query proof enrollment so it no longer pins direct delete write detection.',
    expectedKiller:
      'KV433 storage-query proof enrollment must retain direct storage delete operation evidence',
    name: 'security-test-build-gate/weaken-kv433-storage-delete-proof-enrollment',
    replacement: weakenedKv433StorageDeleteProofNeedle,
    search: kv433StorageDeleteProofNeedle,
    sourceFile: securityTestBuildGatePath,
    test: assertKv433StorageDeleteProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Weakens the KV330 webhook context.tx escape proof enrollment so it no longer pins the real starter build-fail path.',
    expectedKiller:
      'KV330 webhook context.tx escape proof enrollment must retain webhook context.tx build-fail evidence',
    name: 'security-test-build-gate/weaken-kv330-webhook-context-tx-escape-proof-enrollment',
    replacement: weakenedKv330WebhookContextTxEscapeProofEnrollmentBranch,
    search: kv330WebhookContextTxEscapeProofEnrollmentBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertKv330WebhookContextTxEscapeProofEnrollmentIsPinned,
  },
  {
    baseModule: securityTestBuildGate,
    description:
      'Deletes the branch that rejects fixture-only proof tests without the declared production build invocation.',
    expectedKiller: 'B3 resolver proofs must call the real kovo build path',
    name: 'security-test-build-gate/drop-production-build-invocation-check',
    replacement: removedProductionBuildInvocationBranch,
    search: productionBuildInvocationBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertFixtureOnlyProofIsCaught,
  },
  {
    description:
      'Weakens KV426 call/new expression value-flow so unknown call results are treated as clean.',
    expectedKiller: 'KV426 trusted-output value-flow must fail closed for unknown call results',
    name: 'trusted-html-provenance/weaken-call-result-taint-fail-closed',
    replacement: weakenedTrustedHtmlCallTaintFailClosedBranch,
    search: trustedHtmlCallTaintFailClosedBranch,
    sourceFile: trustedHtmlProvenancePath,
    sourceOnly: true,
    test: assertTrustedHtmlProvenanceKeepsCallResultFailClosed,
  },
  {
    baseModule: securityTestBuildGate,
    description: 'Deletes the branch that pins starter artifact helpers to kovo build --no-cache.',
    expectedKiller: 'starter production artifact proofs must route through kovo build --no-cache',
    name: 'security-test-build-gate/drop-starter-helper-evidence',
    replacement: removedBuildHelperEvidenceBranch,
    search: buildHelperEvidenceBranch,
    sourceFile: securityTestBuildGatePath,
    test: assertStarterHelperEvidenceIsCaught,
  },
  {
    baseModule: sinkPolicyGate,
    description: 'Deletes the SQL guard environment downgrade detector.',
    expectedKiller: 'H/I SQL guard downgrade env knobs must stay forbidden',
    name: 'check-sink-policy-gate/drop-sql-guard-env-detector',
    replacement: removedSqlGuardEnvBranch,
    search: sqlGuardEnvBranch,
    sourceFile: sinkPolicyGatePath,
    test: assertSqlGuardEnvDowngradeIsCaught,
  },
  {
    baseModule: sinkPolicyGate,
    description: 'Deletes the managed-DB failed-validation throw invariant.',
    expectedKiller: 'H/I managed DB handles must throw instead of warning on failed SQL validation',
    name: 'check-sink-policy-gate/drop-managed-db-throw-invariant',
    replacement: removedManagedDbThrowBranch,
    search: managedDbThrowBranch,
    sourceFile: sinkPolicyGatePath,
    test: assertManagedDbThrowInvariantIsCaught,
  },
  {
    description: 'Deletes the managed raw-driver escape denial before nested handle wrapping.',
    expectedKiller: 'H/I managed raw-driver escapes must be denied before Reflect.get',
    name: 'sql-safe-handle/drop-managed-raw-driver-escape-denial',
    replacement: removedManagedRawDriverEscapeBranch,
    search: managedRawDriverEscapeBranch,
    sourceFile: sqlSafeHandlePath,
    sourceOnly: true,
    test: assertManagedRawDriverEscapeDenialPrecedesNestedWrapping,
  },
  {
    baseModule: sinkPolicyGate,
    description: 'Deletes the response-fragment injected createHTML routing count invariant.',
    expectedKiller:
      'C2 trusted fragment sinks must route both membrane parse inputs through createHTML',
    name: 'check-sink-policy-gate/drop-response-fragment-trustedhtml-route-count',
    replacement: removedResponseFragmentTrustedHtmlRouteBranch,
    search: responseFragmentTrustedHtmlRouteBranch,
    sourceFile: sinkPolicyGatePath,
    test: assertResponseFragmentTrustedHtmlRouteCountIsCaught,
  },
  {
    description: 'Deletes HTML escaping from the /_q query response wire body sink.',
    expectedKiller: 'C2 /_q query wire bodies must HTML-escape serialized values',
    name: 'server-wire-html/drop-query-wire-body-escaping',
    replacement: removedQueryWireHtmlEscapeBranch,
    search: queryWireHtmlEscapeBranch,
    sourceFile: queryWireHtmlPath,
    sourceOnly: true,
    test: assertQueryWireHtmlBodyEscapingIsCaught,
  },
  {
    description:
      'Deletes exact same-consumer identity from the Better Auth credential result refusal.',
    expectedKiller:
      'M2 Better Auth runtime results must be opened only by the exact consumer that minted them',
    name: 'better-auth-credential-gate/drop-result-consumer-identity',
    replacement: removedBetterAuthCredentialResultIdentityBranch,
    search: betterAuthCredentialResultIdentityBranch,
    sourceFile: betterAuthCredentialRuntimeGatePath,
    sourceOnly: true,
    test: assertBetterAuthCredentialResultIdentityIsPinned,
  },
  {
    description: 'Lets any Better Auth consumer token invoke a different raw credential source.',
    expectedKiller:
      'M2 Better Auth raw callables must require a contract whose exact source matches the invocation',
    name: 'better-auth-credential-gate/drop-source-identity',
    replacement: removedBetterAuthCredentialSourceIdentityBranch,
    search: betterAuthCredentialSourceIdentityBranch,
    sourceFile: betterAuthCredentialRuntimeGatePath,
    sourceOnly: true,
    test: assertBetterAuthCredentialSourceIsPinned,
  },
  {
    baseModule: requestIngressPolicy,
    description: 'Allows Fetch to canonicalize a lower-case standard POST method before dispatch.',
    expectedKiller: 'request-ingress method identity must reject lower-case standard methods',
    name: 'request-ingress/allow-lowercase-standard-post',
    replacement: weakenedCanonicalPostMethodBranch,
    search: canonicalPostMethodBranch,
    sourceFile: requestIngressPolicyPath,
    test: assertRequestIngressMethodIdentityIsClosed,
  },
  {
    baseModule: requestIngressPolicy,
    description:
      'Drops the HTTPS serialization half of canonical authority identity and admits :443.',
    expectedKiller:
      'request-ingress authority identity must stay byte-identical under both HTTP schemes',
    name: 'request-ingress/drop-https-authority-identity',
    replacement: weakenedDualSchemeAuthorityIdentityBranch,
    search: dualSchemeAuthorityIdentityBranch,
    sourceFile: requestIngressPolicyPath,
    test: assertRequestIngressDualSchemeAuthorityIsClosed,
  },
  {
    baseModule: requestIngressPolicy,
    description: 'Lets normalized Host disagree with the exact raw HTTP/1 Host evidence.',
    expectedKiller: 'request-ingress HTTP/1 authority must bind raw and normalized Host exactly',
    name: 'request-ingress/drop-raw-host-value-identity',
    replacement: weakenedRawHttp1HostEvidenceBranch,
    search: rawHttp1HostEvidenceBranch,
    sourceFile: requestIngressPolicyPath,
    test: assertRequestIngressRawHostIdentityIsClosed,
  },
  {
    baseModule: requestIngressPolicy,
    description: 'Admits an uppercase HTTP/2 pseudo-scheme that the finite grammar closes.',
    expectedKiller: 'request-ingress schemes must remain exact lowercase http or https',
    name: 'request-ingress/allow-uppercase-h2-scheme',
    replacement: weakenedExactIngressSchemeBranch,
    search: exactIngressSchemeBranch,
    sourceFile: requestIngressPolicyPath,
    test: assertRequestIngressExactSchemeIsClosed,
  },
  {
    baseModule: requestIngressPolicy,
    description: 'Drops encoded dot and separator refusal from the request-target grammar.',
    expectedKiller: 'request-ingress targets must close encoded path aliases',
    name: 'request-ingress/drop-encoded-target-controls',
    replacement: weakenedEncodedIngressTargetBranch,
    search: encodedIngressTargetBranch,
    sourceFile: requestIngressPolicyPath,
    test: assertRequestIngressEncodedTargetIsClosed,
  },
  {
    baseModule: requestIngressPolicy,
    description: 'Lets an HTTP/2 posture borrow the incompatible ordinary Host field.',
    expectedKiller: 'request-ingress HTTP/2 posture must reject ordinary Host evidence',
    name: 'request-ingress/allow-h2-host-field',
    replacement: weakenedH2IncompatibleSourceBranch,
    search: h2IncompatibleSourceBranch,
    sourceFile: requestIngressPolicyPath,
    test: assertRequestIngressH2SourceIsClosed,
  },
  {
    baseModule: requestIngressPolicy,
    description: 'Lets non-canonical Vercel client provenance survive platform classification.',
    expectedKiller: 'request-ingress Vercel client provenance must be canonical and exact',
    name: 'request-ingress/drop-vercel-client-canonical-identity',
    replacement: weakenedCanonicalVercelClientBranch,
    search: canonicalVercelClientBranch,
    sourceFile: requestIngressPolicyPath,
    test: assertRequestIngressVercelClientIsClosed,
  },
  {
    description: 'Recomputes Vercel request ingress after the accepted prepared snapshot.',
    expectedKiller: 'generated Vercel dispatch must consume exactly one prepared ingress verdict',
    name: 'request-ingress/recompute-vercel-prepared-verdict',
    replacement: weakenedPreparedVercelIngressBranch,
    search: preparedVercelIngressBranch,
    sourceFile: serverBuildPath,
    sourceOnly: true,
    test: assertGeneratedVercelPreparedIngressIsSingle,
  },
  {
    baseModule: fundamentalFixesCensusGate,
    description: 'Deletes the M5 forbidden-status census enforcement branch.',
    expectedKiller: 'M5 census statuses such as future must stay forbidden, not merely unsupported',
    name: 'fundamental-fixes-census-gate/drop-m5-forbidden-status-enforcement',
    replacement: removedM5ForbiddenStatusBranch,
    search: m5ForbiddenStatusBranch,
    sourceFile: fundamentalFixesCensusGatePath,
    test: assertM5ForbiddenStatusIsCaught,
  },
  {
    baseModule: fundamentalFixesCensusGate,
    description: 'Deletes closed-row M1 evidence validation from the census gate.',
    expectedKiller: 'Closed census rows must carry M1 adversarial evidence',
    name: 'fundamental-fixes-census-gate/drop-closed-row-m1-evidence-enforcement',
    replacement: removedClosedRowM1EvidenceBranch,
    search: closedRowM1EvidenceBranch,
    sourceFile: fundamentalFixesCensusGatePath,
    test: assertClosedRowM1EvidenceIsCaught,
  },
  {
    baseModule: fundamentalFixesCensusGate,
    description: 'Deletes the M4 dialect x sink denominator matrix requirement.',
    expectedKiller: 'M4 dialect x sink matrix rows must be complete',
    name: 'fundamental-fixes-census-gate/drop-dialect-matrix-requirement',
    replacement: removedDialectMatrixRequirementBranch,
    search: dialectMatrixRequirementBranch,
    sourceFile: fundamentalFixesCensusGatePath,
    test: assertDialectMatrixRequirementIsCaught,
  },
  {
    baseModule: fundamentalFixesCensusGate,
    description:
      'Drifts the B3 resolver expression-kind denominator away from the TypeScript-derived kind set.',
    expectedKiller:
      'B3 resolver expression-kind denominator must stay derived from TypeScript plus default',
    name: 'fundamental-fixes-census-gate/drift-resolver-expression-kind-denominator',
    replacement: driftedResolverExpressionKindDenominatorBranch,
    search: resolverExpressionKindDenominatorBranch,
    sourceFile: fundamentalFixesCensusGatePath,
    test: assertResolverExpressionKindDenominatorIsTypeScriptDerived,
  },
  {
    baseModule: fundamentalFixesCensusGate,
    description: 'Deletes the B3 resolver status requirement.',
    expectedKiller: 'B3 resolver expression-kind rows must carry resolverStatus',
    name: 'fundamental-fixes-census-gate/drop-resolver-status-requirement',
    replacement: removedResolverStatusRequirementBranch,
    search: resolverStatusRequirementBranch,
    sourceFile: fundamentalFixesCensusGatePath,
    test: assertResolverStatusRequirementIsCaught,
  },
  {
    baseModule: fundamentalFixesCensusGate,
    description: 'Deletes the B3 resolver coverage expectation requirement.',
    expectedKiller: 'B3 resolver expression-kind rows must carry coverageExpectation',
    name: 'fundamental-fixes-census-gate/drop-resolver-coverage-expectation-requirement',
    replacement: removedResolverCoverageExpectationRequirementBranch,
    search: resolverCoverageExpectationRequirementBranch,
    sourceFile: fundamentalFixesCensusGatePath,
    test: assertResolverCoverageExpectationRequirementIsCaught,
  },
  {
    baseModule: fundamentalFixesCensusGate,
    description:
      'Deletes rejection of resolver expression kinds outside the TypeScript denominator.',
    expectedKiller: 'B3 resolver expression-kind rows must reject unknown expression kinds',
    name: 'fundamental-fixes-census-gate/drop-unknown-resolver-expression-kind-rejection',
    replacement: removedUnknownResolverExpressionKindBranch,
    search: unknownResolverExpressionKindBranch,
    sourceFile: fundamentalFixesCensusGatePath,
    test: assertUnknownResolverExpressionKindIsCaught,
  },
  {
    description: 'Deletes the core resolver expression-kind branch for literal element access.',
    expectedKiller:
      'B3 resolver must classify ElementAccessExpression as resolved rather than fail-closed',
    name: 'core-framework-identity/drop-element-access-kind-resolution',
    replacement: removedCoreElementAccessResolverBranch,
    search: coreElementAccessResolverBranch,
    sourceFile: coreFrameworkIdentityPath,
    sourceOnly: true,
    test: assertCoreResolverSourceKeepsElementAccess,
  },
  {
    description: 'Deletes the core resolver canonicalization branch for literal element access.',
    expectedKiller:
      'B3 resolver must route literal element access through namespace member resolution',
    name: 'core-framework-identity/drop-element-access-canonicalization',
    replacement: removedCoreElementAccessCanonicalBranch,
    search: coreElementAccessCanonicalBranch,
    sourceFile: coreFrameworkIdentityPath,
    sourceOnly: true,
    test: assertCoreResolverSourceKeepsElementAccess,
  },
  {
    description: 'Deletes the core resolver export-star traversal branch.',
    expectedKiller:
      'B3 resolver must traverse export * barrels when resolving framework identities',
    name: 'core-framework-identity/drop-export-star-resolution',
    replacement: removedCoreExportStarResolverBranch,
    search: coreExportStarResolverBranch,
    sourceFile: coreFrameworkIdentityPath,
    sourceOnly: true,
    test: assertCoreResolverSourceKeepsExportStar,
  },
  {
    description:
      'Deletes compileComponentModule registration of production sibling files with the resolver.',
    expectedKiller:
      'E2 production compile must register extraFiles with framework identity resolution',
    name: 'compiler-compile/drop-framework-identity-project-registration',
    replacement: removedCompileSiblingRegistrationBranch,
    search: compileSiblingRegistrationBranch,
    sourceFile: compilerCompilePath,
    sourceOnly: true,
    test: assertCompilerSourceKeepsSiblingRegistration,
  },
  {
    description:
      'Weakens Vite production sibling discovery so .js imports no longer prefer .ts/.tsx siblings.',
    expectedKiller:
      'E2 production resolver must keep .js import specifiers resolving to TS/TSX siblings',
    name: 'compiler-vite/drop-js-to-ts-sibling-candidates',
    replacement: weakenedViteJsToTsSiblingCandidatesBranch,
    search: viteJsToTsSiblingCandidatesBranch,
    sourceFile: compilerVitePath,
    sourceOnly: true,
    test: assertViteSourceKeepsJsToTsSiblingCandidates,
  },
  {
    description: 'Deletes the positive origin decision before framework-owned DNS resolution.',
    expectedKiller: 'framework egress must reject an undeclared origin before DNS',
    name: 'server-egress/drop-origin-before-dns',
    replacement: removedFrameworkEgressOriginCheck,
    search: frameworkEgressOriginCheck,
    sourceFile: serverEgressPath,
    sourceOnly: true,
    test: assertFrameworkEgressSourceKeepsPositiveCapability,
  },
  {
    description: "Deletes rebinding of Request private state to Kovo's installed dispatcher.",
    expectedKiller: 'framework egress must replace application dispatcher authority',
    name: 'server-egress/drop-dispatcher-pin',
    replacement: removedFrameworkEgressDispatcherPin,
    search: frameworkEgressDispatcherPin,
    sourceFile: serverEgressPath,
    sourceOnly: true,
    test: assertFrameworkEgressSourceKeepsPositiveCapability,
  },
  {
    description: 'Makes the durable-task contextual fetch capability replaceable after delivery.',
    expectedKiller: 'task ctx.fetch must be an exact non-replaceable own capability',
    name: 'server-egress/drop-task-context-fetch-seal',
    replacement: removedTaskEgressCapabilitySeal,
    search: taskEgressCapabilitySeal,
    sourceFile: taskRunnerPath,
    sourceOnly: true,
    test: assertTaskEgressContextKeepsCapabilitySeal,
  },
  {
    description: 'Makes the webhook contextual fetch capability replaceable after verification.',
    expectedKiller: 'webhook ctx.fetch must be an exact non-replaceable own capability',
    name: 'server-egress/drop-webhook-context-fetch-seal',
    replacement: removedWebhookEgressCapabilitySeal,
    search: webhookEgressCapabilitySeal,
    sourceFile: webhookPath,
    sourceOnly: true,
    test: assertWebhookEgressContextKeepsCapabilitySeal,
  },
];

async function assertDynamicBindingControlPlaneClosureBehavior(moduleUnderTest) {
  const reservedNames = [
    'data-bind:aria-label',
    'data-kovo-module-allowlist',
    'data-stream-renderer',
    'ON:CLICK',
  ];
  for (const name of reservedNames) {
    const dynamicDecision = moduleUnderTest.decideRuntimeAttributeWrite(
      name,
      '/c/attacker.client.js#run',
      { posture: 'dynamic-binding' },
    );
    if (dynamicDecision.action !== 'remove' || dynamicDecision.family !== 'framework-control') {
      throw new Error(`dynamic binding retained compiler control-plane attribute ${name}`);
    }
    const compilerWireDecision = moduleUnderTest.decideRuntimeAttributeWrite(
      name,
      '/c/compiler.client.js#run',
    );
    if (compilerWireDecision.action !== 'allow') {
      throw new Error(`compiler wire lost control-plane attribute ${name}`);
    }
  }
  const visibleDecision = moduleUnderTest.decideRuntimeAttributeWrite('aria-label', 'Ready', {
    posture: 'dynamic-binding',
  });
  if (visibleDecision.action !== 'allow') {
    throw new Error('dynamic binding lost an ordinary visible attribute');
  }
}

async function assertDynamicGeneratedControlTargetCompilerBehavior(
  _moduleUnderTest,
  { sourceText },
) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-dynamic-control-target-behavior-'));
  try {
    const compilerRoot = path.join(tempRoot, 'packages', 'compiler');
    mkdirSync(compilerRoot, { recursive: true });
    cpSync(path.join(repoRoot, 'packages/compiler/src'), path.join(compilerRoot, 'src'), {
      recursive: true,
    });
    cpSync(
      path.join(repoRoot, 'packages/compiler/package.json'),
      path.join(compilerRoot, 'package.json'),
    );
    symlinkSync(
      path.join(repoRoot, 'packages/compiler/node_modules'),
      path.join(compilerRoot, 'node_modules'),
      'dir',
    );
    writeFileSync(path.join(compilerRoot, 'src/security/output-context.ts'), sourceText, 'utf8');
    writeFileSync(path.join(tempRoot, 'package.json'), '{"private":true,"type":"module"}\n');

    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules/vitest/vitest.mjs'),
        '--run',
        'packages/compiler/src/output-context-security.test.ts',
        '--testNamePattern',
        'dynamic binding targeting the generated|dynamic generated-control target smuggled',
        '--reporter=dot',
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 60_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `dynamic generated-control compiler regression:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
      );
    }
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

async function assertInlineDynamicControlPlaneClosureBehavior(_moduleUnderTest, { sourceText }) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-inline-control-plane-behavior-'));
  try {
    const browserRoot = path.join(tempRoot, 'packages', 'browser');
    const coreInternalRoot = path.join(tempRoot, 'packages', 'core', 'src', 'internal');
    mkdirSync(browserRoot, { recursive: true });
    mkdirSync(coreInternalRoot, { recursive: true });
    cpSync(path.join(repoRoot, 'packages/browser/src'), path.join(browserRoot, 'src'), {
      recursive: true,
    });
    cpSync(
      path.join(repoRoot, 'packages/browser/package.json'),
      path.join(browserRoot, 'package.json'),
    );
    cpSync(
      path.join(repoRoot, 'packages/core/src/internal/semantic-attribute-manifest.ts'),
      path.join(coreInternalRoot, 'semantic-attribute-manifest.ts'),
    );
    symlinkSync(
      path.join(repoRoot, 'packages/browser/node_modules'),
      path.join(browserRoot, 'node_modules'),
      'dir',
    );
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(tempRoot, 'node_modules'), 'dir');
    writeFileSync(path.join(browserRoot, 'src/inline-loader-build.ts'), sourceText, 'utf8');
    writeFileSync(path.join(tempRoot, 'package.json'), '{"private":true,"type":"module"}\n');

    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules/vitest/vitest.mjs'),
        '--run',
        'packages/browser/src/inline-loader-security.test.ts',
        '--testNamePattern',
        'removes state-selected compiler control-plane attributes',
        '--reporter=dot',
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 60_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `inline dynamic control-plane regression:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
      );
    }
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

async function assertAuthoredExecutableReferenceClosureBehavior(_moduleUnderTest, { sourceText }) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-authored-executable-ref-behavior-'));
  try {
    const compilerRoot = path.join(tempRoot, 'packages', 'compiler');
    mkdirSync(compilerRoot, { recursive: true });
    cpSync(path.join(repoRoot, 'packages/compiler/src'), path.join(compilerRoot, 'src'), {
      recursive: true,
    });
    cpSync(
      path.join(repoRoot, 'packages/compiler/package.json'),
      path.join(compilerRoot, 'package.json'),
    );
    symlinkSync(
      path.join(repoRoot, 'packages/compiler/node_modules'),
      path.join(compilerRoot, 'node_modules'),
      'dir',
    );
    writeFileSync(path.join(compilerRoot, 'src/validate/authoring-surface.ts'), sourceText, 'utf8');
    writeFileSync(path.join(tempRoot, 'package.json'), '{"private":true,"type":"module"}\n');

    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules/vitest/vitest.mjs'),
        '--run',
        'packages/compiler/src/security-operation-ir.security.test.ts',
        '--testNamePattern',
        'app-authored static lowered|duplicate and nested|compiler-emitted executable references',
        '--reporter=dot',
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 60_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `authored executable-reference behavioral regression:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
      );
    }
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

async function assertRuntimeSelectedExecutableReferenceClosureBehavior(
  _moduleUnderTest,
  { sourceText },
) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-finite-ir-behavior-'));
  try {
    const compilerRoot = path.join(tempRoot, 'packages', 'compiler');
    mkdirSync(compilerRoot, { recursive: true });
    cpSync(path.join(repoRoot, 'packages/compiler/src'), path.join(compilerRoot, 'src'), {
      recursive: true,
    });
    cpSync(
      path.join(repoRoot, 'packages/compiler/package.json'),
      path.join(compilerRoot, 'package.json'),
    );
    symlinkSync(
      path.join(repoRoot, 'packages/compiler/node_modules'),
      path.join(compilerRoot, 'node_modules'),
      'dir',
    );
    writeFileSync(
      path.join(compilerRoot, 'src/validate/security-operation-ir.ts'),
      sourceText,
      'utf8',
    );
    writeFileSync(path.join(tempRoot, 'package.json'), '{"private":true,"type":"module"}\n');

    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules/vitest/vitest.mjs'),
        '--run',
        'packages/compiler/src/security-operation-ir.security.test.ts',
        '--testNamePattern',
        'runtime-selected handler reference|runtime-selected executable selector|exact static reviewed executable references',
        '--reporter=dot',
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
        timeout: 60_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `finite browser IR behavioral regression:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
      );
    }
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

const behavioralTypeScriptBaselineModules = new Map();

export async function runSecurityGateMutationHarness({ mutants = SECURITY_GATE_MUTANTS } = {}) {
  const results = [];

  for (const mutant of mutants) {
    const result = {
      description: mutant.description,
      expectedKiller: mutant.expectedKiller,
      name: mutant.name,
      status: 'unknown',
    };

    try {
      const sourceText = readFileSync(mutant.sourceFile, 'utf8');
      const baselineModule =
        mutant.behavioralTypeScript === true
          ? await behavioralTypeScriptBaselineModule(
              mutant.sourceFile,
              sourceText,
              mutant.behavioralEntryFile,
              mutant.behavioralInstrumentation,
            )
          : mutant.baseModule;
      await mutant.test(baselineModule, { sourceText });
    } catch (error) {
      results.push({
        ...result,
        error: `baseline gate did not satisfy killer assertion: ${formatError(error)}`,
        status: 'baseline-failed',
      });
      continue;
    }

    const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-security-gate-mutant-'));
    try {
      const mutantPath = path.join(tempRoot, 'scripts', path.basename(mutant.sourceFile));
      const sourceText = readFileSync(mutant.sourceFile, 'utf8');
      const mutatedSourceText = applyExactMutation(sourceText, mutant);
      if (mutant.behavioralTypeScript === true) {
        const mutantModule = await bundleBehavioralTypeScriptModule(
          tempRoot,
          mutant.sourceFile,
          mutatedSourceText,
          mutant.behavioralEntryFile,
          mutant.behavioralInstrumentation,
        );
        try {
          await mutant.test(mutantModule, { sourceText: mutatedSourceText });
          results.push({
            ...result,
            error: 'mutated gate still satisfied the killer assertion',
            status: 'survived',
          });
        } catch (error) {
          results.push({
            ...result,
            killerFailure: formatError(error),
            status: 'killed',
          });
        }
        continue;
      }
      if (mutant.sourceOnly === true) {
        try {
          await mutant.test(mutant.baseModule, { sourceText: mutatedSourceText });
          results.push({
            ...result,
            error: 'mutated gate still satisfied the killer assertion',
            status: 'survived',
          });
        } catch (error) {
          results.push({
            ...result,
            killerFailure: formatError(error),
            status: 'killed',
          });
        }
        continue;
      }

      installMutantScriptLib(tempRoot);
      mkdirSync(path.dirname(mutantPath), { recursive: true });
      writeFileSync(mutantPath, mutatedSourceText, 'utf8');
      const mutantModule = await import(`${pathToFileURL(mutantPath).href}?mutant=${Date.now()}`);

      try {
        await mutant.test(mutantModule);
        results.push({
          ...result,
          error: 'mutated gate still satisfied the killer assertion',
          status: 'survived',
        });
      } catch (error) {
        results.push({
          ...result,
          killerFailure: formatError(error),
          status: 'killed',
        });
      }
    } catch (error) {
      results.push({
        ...result,
        error: `mutation harness failed before executing the killer assertion: ${formatError(error)}`,
        status: 'harness-failed',
      });
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  }

  return results;
}

function behavioralTypeScriptBaselineModule(
  sourceFile,
  sourceText,
  entryFile = sourceFile,
  instrumentation = '',
) {
  const key = `${sourceFile}\0${entryFile}\0${instrumentation}`;
  let modulePromise = behavioralTypeScriptBaselineModules.get(key);
  if (!modulePromise) {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-security-gate-baseline-'));
    modulePromise = bundleBehavioralTypeScriptModule(
      tempRoot,
      sourceFile,
      sourceText,
      entryFile,
      instrumentation,
    ).finally(() => {
      rmSync(tempRoot, { force: true, recursive: true });
    });
    behavioralTypeScriptBaselineModules.set(key, modulePromise);
  }
  return modulePromise;
}

async function bundleBehavioralTypeScriptModule(
  tempRoot,
  sourceFile,
  sourceText,
  entryFile = sourceFile,
  instrumentation = '',
) {
  const outputFile = path.join(tempRoot, `behavioral-${Date.now()}-${Math.random()}.mjs`);
  const tempNodeModules = path.join(tempRoot, 'node_modules');
  if (!existsSync(tempNodeModules)) {
    symlinkSync(path.join(repoRoot, 'node_modules'), tempNodeModules, 'dir');
  }
  const loader = path.extname(sourceFile).endsWith('x') ? 'tsx' : 'ts';
  const usesDependencyOverlay = path.resolve(entryFile) !== path.resolve(sourceFile);
  const executableSource = `${sourceText}${instrumentation}`;
  await buildWithEsbuild({
    absWorkingDir: repoRoot,
    bundle: true,
    ...(usesDependencyOverlay ? { entryPoints: [entryFile] } : {}),
    external: ['ts-morph'],
    format: 'esm',
    logLevel: 'silent',
    outfile: outputFile,
    platform: 'node',
    ...(usesDependencyOverlay
      ? {
          plugins: [
            {
              name: 'kovo-behavioral-mutant-overlay',
              setup(build) {
                build.onLoad({ filter: /.*/ }, (args) =>
                  path.resolve(args.path) === path.resolve(sourceFile)
                    ? { contents: executableSource, loader }
                    : undefined,
                );
              },
            },
          ],
        }
      : {
          stdin: {
            contents: executableSource,
            loader,
            resolveDir: path.dirname(sourceFile),
            sourcefile: path.basename(sourceFile),
          },
        }),
    target: 'node24',
  });
  return import(`${pathToFileURL(outputFile).href}?behavioral=${Date.now()}-${Math.random()}`);
}

function installMutantScriptLib(tempRoot) {
  const libDir = path.join(tempRoot, 'scripts', 'lib');
  mkdirSync(libDir, { recursive: true });
  mkdirSync(path.join(tempRoot, 'scripts'), { recursive: true });
  writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
  const repoNodeModules = path.join(repoRoot, 'node_modules');
  if (existsSync(repoNodeModules)) {
    symlinkSync(repoNodeModules, path.join(tempRoot, 'node_modules'), 'dir');
  }
  for (const file of ['cli-entry.mjs', 'repo-root.mjs', 'source-files.mjs']) {
    writeFileSync(
      path.join(libDir, file),
      readFileSync(path.join(scriptsDir, 'lib', file), 'utf8'),
      'utf8',
    );
  }
  writeFileSync(
    path.join(tempRoot, 'scripts', 'check-security-brands.mjs'),
    readFileSync(path.join(scriptsDir, 'check-security-brands.mjs'), 'utf8'),
    'utf8',
  );
}

async function assertExactTrustedAssignIdentityIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(exactTrustedAssignIdentityBranch)) {
    throw new Error('trustedAssign no longer requires exact @kovojs/server export identity');
  }
}

async function assertBrowserRtcNetworkCapabilityIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(browserRtcNetworkCapabilityBranch)) {
    throw new Error('capability closure no longer classifies RTCPeerConnection as raw network');
  }
}

async function assertAmbientErrorStabilityIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(ambientErrorStabilityBranch)) {
    throw new Error('ambient Error admission no longer requires stable callable identity');
  }
}

async function assertAmbientCryptoRandomUuidStabilityIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(ambientCryptoRandomUuidStabilityBranch)) {
    throw new Error(
      'ambient crypto.randomUUID admission no longer requires stable member identity',
    );
  }
}

async function assertFiniteManagedDatabaseContinuationIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(finiteManagedDatabaseContinuationBranch)) {
    throw new Error('managed database continuations no longer require the finite method set');
  }
}

async function assertManagedDatabaseForeignArgumentClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(managedDatabaseForeignArgumentClosureBranch)) {
    throw new Error('managed database continuations no longer reject foreign executable arguments');
  }
}

async function assertExactProjectSchemaFactoryIdentityIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(exactProjectSchemaFactoryIdentityBranch)) {
    throw new Error('project schema values no longer require exact Drizzle table-factory identity');
  }
}

async function assertImmutableProjectSchemaBindingIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(immutableProjectSchemaBindingBranch)) {
    throw new Error('project schema values no longer require immutable exported bindings');
  }
}

async function assertRenderEquivalenceProjectIdentityIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(renderEquivalenceProjectIdentityBranch)) {
    throw new Error('render-equivalence reparsing no longer receives project identity files');
  }
}

function threatMatrixDenominatorFixture(overrides = {}) {
  return {
    auditedCapabilityKinds: [],
    auditedTrustEscapeKinds: [],
    documentedSurfaceLabels: ['Mutant surface'],
    manifest: {
      auditedEscapeMappings: [],
      proofs: {},
      publicSurfaceMappings: [],
      sinkMappings: [],
      surfaces: [{ id: 'mutant-surface', label: 'Mutant surface' }],
      version: 1,
    },
    publicSecuritySurfaceIds: [],
    repoRoot,
    rootScripts: {},
    sourceSinkInventory: [],
    ...overrides,
  };
}

async function assertThreatMatrixMissingSinkDenominatorIsPinned(moduleUnderTest) {
  const expected = 'C9 sink mappings missing: mutant.unmapped.sink';
  const findings = moduleUnderTest.validateThreatMatrixCoverage(
    threatMatrixDenominatorFixture({
      sourceSinkInventory: [{ escapeHatch: 'none', sink: 'mutant.unmapped.sink' }],
    }),
  );
  if (!findings.includes(expected)) {
    throw new Error('threat-matrix gate no longer rejects an unmapped authoritative C9 sink');
  }
}

async function assertThreatMatrixMissingAuditedEscapeDenominatorIsPinned(moduleUnderTest) {
  const expected = 'audited escape mappings missing: capability:mutantCapability';
  const findings = moduleUnderTest.validateThreatMatrixCoverage(
    threatMatrixDenominatorFixture({ auditedCapabilityKinds: ['mutantCapability'] }),
  );
  if (!findings.includes(expected)) {
    throw new Error('threat-matrix gate no longer rejects an unmapped audited escape kind');
  }
}

async function assertThreatMatrixMissingPublicSurfaceDenominatorIsPinned(moduleUnderTest) {
  const expected = 'public security surface mappings missing: mutant-public-surface';
  const findings = moduleUnderTest.validateThreatMatrixCoverage(
    threatMatrixDenominatorFixture({ publicSecuritySurfaceIds: ['mutant-public-surface'] }),
  );
  if (!findings.includes(expected)) {
    throw new Error('threat-matrix gate no longer rejects an unmapped public security surface');
  }
}

function semanticV2MutationFixture() {
  const decoyCall = 'nestedWrite(request.db, input)';
  const decoyFactory = `mutation('summary-carrier/update', {
  handler() { return { ok: true }; },
})`;
  const decoyHandler = 'handler() { return { ok: true }; }';
  const helper = `async function nestedWrite(db, carrier) {
      await db
        .update(account)
        .set({ userId: serverValue(exactGuard(carrier), 'claimed owner') })
        .where(eq(account.id, input.id));
    }`;
  const handler = `async handler(input, request) {
    ${helper}
    await ${decoyCall};
    return { ok: true };
  }`;
  const factory = `mutation('summary-carrier/update', {
  ${handler},
})`;
  const source = `import { kovoAnalyzerSummary } from '@kovojs/drizzle';
import { mutation, serverValue } from '@kovojs/server';
import { eq } from 'drizzle-orm';
import { account } from './schema.js';

function exactGuard(context) { return context.guard.userId; }
kovoAnalyzerSummary(exactGuard, { returns: { kind: 'guard', path: 'userId' } });

function unusedCallShape(nestedWrite, request, input) {
  return ${decoyCall};
}

${decoyFactory};

export const update = ${factory};
`;
  const schemaSource = `import { pgTable, text } from 'drizzle-orm/pg-core';
export const account = pgTable('account', {
  id: text('id').notNull(),
  userId: text('user_id').notNull(),
});
`;
  const span = (text, from = 0) => {
    const start = source.indexOf(text, from);
    if (start < 0) throw new Error(`semantic-v2 mutation fixture lost exact text: ${text}`);
    return { end: start + text.length, start };
  };
  const decoyCallSpan = span(decoyCall);
  const actualCallSpan = span(decoyCall, decoyCallSpan.end);
  const actualArgumentSpans = ['request.db', 'input'].map((argument) =>
    span(argument, actualCallSpan.start),
  );
  const decoyArgumentSpans = ['request.db', 'input'].map((argument) =>
    span(argument, decoyCallSpan.start),
  );
  const callableSpan = span(helper);
  const root = 'mutation:summary-carrier/update';
  const transfer = 'local:nestedWrite[arg0=database]';
  const graph = {
    budgets: { callDepth: 16, nodes: 50_000, operations: 4_096, summaries: 256 },
    roots: [
      {
        binding: {
          callback: 'handler',
          callableSpan: span(handler),
          factory: 'mutation',
          factoryCallSpan: span(factory),
          root,
        },
        helperInvocations: [
          {
            argumentSpans: actualArgumentSpans,
            authorityInputs: ['arg0=database'],
            callable: 'local:nestedWrite',
            callableSpan,
            callSpan: actualCallSpan,
            operationKinds: ['server.database.write'],
            transfers: [transfer],
            verdict: 'proved',
          },
        ],
        root,
        summaries: [
          {
            authorityInputs: ['arg0=database'],
            callable: 'local:nestedWrite',
            callableSpan,
            operationKinds: ['server.database.write'],
            verdict: 'proved',
          },
        ],
        traces: [
          {
            root,
            sink: {
              door: 'managed-db',
              kind: 'server.database.write',
              target: 'db.update',
            },
            transfers: [transfer],
            verdict: 'proved',
          },
        ],
      },
    ],
    schema: 'kovo-security-semantic-graph/v2',
  };
  return {
    decoyArgumentSpans,
    decoyCallSpan,
    decoyFactorySpan: span(decoyFactory),
    decoyHandlerSpan: span(decoyHandler),
    files: [
      { fileName: 'summary-carrier.ts', source },
      { fileName: 'schema.ts', source: schemaSource },
    ],
    graph,
    schemaSource,
    source,
  };
}

function semanticV2Sinks(moduleUnderTest, fixture, graph, semanticSource = fixture.source) {
  return moduleUnderTest.collectUnregisteredSinksFromProject({
    compilerSecuritySemanticSources: [
      { fileName: 'summary-carrier.ts', graphs: [graph], source: semanticSource },
      { fileName: 'schema.ts', graphs: [], source: fixture.schemaSource },
    ],
    files: fixture.files,
  });
}

function semanticV2GraphCopy(fixture) {
  return structuredClone(fixture.graph);
}

function assertSemanticV2FixtureAdmitsExactProof(moduleUnderTest, fixture) {
  const sinks = semanticV2Sinks(moduleUnderTest, fixture, fixture.graph);
  if (sinks.length !== 0) {
    throw new Error(`exact semantic-v2 proof was not admitted: ${JSON.stringify(sinks)}`);
  }
}

function assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph, semanticSource) {
  assertSemanticV2FixtureAdmitsExactProof(moduleUnderTest, fixture);
  const sinks = semanticV2Sinks(moduleUnderTest, fixture, graph, semanticSource);
  if (!sinks.some((sink) => sink.sink === 'request-handler.opaque-protocol')) {
    throw new Error(`tampered semantic-v2 proof was admitted: ${JSON.stringify(sinks)}`);
  }
}

async function assertSemanticV2SourceByteEqualityIsEnforced(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, fixture.graph, `${fixture.source}\n`);
}

async function assertSemanticV2SchemaIsEnforced(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  graph.schema = 'kovo-security-semantic-graph/v1';
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2FactoryRootIsReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  const root = graph.roots[0];
  root.root = 'mutation:forged/update';
  root.binding.root = root.root;
  for (const trace of root.traces) trace.root = root.root;
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2CallableSpanIsReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  graph.roots[0].binding.callableSpan = fixture.decoyHandlerSpan;
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2HelperCallableSpanIsReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  graph.roots[0].summaries[0].callableSpan = fixture.decoyHandlerSpan;
  graph.roots[0].helperInvocations[0].callableSpan = fixture.decoyHandlerSpan;
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2FactoryCallSpanIsReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  graph.roots[0].binding.factoryCallSpan = fixture.decoyFactorySpan;
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2HelperCallSpanIsReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  const invocation = graph.roots[0].helperInvocations[0];
  invocation.callSpan = fixture.decoyCallSpan;
  invocation.argumentSpans = fixture.decoyArgumentSpans;
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2ArgumentSpansAreReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  graph.roots[0].helperInvocations[0].argumentSpans = fixture.decoyArgumentSpans;
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2AuthorityIsReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  const root = graph.roots[0];
  const authorityInputs = ['arg0=request'];
  const transfer = 'local:nestedWrite[arg0=request]';
  root.summaries[0].authorityInputs = authorityInputs;
  root.helperInvocations[0].authorityInputs = authorityInputs;
  root.helperInvocations[0].transfers = [transfer];
  root.traces[0].transfers = [transfer];
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2OperationInventoryIsReconstructed(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  const root = graph.roots[0];
  root.summaries[0].operationKinds = ['server.database.read'];
  root.helperInvocations[0].operationKinds = ['server.database.read'];
  root.traces[0].sink = {
    door: 'managed-db',
    kind: 'server.database.read',
    target: 'db.select',
  };
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2ClosedRootIsQuarantined(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  const root = graph.roots[0];
  root.traces.push({
    detail: 'closed sibling path',
    reason: 'opaque-transfer',
    root: root.root,
    sink: 'closed sibling path',
    transfers: [...root.helperInvocations[0].transfers],
    verdict: 'closed',
  });
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticV2ClosedSiblingIsQuarantined(moduleUnderTest) {
  const fixture = semanticV2MutationFixture();
  const graph = semanticV2GraphCopy(fixture);
  const root = graph.roots[0];
  root.summaries.push({ ...structuredClone(root.summaries[0]), verdict: 'closed' });
  root.helperInvocations.push({
    ...structuredClone(root.helperInvocations[0]),
    verdict: 'closed',
  });
  assertSemanticV2TamperIsRejected(moduleUnderTest, fixture, graph);
}

async function assertSemanticCycleClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticCycleClosureBranch)) {
    throw new Error('normalized semantic graph no longer absorbs an active helper-summary cycle');
  }
}

async function assertSemanticDepthClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticDepthClosureBranch)) {
    throw new Error('normalized semantic graph no longer closes exhausted helper depth');
  }
}

async function assertSemanticNodeBudgetClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticNodeBudgetClosureBranch)) {
    throw new Error('normalized semantic graph no longer closes exhausted node budgets');
  }
}

async function assertSemanticOperationBudgetClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticOperationBudgetClosureBranch)) {
    throw new Error('normalized semantic graph no longer closes exhausted operation budgets');
  }
}

async function assertSemanticSummaryBudgetClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticSummaryBudgetClosureBranch)) {
    throw new Error('normalized semantic graph no longer closes exhausted summary budgets');
  }
}

async function assertSemanticSurfacePropagationIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticSurfacePropagationBranch)) {
    throw new Error('normalized helper summary no longer inherits its originating surface');
  }
}

async function assertSemanticOperationMemberClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticOperationMemberClosureBranch)) {
    throw new Error('normalized operation members no longer become absorbing unknown authority');
  }
}

async function assertSemanticMemberMutationClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticMemberMutationClosureBranch)) {
    throw new Error('normalized semantic graph no longer rejects capability-member mutation');
  }
}

async function assertSemanticArgumentsClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticArgumentsClosureBranch)) {
    throw new Error('normalized semantic graph no longer rejects arguments-object recovery');
  }
}

async function assertSemanticNestedCaptureClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticNestedCaptureClosureBranch)) {
    throw new Error('normalized semantic graph no longer rejects nested authority capture');
  }
}

async function assertSemanticOpaqueContainerClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticOpaqueContainerClosureBranch)) {
    throw new Error('normalized semantic graph no longer rejects opaque authority containers');
  }
}

async function assertSemanticRestArgumentClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticRestArgumentClosureBranch)) {
    throw new Error('normalized semantic graph no longer rejects authority-bearing rest mappings');
  }
}

async function assertSemanticTableNamespaceClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(semanticTableNamespaceClosureBranch)) {
    throw new Error('generic DB table namespaces no longer reject raw-driver-shaped terminals');
  }
}

async function assertExactContextFetchInvocationIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(exactContextFetchInvocationBranch)) {
    throw new Error('framework egress no longer requires exact direct context.fetch provenance');
  }
}

async function assertAnalyzerSummaryStructuralProofIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryStructuralProofBranch)) {
    throw new Error('private analyzer declarations no longer require exact helper-body proof');
  }
}

async function assertAnalyzerSummaryCallCarrierIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryCallCarrierBranch)) {
    throw new Error('private helper calls no longer require the exact request/context carrier');
  }
}

function analyzerSummaryCarrierVerdict(moduleUnderTest, statements, callArguments) {
  const project = new Project({
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  const sourceFile = project.createSourceFile(
    'opp-carrier.ts',
    `import { query } from '@kovojs/server';
function current(context) { return context.request.guard.userId; }
function opaque(value) { return value; }
export const list = query('list', {
  async load(_input, context) {
    ${statements}
    return current(${callArguments});
  },
});`,
  );
  try {
    const call = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((candidate) => candidate.getExpression().getText() === 'current');
    if (!call) throw new Error('OPP carrier mutation fixture lost its current(...) call');
    return moduleUnderTest.privateScopeHelperCallCarrierIsProven(call);
  } finally {
    sourceFile.forget();
    project.getLanguageService().compilerObject.dispose();
  }
}

async function assertAnalyzerSummarySoleCarrierArgumentIsEnforced(moduleUnderTest) {
  if (!analyzerSummaryCarrierVerdict(moduleUnderTest, '', 'context')) {
    throw new Error('exact sole-carrier OPP fixture was not admitted');
  }
  if (analyzerSummaryCarrierVerdict(moduleUnderTest, '', 'context, 0')) {
    throw new Error('OPP admitted a helper call with an extra argument evaluation channel');
  }
}

async function assertAnalyzerSummaryDirectAliasSnapshotIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryDirectAliasSnapshotBranch)) {
    throw new Error('private helper aliases no longer derive from the direct proved snapshot');
  }
}

function analyzerSummaryAliasScope(moduleUnderTest, aliasDeclarations, helperName) {
  const source = [
    'import { kovoAnalyzerSummary } from "@kovojs/drizzle";',
    'import { query } from "@kovojs/server";',
    'type Context = { request: { guard: { userId: string } } };',
    'function current(context: Context) { return context.request.guard.userId; }',
    'kovoAnalyzerSummary(current, { returns: { kind: "guard", path: "userId" } });',
    aliasDeclarations,
    'export const list = query("list", {',
    '  async load(_input: unknown, context: Context) {',
    `    return ${helperName}(context);`,
    '  },',
    '});',
  ].join('\n');
  const project = new Project({
    compilerOptions: {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  const sourceFile = project.createSourceFile('opp-alias.ts', source);
  try {
    const target = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getExpression().getText() === helperName);
    const load = sourceFile
      .getDescendantsOfKind(SyntaxKind.MethodDeclaration)
      .find((method) => method.getName() === 'load');
    if (!target || !load?.getBody()) {
      throw new Error('OPP alias mutation fixture lost its load/helper call');
    }
    const context = moduleUnderTest.sessionProvenanceContextForNodes(sourceFile, [load.getBody()]);
    const provenance = moduleUnderTest.__summarizedStaticCallablePrivateScope(
      target.getExpression(),
      context,
    );
    return provenance ? `${provenance.kind}:${provenance.path}` : undefined;
  } finally {
    sourceFile.forget();
    project.getLanguageService().compilerObject.dispose();
  }
}

async function assertAnalyzerSummaryOppAliasChainClosureIsEnforced(moduleUnderTest) {
  const direct = analyzerSummaryAliasScope(moduleUnderTest, 'const first = current;', 'first');
  if (direct !== 'guard:userId') {
    throw new Error(`exact one-hop OPP alias was not admitted: ${String(direct)}`);
  }
  const transitive = analyzerSummaryAliasScope(
    moduleUnderTest,
    'const first = current;\nconst second = first;',
    'second',
  );
  if (transitive !== undefined) {
    throw new Error('OPP admitted a two-hop private helper alias chain');
  }
}

async function assertAnalyzerSummaryUnenrolledCarrierClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryUnenrolledCarrierClosureBranch)) {
    throw new Error('private helper calls no longer reject positional/name/type carrier guesses');
  }
}

async function assertAnalyzerSummaryCarrierIntegrityIsEnforced(moduleUnderTest) {
  if (!analyzerSummaryCarrierVerdict(moduleUnderTest, '', 'context')) {
    throw new Error('exact stable OPP carrier fixture was not admitted');
  }
  if (analyzerSummaryCarrierVerdict(moduleUnderTest, 'opaque(context);', 'context')) {
    throw new Error('OPP admitted a carrier after opaque whole-callback escape');
  }
}

async function assertAnalyzerSummaryDirectCarrierIntegrityIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryDirectCarrierIntegrityBranch)) {
    throw new Error('direct private reads no longer share the carrier-integrity proof');
  }
}

async function assertAnalyzerSummaryDestructuredCarrierProofIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryDestructuredCarrierProofBranch)) {
    throw new Error('destructured private aliases no longer require exact carrier-role proof');
  }
}

async function assertAnalyzerSummarySessionAliasCarrierProofIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummarySessionAliasCarrierProofBranch)) {
    throw new Error('session-local recovery no longer requires exact carrier-role proof');
  }
}

async function assertAnalyzerSummaryAcceptedGuardCarrierProofIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryAcceptedGuardCarrierProofBranch)) {
    throw new Error('accepted guard paths no longer require exact carrier-role proof');
  }
}

async function assertAnalyzerSummaryOpaqueCarrierEscapeIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryOpaqueCarrierEscapeBranch)) {
    throw new Error('private carriers no longer close after opaque call escape');
  }
}

async function assertAnalyzerSummaryPrivatePathPrefixIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryPrivatePathPrefixBranch)) {
    throw new Error('private summary paths no longer reject arbitrary carrier prefixes');
  }
}

async function assertAnalyzerSummaryDirectPrivatePathPrefixIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryDirectPrivatePathPrefixBranch)) {
    throw new Error('direct private paths no longer reject carrier-owned input prefixes');
  }
}

async function assertAnalyzerSummaryDestructuringDefaultClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryDestructuringDefaultClosureBranch)) {
    throw new Error('defaulted private destructuring no longer fails closed');
  }
}

async function assertAnalyzerSummaryMutableScalarTransferClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryMutableScalarTransferClosureBranch)) {
    throw new Error('private scalar transfer no longer rejects mutable values');
  }
}

async function assertAnalyzerSummaryFiniteExitGrammarIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryFiniteExitGrammarBranch)) {
    throw new Error('private guard dominance no longer requires an explicit control-flow exit');
  }
}

async function assertAnalyzerSummaryExactAliasIdentityIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryExactAliasIdentityBranch)) {
    throw new Error('private alias consumers no longer require exact lexical symbol identity');
  }
}

async function assertAnalyzerSummaryImmutableBindingIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryImmutableBindingBranch)) {
    throw new Error('private summary helpers no longer require immutable callable identity');
  }
}

async function assertAnalyzerSummaryDirectCallableGrammarIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryDirectCallableGrammarBranch)) {
    throw new Error('private analyzer summaries no longer require a direct callable binding');
  }
}

async function assertAnalyzerSummaryThisCarrierClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryThisCarrierClosureBranch)) {
    throw new Error('private helper calls no longer reject `this` as a context carrier');
  }
}

async function assertAnalyzerSummaryStaticCallCarrierIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryStaticCallCarrierBranch)) {
    throw new Error('a static helper-summary consumer no longer checks its call carrier');
  }
}

async function assertAnalyzerSummaryDirectCallCalleeIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryDirectCallCalleeBranch)) {
    throw new Error('private analyzer-summary calls no longer require a direct callable');
  }
}

async function assertAnalyzerSummaryOwnerValueContainerClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryOwnerValueContainerClosureBranch)) {
    throw new Error('owner provenance no longer rejects mutable local value containers');
  }
}

async function assertAnalyzerSummaryServerValueContainerClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryServerValueContainerClosureBranch)) {
    throw new Error('serverValue provenance no longer rejects mutable local value containers');
  }
}

async function assertAnalyzerSummaryConstValueAliasIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(analyzerSummaryConstValueAliasBranch)) {
    throw new Error('private value provenance no longer requires an immutable local binding');
  }
}

async function assertAnalyzerSummaryValueAliasEscapeClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryValueAliasEscapeClosureBranch)) {
    throw new Error('private value provenance no longer closes after local alias escape');
  }
}

async function assertAnalyzerSummaryConditionalEffectClosureIsPinned(
  _moduleUnderTest,
  { sourceText },
) {
  if (!sourceText.includes(analyzerSummaryConditionalEffectClosureBranch)) {
    throw new Error('private-value conditionals no longer reject authority-changing conditions');
  }
}

async function assertServerValueMissingInputClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(serverValueMissingInputClosureBranch)) {
    throw new Error('serverValue no longer rejects a missing provenance input');
  }
}

async function assertServerValuePositiveProofIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(serverValuePositiveProofBranch)) {
    throw new Error('serverValue no longer requires a positive non-input proof');
  }
}

async function assertOpaqueSymbolCallClosureIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(opaqueSymbolCallClosureBranch)) {
    throw new Error('opaque helper calls no longer close to unknown symbol provenance');
  }
}

async function assertTrustedAssignNestedReviewIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(trustedAssignNestedReviewBranch)) {
    throw new Error('trustedAssign no longer recursively reviews nested expressions');
  }
}

async function assertStaticBuildAuthoritativeProjectIsExecuted(moduleUnderTest) {
  const facts = moduleUnderTest.collectStaticBuildTrustFactsFromProject({
    files: [
      {
        fileName: 'raw-handler.ts',
        source: `element.onclick = () => { document.write(userInput); };`,
      },
    ],
  });
  if (!facts.unregisteredSinks.some((fact) => fact.sink === 'document.write')) {
    throw new Error('static build trust facts bypassed authoritative TASK B analysis');
  }
}

async function assertTaskBJsxNameScannerRetirementIsEnforced(moduleUnderTest) {
  const sinks = moduleUnderTest.collectUnregisteredSinksFromProject({
    files: [
      {
        fileName: 'compiler-owned-handler.tsx',
        source: `export const view = <button onClick={() => { element.innerHTML = userInput; }}>Save</button>;`,
      },
    ],
  });
  if (sinks.some((fact) => fact.sink === 'innerHTML')) {
    throw new Error('TASK B restored the superseded per-name JSX handler traversal');
  }
}

async function assertReviewedCommandCapabilityDoorIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedCommandCapabilityDoorBranch)) {
    throw new Error('finite IR no longer admits the exact runtime-validated command door');
  }
}

async function assertReviewedModuleStorageFactoryIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedModuleStorageFactoryBranch)) {
    throw new Error('finite IR no longer derives exact module-scope storage provenance');
  }
}

async function assertReviewedStorageStatIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedStorageStatBranch)) {
    throw new Error('finite IR no longer classifies storage.stat as a reviewed read');
  }
}

async function assertReviewedTrustedSqlRawDoorIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedTrustedSqlRawDoorBranch)) {
    throw new Error('finite IR no longer admits exact trustedSql(sql.raw(static literal))');
  }
}

async function assertReviewedDeclaredSecretReadDoorIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedDeclaredSecretReadDoorBranch)) {
    throw new Error('finite IR no longer admits the exact declared secret-read capability');
  }
}

async function assertReviewedDeclaredSecretReadExecutionIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedDeclaredSecretReadExecutionBranch)) {
    throw new Error('finite IR no longer admits exact declared secret-read execution');
  }
}

async function assertReviewedTrustedRevealDoorIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedTrustedRevealDoorBranch)) {
    throw new Error('finite IR no longer admits exact audited trustedReveal');
  }
}

async function assertReviewedSecretBoxDoorIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedSecretBoxDoorBranch)) {
    throw new Error('finite IR no longer admits exact framework secret boxing');
  }
}

async function assertReviewedDrizzleAliasDoorIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedDrizzleAliasDoorBranch)) {
    throw new Error('finite IR no longer admits exact Drizzle table aliases');
  }
}

async function assertReviewedInnerJoinContinuationIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedInnerJoinContinuationBranch)) {
    throw new Error('finite IR no longer admits inline managed innerJoin continuations');
  }
}

async function assertReviewedUnionContinuationIsPinned(_moduleUnderTest, { sourceText }) {
  if (!sourceText.includes(reviewedUnionContinuationBranch)) {
    throw new Error('finite IR no longer admits inline managed union continuations');
  }
}

async function assertAuthorizationMatrixDocumentIsClosed(_moduleUnderTest, { sourceText }) {
  const check = authorizationMatrixGate.validateAuthorizationMatrixDocument(JSON.parse(sourceText));
  if (check.ok) return;
  throw new Error(check.findings.join('\n'));
}

function requestIngressClassifier(moduleUnderTest) {
  return moduleUnderTest.createRequestIngressClassifier({
    canonicalClientIp(value) {
      return value === '203.0.113.020' ? '203.0.113.20' : value;
    },
    charCodeAt: (value, index) => value.charCodeAt(index),
    isArray: Array.isArray,
    parseAuthority(authority, scheme) {
      try {
        const parsed = new URL(`${scheme}://${authority}`);
        return {
          hash: parsed.hash,
          host: parsed.host,
          origin: parsed.origin,
          password: parsed.password,
          pathname: parsed.pathname,
          search: parsed.search,
          username: parsed.username,
        };
      } catch {
        return undefined;
      }
    },
    parseTarget(target, base) {
      try {
        const parsed = base === undefined ? new URL(target) : new URL(target, base);
        return {
          hash: parsed.hash,
          host: parsed.host,
          href: parsed.href,
          origin: parsed.origin,
          password: parsed.password,
          pathname: parsed.pathname,
          protocol: parsed.protocol,
          search: parsed.search,
          username: parsed.username,
        };
      } catch {
        return undefined;
      }
    },
  });
}

function requestIngressHttp1(overrides = {}) {
  return {
    encrypted: false,
    forwardedProto: undefined,
    host: 'app.example',
    httpVersion: '1.1',
    method: 'GET',
    pseudoAuthority: undefined,
    pseudoScheme: undefined,
    rawHostHeaderCount: 1,
    rawHostHeaderValue: 'app.example',
    rawTarget: '/',
    source: 'node-http1',
    trustedProxy: false,
    ...overrides,
  };
}

function requestIngressHttp2(overrides = {}) {
  return {
    encrypted: false,
    forwardedProto: undefined,
    host: undefined,
    httpVersion: '2.0',
    method: 'GET',
    pseudoAuthority: 'h2.example',
    pseudoScheme: 'http',
    rawHostHeaderCount: 0,
    rawHostHeaderValue: undefined,
    rawTarget: '/',
    source: 'node-http2',
    trustedProxy: false,
    ...overrides,
  };
}

async function assertRequestIngressMethodIdentityIsClosed(moduleUnderTest) {
  const classifier = requestIngressClassifier(moduleUnderTest);
  if (classifier.classifyMethod('post') || !classifier.classifyMethod('POST')) {
    throw new Error('request-ingress classifier no longer preserves exact POST identity');
  }
}

async function assertRequestIngressDualSchemeAuthorityIsClosed(moduleUnderTest) {
  const classifier = requestIngressClassifier(moduleUnderTest);
  for (const authority of ['app.example:80', 'app.example:443']) {
    const decision = classifier.classify(
      requestIngressHttp1({
        host: authority,
        rawHostHeaderValue: authority,
      }),
    );
    if (decision.ok) {
      throw new Error(
        `request-ingress classifier admitted scheme-relative default port ${authority}`,
      );
    }
  }
}

async function assertRequestIngressRawHostIdentityIsClosed(moduleUnderTest) {
  const decision = requestIngressClassifier(moduleUnderTest).classify(
    requestIngressHttp1({ rawHostHeaderValue: 'evil.example' }),
  );
  if (decision.ok) {
    throw new Error('request-ingress classifier admitted a normalized/raw Host mismatch');
  }
}

async function assertRequestIngressExactSchemeIsClosed(moduleUnderTest) {
  const decision = requestIngressClassifier(moduleUnderTest).classify(
    requestIngressHttp2({ pseudoScheme: 'HTTPS', trustedProxy: true }),
  );
  if (decision.ok) {
    throw new Error('request-ingress classifier admitted uppercase HTTP/2 :scheme');
  }
}

async function assertRequestIngressEncodedTargetIsClosed(moduleUnderTest) {
  const decision = requestIngressClassifier(moduleUnderTest).classify(
    requestIngressHttp1({ rawTarget: '/_m/a/%2f/b' }),
  );
  if (decision.ok) {
    throw new Error('request-ingress classifier admitted an encoded path separator');
  }
}

async function assertRequestIngressH2SourceIsClosed(moduleUnderTest) {
  const decision = requestIngressClassifier(moduleUnderTest).classify(
    requestIngressHttp2({ host: 'h1.example' }),
  );
  if (decision.ok) {
    throw new Error('request-ingress classifier let HTTP/2 borrow ordinary Host');
  }
}

async function assertRequestIngressVercelClientIsClosed(moduleUnderTest) {
  const decision = requestIngressClassifier(moduleUnderTest).classify({
    host: 'app.example',
    httpVersion: '1.1',
    method: 'GET',
    platformClientIp: '203.0.113.020',
    platformScheme: 'https',
    pseudoAuthority: undefined,
    pseudoScheme: undefined,
    rawHostHeaderCount: 1,
    rawHostHeaderValue: 'app.example',
    rawTarget: '/',
    source: 'vercel-node',
  });
  if (decision.ok) {
    throw new Error('request-ingress classifier admitted non-canonical Vercel client provenance');
  }
}

async function assertGeneratedVercelPreparedIngressIsSingle(_moduleUnderTest, { sourceText }) {
  const start = sourceText.indexOf('function vercelFunctionSource(): string {');
  const end = sourceText.indexOf('function vercelIngressMiddlewareSource(): string {', start);
  if (start < 0 || end < 0) throw new Error('generated Vercel function source boundary is absent');
  const vercelSource = sourceText.slice(start, end);
  const matches = vercelSource.match(/prepareVercelRequestIngress\(nodeRequest\)/gu) ?? [];
  if (matches.length !== 1) {
    throw new Error(`generated Vercel dispatch has ${matches.length} prepared-ingress evaluations`);
  }
  if (!vercelSource.includes(preparedVercelIngressBranch)) {
    throw new Error('generated Vercel dispatch no longer routes one prepared verdict to rejection');
  }
}

export function applyExactMutation(sourceText, mutant) {
  const firstIndex = sourceText.indexOf(mutant.search);
  if (firstIndex === -1) {
    throw new Error(`${mutant.name}: mutation target was not found`);
  }
  const secondIndex = sourceText.indexOf(mutant.search, firstIndex + mutant.search.length);
  if (secondIndex !== -1) {
    throw new Error(`${mutant.name}: mutation target is not unique`);
  }
  return (
    sourceText.slice(0, firstIndex) +
    mutant.replacement +
    sourceText.slice(firstIndex + mutant.search.length)
  );
}

async function assertMissingRealBuildProofIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
      proofs: [],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426: security proof-scope enrollment has no real kovo build proof',
    );
  });
}

async function assertSecurityCertificationMarkerIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeUnitCertificationSource(
      repoRoot,
      [
        "it('unit trustedHtml certification', () => {",
        "  expect(diagnostics).toContain('KV426');",
        '});',
        '// @kovo-security-certifies KV426 trusted-html-unit',
      ].join('\n'),
    );
    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: [
        {
          claimExtractor: 'security-certification-markers',
          description: 'unit security proof-scope enrollment declarations',
          file: 'packages/drizzle/src/unit-security.test.ts',
        },
      ],
      proofs: [],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/drizzle/src/unit-security.test.ts KV426/trusted-html-unit: security proof-scope enrollment has no real kovo build proof',
    );
  });
}

async function assertStaleProofRowIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeUnitCertificationSource(
      repoRoot,
      '// @kovo-security-certifies KV426 trusted-html-current\n',
    );
    writeCliBuildProofFile(
      repoRoot,
      [
        "it('build trustedHtml proof', async () => {",
        "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
        "  expect(errorOutput).toContain('KV426');",
        '});',
      ].join('\n'),
    );

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: [
        {
          claimExtractor: 'security-certification-markers',
          description: 'unit security proof-scope enrollment declarations',
          file: 'packages/drizzle/src/unit-security.test.ts',
        },
      ],
      proofs: [
        {
          buildInvocation: 'cli-main-build',
          claimId: 'trusted-html-old',
          code: 'KV426',
          proofFile: 'packages/cli/src/index.kovo-build.test.ts',
          sourceFile: 'packages/drizzle/src/unit-security.test.ts',
          testName: 'build trustedHtml proof',
        },
      ],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/drizzle/src/unit-security.test.ts KV426/trusted-html-old -> packages/cli/src/index.kovo-build.test.ts: proof is stale; source does not enroll KV426/trusted-html-old',
    );
  });
}

async function assertSkippedProofIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
    writeCliBuildProofFile(
      repoRoot,
      [
        "it.skip('skipped trustedHtml proof', async () => {",
        "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
        "  expect(errorOutput).toContain('KV426');",
        '});',
      ].join('\n'),
    );

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
      proofs: [
        {
          buildInvocation: 'cli-main-build',
          code: 'KV426',
          proofFile: 'packages/cli/src/index.kovo-build.test.ts',
          sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
          testName: 'skipped trustedHtml proof',
        },
      ],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof test is skipped or todo',
    );
  });
}

async function assertRequiredProofEvidenceIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV435' }];");
    writeStarterSecurityProofFile(
      repoRoot,
      ["it('starter secret proof', () => {", '  buildProductionArtifact(root);', '});'].join('\n'),
    );
    writeStarterBuildHelper(repoRoot, validStarterBuildHelperSource());

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
      proofs: [
        {
          buildInvocation: 'starter-build-production-artifact',
          code: 'KV435',
          proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
          sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
          testName: 'starter secret proof',
        },
      ],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV435 -> packages/create-kovo/src/index.build.prod-artifact.security.test.ts: proof test is missing required evidence "KV435"',
    );
  });
}

async function assertRequiredProofFileEvidenceIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
    writeCliBuildProofFile(
      repoRoot,
      [
        "it('build trustedHtml sibling proof', async () => {",
        "  const exitCode = await mainAsync(['build', './app.ts', '--out', './dist']);",
        "  expect(errorOutput).toContain('KV426');",
        '});',
      ].join('\n'),
    );

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
      proofs: [
        {
          buildInvocation: 'cli-main-build',
          code: 'KV426',
          proofFile: 'packages/cli/src/index.kovo-build.test.ts',
          requiredProofFileNeedles: ["import * as safeHtml from './safe-html.js';"],
          sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
          testName: 'build trustedHtml sibling proof',
        },
      ],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof file is missing required evidence "import * as safeHtml from \'./safe-html.js\';"',
    );
  });
}

async function assertJsToTsSiblingProofEnrollmentIsPinned(moduleUnderTest) {
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV426' &&
      candidate.proofFile === 'packages/cli/src/index.kovo-build.test.ts' &&
      candidate.testName ===
        'resolves star trustedHtml/trustedUrl barrels and literal element access during production build preflight',
  );
  if (!proof) throw new Error('KV426 star-barrel production build proof is not enrolled');
  const needle = "import * as safeHtml from './safe-html.js';";
  if (!proof.requiredProofFileNeedles?.includes(needle)) {
    throw new Error(
      `KV426 star-barrel proof must require the .js-to-TS sibling resolver needle ${JSON.stringify(
        needle,
      )}`,
    );
  }
}

async function assertKv311IslandDeriveProofEnrollmentIsPinned(moduleUnderTest) {
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV311' &&
      candidate.claimId === 'island-derive-prod-artifact' &&
      candidate.proofFile ===
        'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
  );
  if (!proof) throw new Error('KV311 island-derive production artifact proof is not enrolled');
  const needles = [
    'buildReusableProductionArtifact(root)',
    'assertProdArtifactSinkCensus(root',
    'state.count',
    'state.items[0]',
    'state.extra["computed-key"]',
    'frameworkDataRequestsAfterInteraction',
    'expect(pageErrors).toEqual([])',
    'expect(consoleErrors).toEqual([])',
  ];
  for (const needle of needles) {
    if (!proof.requiredNeedles?.includes(needle)) {
      throw new Error(`KV311 island-derive proof must require ${JSON.stringify(needle)}`);
    }
  }
}

async function assertKv435SafeSiblingProofEnrollmentIsPinned(moduleUnderTest) {
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV435' &&
      candidate.claimId === 'value-flow-sibling-laundering' &&
      candidate.proofFile === 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  );
  if (!proof) throw new Error('KV435 value-flow sibling production build proof is not enrolled');
  const needle = 'addAuthSecretLeakProof(safeRoot, { leakToWire: false })';
  if (!proof.requiredNeedles?.includes(needle)) {
    throw new Error(
      `KV435 value-flow proof must require the safe sibling build needle ${JSON.stringify(needle)}`,
    );
  }
}

async function assertKv426TrustedOutputSafeSiblingProofEnrollmentIsPinned(moduleUnderTest) {
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV426' &&
      candidate.claimId === 'trusted-output-prod-artifact' &&
      candidate.proofFile === 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  );
  if (!proof) throw new Error('KV426 trusted-output production build proof is not enrolled');
  const needle = 'addTrustedOutputProvenanceBuildProof(safeRoot, { unsafe: false })';
  if (!proof.requiredNeedles?.includes(needle)) {
    throw new Error(
      `KV426 trusted-output proof must require the safe sibling build needle ${JSON.stringify(
        needle,
      )}`,
    );
  }
}

async function assertKv426TrustedOutputGeneratedSinkPositionProofEnrollmentIsPinned(
  moduleUnderTest,
  { sourceText } = {},
) {
  if (sourceText && !sourceText.includes(kv426TrustedOutputGeneratedSinkNeedles)) {
    throw new Error('KV426 trusted-output proof must consume the generated SINK-position spread');
  }
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV426' &&
      candidate.claimId === 'trusted-output-prod-artifact' &&
      candidate.proofFile === 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  );
  if (!proof) throw new Error('KV426 trusted-output production build proof is not enrolled');
  for (const needle of moduleUnderTest.trustedOutputSinkPositionProofNeedles()) {
    if (!proof.requiredNeedles?.includes(needle)) {
      throw new Error(
        `KV426 trusted-output proof must require generated SINK-position evidence ${JSON.stringify(
          needle,
        )}`,
      );
    }
  }
}

async function assertGeneratedReadSourceProofEnrollmentIsPinned(
  moduleUnderTest,
  { sourceText } = {},
) {
  if (sourceText && !sourceText.includes(readSourceGeneratedNeedles)) {
    throw new Error('security proof must consume the generated read-SOURCE spread');
  }
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV426' &&
      candidate.claimId === 'trusted-output-prod-artifact' &&
      candidate.proofFile === 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  );
  if (!proof) throw new Error('KV426 trusted-output production build proof is not enrolled');
  for (const needle of moduleUnderTest
    .readSourceFamilyProofNeedles()
    .filter((candidate) => candidate.includes('derived data'))) {
    if (!proof.requiredNeedles?.includes(needle)) {
      throw new Error(
        `security proof must require generated read-SOURCE evidence ${JSON.stringify(needle)}`,
      );
    }
  }
}

async function assertGeneratedWrappingProofEnrollmentIsPinned(
  moduleUnderTest,
  { sourceText } = {},
) {
  if (sourceText && !sourceText.includes(wrappingGeneratedNeedles)) {
    throw new Error('security proof must consume the generated wrapping grammar spread');
  }
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV426' &&
      candidate.claimId === 'trusted-output-prod-artifact' &&
      candidate.proofFile === 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  );
  if (!proof) throw new Error('KV426 trusted-output production build proof is not enrolled');
  for (const needle of moduleUnderTest
    .securityWrappingProofNeedles()
    .filter((candidate) => candidate.includes('derived data'))) {
    if (!proof.requiredNeedles?.includes(needle)) {
      throw new Error(
        `security proof must require generated wrapping evidence ${JSON.stringify(needle)}`,
      );
    }
  }
}

async function assertGeneratedParanoidAcceptanceProofEnrollmentIsPinned(
  moduleUnderTest,
  { sourceText } = {},
) {
  if (sourceText && !sourceText.includes(paranoidAcceptanceGeneratedNeedles)) {
    throw new Error('paranoid proof must consume the generated Phase 5.1 acceptance spread');
  }
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV435' &&
      candidate.claimId === 'phase-5-1-full-paranoid-dogfood-read-acceptance' &&
      candidate.proofFile ===
        'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
  );
  if (!proof) throw new Error('Phase 5.1 paranoid generated runtime proof is not enrolled');
  for (const needle of moduleUnderTest.paranoidGeneratorAcceptanceProofNeedles()) {
    const enrolled =
      proof.requiredNeedles?.includes(needle) || proof.requiredProofFileNeedles?.includes(needle);
    if (!enrolled) {
      throw new Error(
        `paranoid proof must require generated Phase 5.1 acceptance evidence ${JSON.stringify(
          needle,
        )}`,
      );
    }
  }
}

async function assertKv426TrustedUrlAttributeProofEnrollmentIsPinned(moduleUnderTest) {
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV426' &&
      candidate.claimId === 'trusted-url-attribute-type-gate' &&
      candidate.proofFile === 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  );
  if (!proof) throw new Error('KV426 TrustedUrl attribute production build proof is not enrolled');
  const needles = [
    'addTrustedUrlAttributeTypeGateProof(root)',
    'buildProductionArtifact(root)',
    'TrustedUrl',
    'AttributeValue',
  ];
  for (const needle of needles) {
    if (!proof.requiredNeedles?.includes(needle)) {
      throw new Error(`KV426 TrustedUrl attribute proof must require ${JSON.stringify(needle)}`);
    }
  }
}

async function assertKv433StorageDeleteProofEnrollmentIsPinned(moduleUnderTest) {
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV433' &&
      candidate.claimId === 'storage-query-write-prod-artifact' &&
      candidate.proofFile === 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  );
  if (!proof) throw new Error('KV433 storage-query production build proof is not enrolled');
  const needles = [
    'addStorageQueryWriteProof(root)',
    'buildProductionArtifact(root)',
    'operation=put',
    'operation=delete',
    'operation=upload',
  ];
  for (const needle of needles) {
    if (!proof.requiredNeedles?.includes(needle)) {
      throw new Error(`KV433 storage-query proof must require ${JSON.stringify(needle)}`);
    }
  }
}

async function assertKv330WebhookContextTxEscapeProofEnrollmentIsPinned(moduleUnderTest) {
  const proof = moduleUnderTest.SECURITY_BUILD_PROOFS.find(
    (candidate) =>
      candidate.code === 'KV330' &&
      candidate.claimId === 'webhook-context-tx-raw-driver-escape-prod-artifact' &&
      candidate.proofFile ===
        'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
  );
  if (!proof)
    throw new Error('KV330 webhook context.tx escape production build proof is not enrolled');
  const needles = [
    'addRuntimeMutationSafetyProofs(root, { includeWebhookTxEscapeAttempt: true })',
    'captureProductionBuildFailure(() => buildProductionArtifact(root))',
    'KV330',
    'Direct db access in a webhook handler',
    'runtime-safety-proofs.ts',
  ];
  for (const needle of needles) {
    if (!proof.requiredNeedles?.includes(needle)) {
      throw new Error(
        `KV330 webhook context.tx escape proof must require ${JSON.stringify(needle)}`,
      );
    }
  }
}

async function assertTrustedHtmlProvenanceKeepsCallResultFailClosed(
  _moduleUnderTest,
  { sourceText },
) {
  const needle = "return firstProvenance([argumentProvenance, calleeProvenance]) ?? 'unprovable';";
  if (!sourceText.includes(needle)) {
    throw new Error(`KV426 value-flow must keep call/new results fail-closed via ${needle}`);
  }
}

async function assertFixtureOnlyProofIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV426' }];");
    writeCliBuildProofFile(
      repoRoot,
      [
        "import { compileComponentModule } from '../packages/compiler/src/index.js';",
        "it('fixture-only trustedHtml proof', () => {",
        "  const result = compileComponentModule({ fileName: 'x.tsx', source: '' });",
        "  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV426');",
        '});',
      ].join('\n'),
    );

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
      proofs: [
        {
          buildInvocation: 'cli-main-build',
          code: 'KV426',
          proofFile: 'packages/cli/src/index.kovo-build.test.ts',
          sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
          testName: 'fixture-only trustedHtml proof',
        },
      ],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts KV426 -> packages/cli/src/index.kovo-build.test.ts: proof test does not exercise the declared production build path (cli-main-build)',
    );
  });
}

async function assertStarterHelperEvidenceIsCaught(moduleUnderTest) {
  withTempRepo((repoRoot) => {
    writeFixtureSource(repoRoot, "export const seeds = [{ code: 'KV435' }];");
    writeStarterSecurityProofFile(
      repoRoot,
      [
        "it('starter secret proof', () => {",
        '  buildProductionArtifact(root);',
        "  expect(output).toContain('KV435');",
        '});',
      ].join('\n'),
    );
    writeStarterBuildHelper(repoRoot, 'export function buildProductionArtifact() {}\n');

    const violations = moduleUnderTest.securityTestBuildGateViolations({
      certificationSources: moduleUnderTest.SECURITY_BUILD_CERTIFICATION_SOURCES,
      proofs: [
        {
          buildInvocation: 'starter-build-production-artifact',
          code: 'KV435',
          proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
          sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
          testName: 'starter secret proof',
        },
      ],
      repoRoot,
    });
    assertIncludes(
      violations,
      'packages/create-kovo/src/index.build.test-support.ts: starter-build-production-artifact helper is missing required build evidence "execFileSync"',
    );
  });
}

async function assertSqlGuardEnvDowngradeIsCaught(moduleUnderTest) {
  const findings = moduleUnderTest.sqlGuardDowngradeFindings(
    'packages/server/src/sql-safe-handle.ts',
    'export const mode = process.env.KOVO_SQL_GUARD;',
  );
  assertIncludes(
    findings,
    'packages/server/src/sql-safe-handle.ts: SQL safety must remain default-deny; remove SQL guard downgrade path (KOVO_SQL_GUARD env knob)',
  );
}

async function assertManagedDbThrowInvariantIsCaught(moduleUnderTest) {
  const findings = moduleUnderTest.sqlSafetyInvariantFindings(
    'packages/server/src/sql-safe-handle.ts',
    `
      function assertManagedSqlStatement(statement: unknown): void {
        const validation = validateManagedSqlStatement(statement);
        if (validation.ok) return;
        console.warn(validation.message);
      }
    `,
  );
  assertIncludes(
    findings,
    'packages/server/src/sql-safe-handle.ts: managed DB handle must throw on failed SQL validation',
  );
}

async function assertManagedRawDriverEscapeDenialPrecedesNestedWrapping(
  _moduleUnderTest,
  { sourceText },
) {
  const denial = sourceText.indexOf(
    'if (writePolicy !== undefined && isManagedRawDriverEscapeProperty(prop))',
  );
  if (denial === -1) {
    throw new Error('managed raw-driver escape denial branch is missing');
  }
  const firstReflectGet = sourceText.indexOf('witnessReflectGet(target, prop, receiver)');
  const nestedWrap = sourceText.indexOf('isNestedSqlHandleProperty(prop)');
  if (firstReflectGet === -1 || nestedWrap === -1) {
    throw new Error('managed SQL handle wrapping landmarks are missing');
  }
  if (denial > firstReflectGet || denial > nestedWrap) {
    throw new Error('managed raw-driver escape denial must run before Reflect.get/nested wrapping');
  }
}

async function assertResponseFragmentTrustedHtmlRouteCountIsCaught(moduleUnderTest) {
  const findings = moduleUnderTest.responseFragmentApplyInvariantFindings(
    'response-fragment-apply.ts',
    `
      export function p(fs, f, security, createHTML: (html: string) => string) {
        for (const x of fs) {
          const e = f(x.target);
          const content = security.createFragmentContent(
            createHTML(renderedFragmentHtmlContent(x.html)),
          );
          for (const n of content.children) g(n);
          e.append(...content.childNodes);
        }
      }
      function d(e, h) {
        const t = document.createElement('template');
        t.innerHTML = h;
        const n = firstMorphElement(t.content);
        if (n) m(e, g(n));
      }
      function r(n: string): boolean {
        return /^on[^:]|^(srcdoc|dangerouslysetinnerhtml|innerhtml|outerhtml|inserthtml|insertadjacenthtml)$/.test(n);
      }
    `,
  );
  assertIncludes(
    findings,
    'response-fragment-apply.ts: response-fragment HTML sink must route exactly two membrane parse inputs through the injected createHTML control; found 1',
  );
}

async function assertQueryWireHtmlBodyEscapingIsCaught(_moduleUnderTest, { sourceText } = {}) {
  const findings = sinkPolicyGate.queryWireHtmlInvariantFindings('wire-html.ts', sourceText ?? '');
  if (findings.includes('wire-html.ts: /_q query wire body must HTML-escape serialized values')) {
    throw new Error('/_q query wire body escaping invariant was removed');
  }
}

async function assertBetterAuthCredentialResultIdentityIsPinned(
  _moduleUnderTest,
  { sourceText } = {},
) {
  if (!sourceText?.includes(betterAuthCredentialResultIdentityBranch)) {
    throw new Error(
      'Better Auth credential results no longer require exact same-consumer registry identity',
    );
  }
}

async function assertBetterAuthCredentialSourceIsPinned(_moduleUnderTest, { sourceText } = {}) {
  if (!sourceText?.includes(betterAuthCredentialSourceIdentityBranch)) {
    throw new Error(
      'Better Auth raw callables no longer require the exact consumer/source contract',
    );
  }
}

async function assertM5ForbiddenStatusIsCaught(moduleUnderTest) {
  const { manifest, planText } = loadDefaultCensusFixture();
  manifest.rows[0].status = 'future';
  const violations = moduleUnderTest.evaluateFundamentalFixesCensus({
    manifest,
    planText,
  }).violations;
  assertIncludes(violations, `${manifest.rows[0].id}: M5 forbids status "future"`);
}

async function assertClosedRowM1EvidenceIsCaught(moduleUnderTest) {
  const { manifest, planText } = loadDefaultCensusFixture();
  manifest.rows[0] = {
    ...manifest.rows[0],
    evidence: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    m1: undefined,
    status: 'closed',
  };
  const violations = moduleUnderTest.evaluateFundamentalFixesCensus({
    manifest,
    planText,
  }).violations;
  assertIncludes(
    violations,
    `${manifest.rows[0].id}: closed row is missing M1 adversarial evidence`,
  );
}

async function assertDialectMatrixRequirementIsCaught(moduleUnderTest) {
  const { manifest, planText } = loadDefaultCensusFixture();
  manifest.rows = manifest.rows.filter((row) => row.id !== 'dialect-pglite-execute');
  const violations = moduleUnderTest.evaluateFundamentalFixesCensus({
    manifest,
    planText,
  }).violations;
  assertIncludes(
    violations,
    'scripts/fundamental-fixes-census.manifest.json: missing dialect x sink matrix row pglite/execute',
  );
}

async function assertResolverExpressionKindDenominatorIsTypeScriptDerived(moduleUnderTest) {
  const requiredKinds = moduleUnderTest.REQUIRED_RESOLVER_EXPRESSION_KINDS;
  if (!Array.isArray(requiredKinds)) {
    throw new Error('resolver expression-kind denominator is not an array');
  }

  for (const kind of ['Identifier', 'CallExpression', 'AwaitExpression', 'YieldExpression']) {
    if (!requiredKinds.includes(kind)) {
      throw new Error(`resolver expression-kind denominator is missing TypeScript kind ${kind}`);
    }
  }
  if (!requiredKinds.includes('default')) {
    throw new Error('resolver expression-kind denominator is missing default fallback kind');
  }
  if (
    requiredKinds.length !== fundamentalFixesCensusGate.REQUIRED_RESOLVER_EXPRESSION_KINDS.length
  ) {
    throw new Error(
      `resolver expression-kind denominator drifted from ${fundamentalFixesCensusGate.REQUIRED_RESOLVER_EXPRESSION_KINDS.length} to ${requiredKinds.length}`,
    );
  }
}

async function assertResolverStatusRequirementIsCaught(moduleUnderTest) {
  const { manifest, planText } = loadDefaultCensusFixture();
  const row = firstResolverExpressionKindRow(manifest);
  delete row.resolverStatus;
  const violations = moduleUnderTest.evaluateFundamentalFixesCensus({
    manifest,
    planText,
  }).violations;
  assertIncludes(violations, `${row.id}: resolverStatus must be one of resolved, fails-closed`);
}

async function assertResolverCoverageExpectationRequirementIsCaught(moduleUnderTest) {
  const { manifest, planText } = loadDefaultCensusFixture();
  const row = firstResolverExpressionKindRow(manifest);
  row.coverageExpectation = 'todo';
  const violations = moduleUnderTest.evaluateFundamentalFixesCensus({
    manifest,
    planText,
  }).violations;
  assertIncludes(violations, `${row.id}: resolver row is missing coverageExpectation`);
}

async function assertUnknownResolverExpressionKindIsCaught(moduleUnderTest) {
  const { manifest, planText } = loadDefaultCensusFixture();
  const row = firstResolverExpressionKindRow(manifest);
  row.expressionKind = 'DefinitelyNotATypeScriptExpressionKind';
  const violations = moduleUnderTest.evaluateFundamentalFixesCensus({
    manifest,
    planText,
  }).violations;
  assertIncludes(
    violations,
    `${row.id}: unknown resolver expressionKind DefinitelyNotATypeScriptExpressionKind`,
  );
}

async function assertCoreResolverSourceKeepsElementAccess(_moduleUnderTest, { sourceText } = {}) {
  if (!sourceText?.includes(coreElementAccessResolverBranch)) {
    throw new Error('core resolver no longer classifies ElementAccessExpression as resolved');
  }
  if (!sourceText.includes(coreElementAccessCanonicalBranch)) {
    throw new Error(
      'core resolver no longer routes literal ElementAccessExpression through namespace member identity',
    );
  }
}

async function assertCoreResolverSourceKeepsExportStar(_moduleUnderTest, { sourceText } = {}) {
  if (!sourceText?.includes(coreExportStarResolverBranch)) {
    throw new Error('core resolver no longer traverses export * barrels');
  }
}

async function assertCompilerSourceKeepsSiblingRegistration(_moduleUnderTest, { sourceText } = {}) {
  if (!sourceText?.includes(compileSiblingRegistrationBranch)) {
    throw new Error('compileComponentModule no longer registers extraFiles with the resolver');
  }
}

async function assertViteSourceKeepsJsToTsSiblingCandidates(_moduleUnderTest, { sourceText } = {}) {
  if (!sourceText?.includes(viteJsToTsSiblingCandidatesBranch)) {
    throw new Error('Vite sibling discovery no longer maps .js specifiers to .ts/.tsx candidates');
  }
}

async function assertFrameworkEgressSourceKeepsPositiveCapability(
  _moduleUnderTest,
  { sourceText } = {},
) {
  const fetchStart = sourceText?.indexOf('export const frameworkEgressFetch') ?? -1;
  const dispatcherPin = sourceText?.indexOf(frameworkEgressDispatcherPin, fetchStart) ?? -1;
  const originCheck = sourceText?.indexOf(frameworkEgressOriginCheck, fetchStart) ?? -1;
  const dnsLookup = sourceText?.indexOf('lookupAllAddresses(host)', fetchStart) ?? -1;
  if (
    fetchStart < 0 ||
    dispatcherPin < fetchStart ||
    originCheck < dispatcherPin ||
    dnsLookup < originCheck
  ) {
    throw new Error(
      'framework egress no longer pins its dispatcher and rejects undeclared origins before DNS',
    );
  }
}

async function assertTaskEgressContextKeepsCapabilitySeal(_moduleUnderTest, { sourceText } = {}) {
  if (!sourceText?.includes(taskEgressCapabilitySeal)) {
    throw new Error('durable-task ctx.fetch is no longer an exact non-replaceable own property');
  }
}

async function assertWebhookEgressContextKeepsCapabilitySeal(
  _moduleUnderTest,
  { sourceText } = {},
) {
  if (!sourceText?.includes(webhookEgressCapabilitySeal)) {
    throw new Error('webhook ctx.fetch is no longer an exact non-replaceable own property');
  }
}

function firstResolverExpressionKindRow(manifest) {
  const row = manifest.rows.find((candidate) => candidate.kind === 'resolver-expression-kind');
  if (!row) throw new Error('default census fixture has no resolver expression-kind rows');
  return row;
}

function loadDefaultCensusFixture() {
  return {
    manifest: JSON.parse(readFileSync(fundamentalFixesCensusManifestPath, 'utf8')),
    planText: readFileSync(fundamentalFixesFollowupPlanPath, 'utf8'),
  };
}

function assertIncludes(values, expected) {
  if (values.includes(expected)) return;
  throw new Error(`expected ${JSON.stringify(values)} to include ${JSON.stringify(expected)}`);
}

function withTempRepo(callback) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'kovo-security-gate-mutation-repo-'));
  try {
    callback(repoRoot);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
}

function writeFixtureSource(repoRoot, source) {
  writeFile(
    repoRoot,
    'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    source,
  );
}

function writeCliBuildProofFile(repoRoot, source) {
  writeFile(repoRoot, 'packages/cli/src/index.kovo-build.test.ts', source);
}

function writeUnitCertificationSource(repoRoot, source) {
  writeFile(repoRoot, 'packages/drizzle/src/unit-security.test.ts', source);
}

function writeStarterSecurityProofFile(repoRoot, source) {
  writeFile(
    repoRoot,
    'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    source,
  );
}

function writeStarterBuildHelper(repoRoot, source) {
  writeFile(repoRoot, 'packages/create-kovo/src/index.build.test-support.ts', source);
}

function validStarterBuildHelperSource() {
  return [
    "import { execFileSync } from 'node:child_process';",
    'export function buildProductionArtifact(root) {',
    "  return execFileSync('kovo', ['build', './src/app.tsx', '--no-cache'], { cwd: root });",
    '}',
  ].join('\n');
}

function writeFile(repoRoot, relativePath, source) {
  const fullPath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, source, 'utf8');
}

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main() {
  const results = await runSecurityGateMutationHarness();
  const failed = results.filter((result) => result.status !== 'killed');

  if (failed.length > 0) {
    process.stderr.write('Security gate mutation harness failed:\n');
    for (const result of failed) {
      process.stderr.write(`  - ${result.name}: ${result.status}; ${result.error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Security gate mutation harness passed (${results.length} mutants killed).\n`,
  );
  for (const result of results) {
    process.stdout.write(`  - ${result.name}: killed ${result.expectedKiller}\n`);
  }
}

if (isMainEntry(import.meta.url)) await runGate(main);
