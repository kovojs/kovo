#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import * as authorizationMatrixGate from './check-authorization-matrix.mjs';
import * as sinkPolicyGate from './check-sink-policy-gate.mjs';
import * as fundamentalFixesCensusGate from './fundamental-fixes-census-gate.mjs';
import * as securityTestBuildGate from './security-test-build-gate.mjs';
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

export const SECURITY_GATE_MUTANTS = [
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
      await mutant.test(mutant.baseModule, { sourceText });
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
