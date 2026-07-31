#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  authenticatedPackedJourneyPackages,
  packageSetIdentity,
} from './golden-journey/packed-package-auth.mjs';
import { isEd25519Spki, verifyEd25519Spki } from './kovo-certificate-signature.mjs';
import { validateKnownFailureRegister } from './known-failure-register.mjs';
import { readBoundedRegularFile } from './lib/bounded-regular-file.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  ensureNonSymlinkDescendantDirectory,
  nonSymlinkDescendant,
} from './lib/non-symlink-path.mjs';
import { packedManifestMaxBytes, repoRoot as defaultRepoRoot } from './release-packages.mjs';

export const EXTERNAL_EVALUATOR_POLICY_SCHEMA = 'kovo.devex/external-evaluator-policy/v1';
export const EXTERNAL_EVALUATOR_EVIDENCE_SCHEMA = 'kovo.devex/external-evaluator-evidence/v1';
export const EXTERNAL_EVALUATOR_TRANSCRIPT_SCHEMA = 'kovo.devex/external-evaluator-transcript/v1';
export const EXTERNAL_EVALUATOR_ARTIFACT_SUBJECT_SCHEMA =
  'kovo.devex/external-evaluator-artifact-subject/v1';
export const EXTERNAL_EVALUATOR_REQUIRED_COUNT = 3;
export const EXTERNAL_EVALUATOR_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

const POLICY_PATH = 'evidence/devex/external-evaluators/policy.json';
const EVIDENCE_PATH = '.release/devex/external-evaluators/transcripts.json';
const PACKED_MANIFEST_PATH = '.release/packed-packages.json';
const KNOWN_FAILURE_REGISTER_PATH = 'scripts/known-failure-register.json';
const MAX_POLICY_BYTES = 512 * 1024;
const MAX_EVIDENCE_BYTES = 32 * 1024;
const MAX_ENCODED_EVIDENCE_CODE_UNITS = 48 * 1024;
const MAX_REGISTER_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const EVALUATOR_KINDS = new Set(['agent', 'human']);
const FINDING_SEVERITIES = new Set(['blocking', 'major', 'minor', 'note']);
const PLACEHOLDER = /\b(?:placeholder|replace[-_ ]?me|tbd|todo|unknown)\b/iu;

export const EXTERNAL_EVALUATOR_JOURNEY_STEPS = Object.freeze([
  Object.freeze({ id: 'scaffold', outcome: 'created', exitCode: 0 }),
  Object.freeze({ id: 'install', outcome: 'installed', exitCode: 0 }),
  Object.freeze({ id: 'dev-ready', outcome: 'ready', exitCode: null }),
  Object.freeze({ id: 'first-200', outcome: 'http-200', exitCode: 0 }),
  Object.freeze({ id: 'login', outcome: 'authenticated', exitCode: null }),
  Object.freeze({ id: 'crud', outcome: 'create-read-update-delete', exitCode: null }),
  Object.freeze({ id: 'edit', outcome: 'source-edited', exitCode: null }),
  Object.freeze({ id: 'check-failing', outcome: 'expected-diagnostic', exitCode: 1 }),
  Object.freeze({ id: 'fix', outcome: 'diagnostic-fixed', exitCode: null }),
  Object.freeze({ id: 'check-passing', outcome: 'passed', exitCode: 0 }),
  Object.freeze({ id: 'test', outcome: 'passed', exitCode: 0 }),
  Object.freeze({ id: 'build', outcome: 'passed', exitCode: 0 }),
]);

export const EXTERNAL_EVALUATOR_CONTRACT = Object.freeze({
  schema: 'kovo.devex/external-evaluator-contract/v1',
  requiredEvaluators: EXTERNAL_EVALUATOR_REQUIRED_COUNT,
  maxEvidenceAgeMs: EXTERNAL_EVALUATOR_MAX_AGE_MS,
  artifactBinding: Object.freeze([
    'sourceCommit',
    'packedManifestSha256',
    'packageSetSha256',
    'packageSet',
  ]),
  independence: Object.freeze([
    'nonAuthor',
    'noFrameworkImplementationContribution',
    'noJourneyHarnessContribution',
    'noFrameworkAuthorInterventionDuringJourney',
  ]),
  journeySteps: EXTERNAL_EVALUATOR_JOURNEY_STEPS,
  signature: Object.freeze({
    algorithm: 'ed25519',
    payload: 'canonical transcript JSON excluding signature',
  }),
});

export const EXTERNAL_EVALUATOR_CONTRACT_DIGEST = sha256(
  canonicalJson(EXTERNAL_EVALUATOR_CONTRACT),
);

/**
 * Construct the artifact identity shared by all three evaluator transcripts. The manifest and
 * tarball bytes are authenticated separately before this is called; a type or caller-supplied
 * digest is not authority (SPEC §2 and §6.6).
 */
export function buildExternalEvaluatorArtifactSubject({
  packageSet,
  packedManifestSha256,
  sourceCommit,
}) {
  return Object.freeze({
    schema: EXTERNAL_EVALUATOR_ARTIFACT_SUBJECT_SCHEMA,
    sourceCommit,
    packedManifestSha256,
    packageSetSha256: sha256(canonicalJson(packageSet)),
    packageSet: structuredClone(packageSet),
  });
}

export function externalEvaluatorArtifactSubjectDigest(subject) {
  return sha256(canonicalJson(subject));
}

export function externalEvaluatorPublicKeyFingerprint(publicKeySpki) {
  const bytes = canonicalBase64(publicKeySpki, 'evaluator public key');
  return sha256(bytes);
}

/**
 * Evaluators sign the complete exact transcript except for the signature record itself. The
 * returned bytes are stable across object insertion order and are safe to pass to Ed25519.
 */
export function externalEvaluatorTranscriptPayload(transcript) {
  if (transcript === null || typeof transcript !== 'object' || Array.isArray(transcript)) {
    throw new TypeError('external evaluator transcript must be an object');
  }
  const { signature: _signature, ...payload } = transcript;
  return Buffer.from(canonicalJson(payload));
}

/**
 * Decode the release-dispatch evidence input before writing it under `.release`. GitHub workflow
 * inputs have a bounded aggregate size, so both the transport string and decoded JSON are capped.
 */
export function decodeExternalEvaluatorEvidenceInput(encoded) {
  if (
    typeof encoded !== 'string' ||
    encoded.length === 0 ||
    encoded.length > MAX_ENCODED_EVIDENCE_CODE_UNITS ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
  ) {
    throw new TypeError(
      `external evaluator evidence input must be canonical base64 no longer than ${String(MAX_ENCODED_EVIDENCE_CODE_UNITS)} code units`,
    );
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_EVIDENCE_BYTES ||
    bytes.toString('base64') !== encoded
  ) {
    throw new TypeError(
      `external evaluator evidence input must decode canonically to 1 through ${String(MAX_EVIDENCE_BYTES)} bytes`,
    );
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError(`external evaluator evidence input must be valid UTF-8: ${error.message}`);
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`external evaluator evidence input must be JSON: ${error.message}`);
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('external evaluator evidence input must be a JSON object');
  }
  return bytes;
}

export function validateExternalEvaluatorEvidence({
  actualSubject,
  evidence,
  history,
  knownFailures,
  now = Date.now(),
  policy,
}) {
  const findings = [];
  if (!Number.isFinite(now)) findings.push('verification clock must be finite');

  validateArtifactSubject(actualSubject, 'actualSubject', findings);
  const subjectDigest = safeSubjectDigest(actualSubject, findings);
  const policyEvaluators = validatePolicy(policy, findings);
  validateHistory(history, actualSubject, findings);

  if (
    !exactKeys(evidence, [
      'artifactSubjectSha256',
      'contractDigest',
      'pass',
      'requiredEvaluators',
      'schema',
      'subject',
      'transcripts',
    ]) ||
    evidence?.schema !== EXTERNAL_EVALUATOR_EVIDENCE_SCHEMA
  ) {
    findings.push(`evidence must be an exact ${EXTERNAL_EVALUATOR_EVIDENCE_SCHEMA} record`);
    return findings;
  }
  if (evidence.contractDigest !== EXTERNAL_EVALUATOR_CONTRACT_DIGEST) {
    findings.push('evidence.contractDigest must bind the code-owned evaluator contract');
  }
  validateArtifactSubject(evidence.subject, 'evidence.subject', findings);
  if (!sameJson(evidence.subject, actualSubject)) {
    findings.push('evidence.subject does not match the current authenticated release HEAD');
  }
  if (
    evidence.artifactSubjectSha256 !== subjectDigest ||
    evidence.artifactSubjectSha256 !== safeSubjectDigest(evidence.subject, findings)
  ) {
    findings.push('evidence mixes or stales the authenticated packed artifact subject');
  }
  if (
    evidence.requiredEvaluators !== EXTERNAL_EVALUATOR_REQUIRED_COUNT ||
    !Array.isArray(evidence.transcripts) ||
    evidence.transcripts.length !== EXTERNAL_EVALUATOR_REQUIRED_COUNT
  ) {
    findings.push(
      `evidence must contain exactly N=${String(EXTERNAL_EVALUATOR_REQUIRED_COUNT)} transcripts`,
    );
  }
  const transcriptIds = new Set();
  const transcriptPrincipals = new Set();
  const transcriptFingerprints = new Set();
  const transcriptPasses = [];
  const transcripts = Array.isArray(evidence.transcripts) ? evidence.transcripts : [];
  for (const [index, transcript] of transcripts.entries()) {
    const label = `evidence.transcripts[${String(index)}]`;
    const evaluator = policyEvaluators.get(transcript?.evaluatorId);
    if (evaluator === undefined) {
      findings.push(`${label}.evaluatorId is absent from the preregistered evaluator roster`);
    } else {
      if (transcriptIds.has(evaluator.id)) {
        findings.push(`${label} repeats evaluator identity ${evaluator.id}`);
      }
      transcriptIds.add(evaluator.id);
      const principal = evaluator.identity?.principal;
      if (transcriptPrincipals.has(principal)) {
        findings.push(`${label} repeats evaluator principal ${String(principal)}`);
      }
      transcriptPrincipals.add(principal);
      const fingerprint = evaluator.publicKey?.fingerprint;
      if (transcriptFingerprints.has(fingerprint)) {
        findings.push(`${label} repeats an evaluator signing key`);
      }
      transcriptFingerprints.add(fingerprint);
    }
    transcriptPasses.push(
      validateTranscript(transcript, {
        evaluator,
        findings,
        knownFailures,
        label,
        now,
        policyRegisteredAt: policy?.registeredAt,
        subjectDigest,
      }),
    );
  }
  if (
    transcriptIds.size !== EXTERNAL_EVALUATOR_REQUIRED_COUNT ||
    transcriptPrincipals.size !== EXTERNAL_EVALUATOR_REQUIRED_COUNT ||
    transcriptFingerprints.size !== EXTERNAL_EVALUATOR_REQUIRED_COUNT
  ) {
    findings.push(
      'evidence must contain three distinct evaluator identities, principals, and keys',
    );
  }
  const expectedPass =
    transcriptPasses.length === EXTERNAL_EVALUATOR_REQUIRED_COUNT &&
    transcriptPasses.every((pass) => pass === true);
  if (evidence.pass !== expectedPass) {
    findings.push('evidence.pass must equal the signed transcript outcomes');
  }
  if (evidence.pass !== true) {
    findings.push('external evaluator evidence is release-blocking until every transcript passes');
  }
  return findings;
}

export function verifyExternalEvaluatorEvidence(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  if (repoRoot !== path.resolve(defaultRepoRoot)) {
    throw new Error('external evaluator release verification must run in the Kovo repository');
  }
  const evidencePath = options.evidencePath ?? EVIDENCE_PATH;
  if (options.encodedEvidence !== undefined) {
    materializeExternalEvaluatorEvidenceInput({
      encoded: options.encodedEvidence,
      evidencePath,
      repoRoot,
    });
  }
  const paths = {
    evidence: repositoryFile(repoRoot, evidencePath, 'evidence bundle'),
    knownFailures: repositoryFile(
      repoRoot,
      options.knownFailuresPath ?? KNOWN_FAILURE_REGISTER_PATH,
      'known-failure register',
    ),
    packedManifest: repositoryFile(
      repoRoot,
      options.packedManifestPath ?? PACKED_MANIFEST_PATH,
      'packed release manifest',
    ),
    policy: repositoryFile(repoRoot, options.policyPath ?? POLICY_PATH, 'evaluator policy'),
  };
  const relativePaths = Object.fromEntries(
    Object.entries(paths).map(([name, absolute]) => [
      name,
      path.relative(repoRoot, absolute).split(path.sep).join('/'),
    ]),
  );
  const policyBytes = readBoundedJsonBytes(paths.policy, MAX_POLICY_BYTES, 'evaluator policy');
  const evidenceBytes = readBoundedJsonBytes(paths.evidence, MAX_EVIDENCE_BYTES, 'evidence bundle');
  const knownFailureBytes = readBoundedJsonBytes(
    paths.knownFailures,
    MAX_REGISTER_BYTES,
    'known-failure register',
  );
  const policy = JSON.parse(policyBytes);
  const evidence = JSON.parse(evidenceBytes);
  const knownFailureRegister = JSON.parse(knownFailureBytes);

  const registerFindings = validateKnownFailureRegister(knownFailureRegister, { repoRoot });
  if (registerFindings.length > 0) {
    throw new Error(
      `external evaluator evidence requires a valid known-failure register:\n- ${registerFindings.join('\n- ')}`,
    );
  }
  const preregistrationHistory = collectEvidenceHistory({
    policyBytes,
    policyPath: relativePaths.policy,
    repoRoot,
  });

  // This authenticates current HEAD's source-derived package manifests plus every final tarball
  // byte before any evaluator claim is considered (SPEC §1.3 and §5.2).
  const packedManifestBytes = readBoundedRegularFile(
    paths.packedManifest,
    packedManifestMaxBytes,
    'packed release manifest',
  );
  const packedPackages = authenticatedPackedJourneyPackages(paths.packedManifest);
  const packedManifestAfterAuthentication = readBoundedRegularFile(
    paths.packedManifest,
    packedManifestMaxBytes,
    'packed release manifest',
  );
  if (!packedManifestBytes.equals(packedManifestAfterAuthentication)) {
    throw new Error('packed release manifest changed while evaluator evidence was authenticated');
  }
  const actualSubject = buildExternalEvaluatorArtifactSubject({
    packageSet: packageSetIdentity(packedPackages),
    packedManifestSha256: sha256(packedManifestBytes),
    sourceCommit: preregistrationHistory.currentCommit,
  });
  const history = Object.freeze({
    ...preregistrationHistory,
    currentPackedManifestAuthenticated: true,
  });
  const knownFailures = new Map(knownFailureRegister.entries.map((entry) => [entry.id, entry]));
  const findings = validateExternalEvaluatorEvidence({
    actualSubject,
    evidence,
    history,
    knownFailures,
    now: options.now ?? Date.now(),
    policy,
  });
  if (findings.length > 0) {
    throw new Error(`external evaluator evidence failed closed:\n- ${findings.join('\n- ')}`);
  }
  return Object.freeze({
    artifactSubjectSha256: externalEvaluatorArtifactSubjectDigest(actualSubject),
    evaluatedSourceCommit: actualSubject.sourceCommit,
    packedManifestSha256: actualSubject.packedManifestSha256,
    releaseCommit: history.currentCommit,
    transcriptCount: evidence.transcripts.length,
  });
}

export function parseExternalEvaluatorEvidenceArgs(argv) {
  const options = {};
  const flags = new Map([
    ['--evidence', 'evidencePath'],
    ['--known-failures', 'knownFailuresPath'],
    ['--packed-manifest', 'packedManifestPath'],
    ['--policy', 'policyPath'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const field = flags.get(argv[index]);
    if (field === undefined) {
      throw new Error(
        `unknown external evaluator evidence argument ${JSON.stringify(argv[index])}`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new Error(`${argv[index]} requires a canonical repository-relative path`);
    }
    if (Object.hasOwn(options, field)) throw new Error(`${argv[index]} may appear only once`);
    options[field] = value;
    index += 1;
  }
  return Object.freeze(options);
}

export function runExternalEvaluatorEvidence(argv = process.argv.slice(2)) {
  const result = verifyExternalEvaluatorEvidence({
    ...parseExternalEvaluatorEvidenceArgs(argv),
    encodedEvidence: process.env.KOVO_EXTERNAL_EVALUATOR_EVIDENCE_BASE64,
  });
  process.stdout.write(
    `PASS external-evaluator-evidence N=${String(result.transcriptCount)} source=${result.evaluatedSourceCommit} release=${result.releaseCommit} manifest=${result.packedManifestSha256}\n`,
  );
}

function validatePolicy(policy, findings) {
  const evaluators = new Map();
  if (
    !exactKeys(policy, [
      'contractDigest',
      'evaluators',
      'registeredAt',
      'registeredBy',
      'requiredEvaluators',
      'schema',
    ]) ||
    policy?.schema !== EXTERNAL_EVALUATOR_POLICY_SCHEMA
  ) {
    findings.push(`policy must be an exact ${EXTERNAL_EVALUATOR_POLICY_SCHEMA} record`);
    return evaluators;
  }
  if (policy.contractDigest !== EXTERNAL_EVALUATOR_CONTRACT_DIGEST) {
    findings.push('policy.contractDigest must bind the code-owned evaluator contract');
  }
  if (
    policy.requiredEvaluators !== EXTERNAL_EVALUATOR_REQUIRED_COUNT ||
    !Array.isArray(policy.evaluators) ||
    policy.evaluators.length !== EXTERNAL_EVALUATOR_REQUIRED_COUNT
  ) {
    findings.push(
      `policy must preregister exactly N=${String(EXTERNAL_EVALUATOR_REQUIRED_COUNT)} evaluators`,
    );
  }
  if (!validUtcTimestamp(policy.registeredAt)) {
    findings.push('policy.registeredAt must be a canonical UTC timestamp');
  }
  if (
    !exactKeys(policy.registeredBy, ['id', 'role']) ||
    !substantive(policy.registeredBy?.id, 3, 128) ||
    policy.registeredBy?.role !== 'release-evidence-owner'
  ) {
    findings.push('policy.registeredBy must name the release-evidence owner');
  }

  const principals = new Set();
  const fingerprints = new Set();
  const roster = Array.isArray(policy.evaluators) ? policy.evaluators : [];
  for (const [index, evaluator] of roster.entries()) {
    const label = `policy.evaluators[${String(index)}]`;
    if (
      !exactKeys(evaluator, ['id', 'identity', 'independence', 'publicKey']) ||
      !/^[a-z][a-z0-9-]{2,63}$/u.test(evaluator?.id ?? '')
    ) {
      findings.push(`${label} must have an exact stable evaluator record and ID`);
      continue;
    }
    if (evaluators.has(evaluator.id))
      findings.push(`${label} duplicates evaluator ${evaluator.id}`);
    evaluators.set(evaluator.id, evaluator);
    if (
      !exactKeys(evaluator.identity, ['kind', 'organization', 'principal']) ||
      !EVALUATOR_KINDS.has(evaluator.identity?.kind) ||
      !substantive(evaluator.identity?.organization, 2, 128) ||
      !substantive(evaluator.identity?.principal, 3, 128)
    ) {
      findings.push(`${label}.identity must name a concrete human or agent principal`);
    } else {
      if (principals.has(evaluator.identity.principal)) {
        findings.push(`${label}.identity.principal is not independent`);
      }
      principals.add(evaluator.identity.principal);
    }
    if (
      !exactKeys(evaluator.independence, [
        'noFrameworkImplementationContribution',
        'noJourneyHarnessContribution',
        'nonAuthor',
      ]) ||
      evaluator.independence?.nonAuthor !== true ||
      evaluator.independence?.noFrameworkImplementationContribution !== true ||
      evaluator.independence?.noJourneyHarnessContribution !== true
    ) {
      findings.push(`${label}.independence must preregister a non-author evaluator`);
    }
    validateEvaluatorPublicKey(evaluator.publicKey, label, findings);
    if (typeof evaluator.publicKey?.fingerprint === 'string') {
      if (fingerprints.has(evaluator.publicKey.fingerprint)) {
        findings.push(`${label}.publicKey repeats another evaluator key`);
      }
      fingerprints.add(evaluator.publicKey.fingerprint);
    }
  }
  return evaluators;
}

function validateTranscript(
  transcript,
  { evaluator, findings, knownFailures, label, now, policyRegisteredAt, subjectDigest },
) {
  if (
    !exactKeys(transcript, [
      'artifactSubjectSha256',
      'completedAt',
      'environment',
      'evaluatorId',
      'findings',
      'independence',
      'pass',
      'schema',
      'signature',
      'startedAt',
      'steps',
    ]) ||
    transcript?.schema !== EXTERNAL_EVALUATOR_TRANSCRIPT_SCHEMA
  ) {
    findings.push(`${label} must be an exact ${EXTERNAL_EVALUATOR_TRANSCRIPT_SCHEMA} record`);
    return false;
  }
  if (transcript.artifactSubjectSha256 !== subjectDigest) {
    findings.push(`${label} mixes a different packed artifact subject`);
  }
  if (!validUtcTimestamp(transcript.startedAt) || !validUtcTimestamp(transcript.completedAt)) {
    findings.push(`${label} timestamps must be canonical UTC instants`);
  } else {
    const registered = Date.parse(policyRegisteredAt);
    const started = Date.parse(transcript.startedAt);
    const completed = Date.parse(transcript.completedAt);
    if (!Number.isFinite(registered) || started < registered) {
      findings.push(`${label} started before its evaluator roster was preregistered`);
    }
    if (completed < started || completed - started > MAX_TRANSCRIPT_DURATION_MS) {
      findings.push(`${label} has an invalid or unbounded journey duration`);
    }
    if (completed > now + MAX_CLOCK_SKEW_MS || now - completed > EXTERNAL_EVALUATOR_MAX_AGE_MS) {
      findings.push(`${label} is future-dated or older than the 14-day freshness window`);
    }
  }
  if (
    !exactKeys(transcript.environment, ['arch', 'node', 'packageManager', 'platform', 'runner']) ||
    Object.values(transcript.environment ?? {}).some((value) => !substantive(value, 2, 256))
  ) {
    findings.push(`${label}.environment must record a concrete bounded runner fingerprint`);
  }
  if (
    !exactKeys(transcript.independence, [
      'noFrameworkAuthorInterventionDuringJourney',
      'noFrameworkImplementationContribution',
      'noJourneyHarnessContribution',
      'nonAuthor',
    ]) ||
    transcript.independence?.nonAuthor !== true ||
    transcript.independence?.noFrameworkImplementationContribution !== true ||
    transcript.independence?.noJourneyHarnessContribution !== true ||
    transcript.independence?.noFrameworkAuthorInterventionDuringJourney !== true
  ) {
    findings.push(`${label}.independence must be a signed non-author/no-intervention attestation`);
  }

  validateJourneySteps(transcript.steps, label, findings);
  const hasBlockingFinding = validateFindings(transcript.findings, label, knownFailures, findings);
  const expectedPass = hasBlockingFinding === false;
  if (transcript.pass !== expectedPass) {
    findings.push(`${label}.pass must match its release-blocking finding triage`);
  }
  validateTranscriptSignature(transcript, evaluator, label, findings);
  return transcript.pass === true && expectedPass;
}

function validateJourneySteps(steps, label, findings) {
  if (!Array.isArray(steps) || steps.length !== EXTERNAL_EVALUATOR_JOURNEY_STEPS.length) {
    findings.push(`${label}.steps must retain the exact packed-scaffold journey`);
    return;
  }
  for (const [index, expected] of EXTERNAL_EVALUATOR_JOURNEY_STEPS.entries()) {
    const step = steps[index];
    const stepLabel = `${label}.steps[${String(index)}]`;
    if (
      !exactKeys(step, ['action', 'durationMs', 'exitCode', 'id', 'observation', 'outcome']) ||
      step?.id !== expected.id ||
      step?.outcome !== expected.outcome ||
      !Number.isFinite(step?.durationMs) ||
      step.durationMs < 0 ||
      step.durationMs > MAX_TRANSCRIPT_DURATION_MS ||
      !substantive(step?.action, 8, 1_024) ||
      !substantive(step?.observation, 12, 4_096)
    ) {
      findings.push(
        `${stepLabel} must record the exact ${expected.id} outcome without placeholders`,
      );
    }
    if (
      expected.exitCode === null
        ? step?.exitCode !== null && step?.exitCode !== 0
        : step?.exitCode !== expected.exitCode
    ) {
      findings.push(`${stepLabel}.exitCode does not match the ${expected.id} contract`);
    }
  }
}

function validateFindings(records, label, knownFailures, findings) {
  if (!Array.isArray(records) || records.length > 100) {
    findings.push(`${label}.findings must be an array with at most 100 records`);
    return true;
  }
  const ids = new Set();
  let hasBlocking = false;
  for (const [index, finding] of records.entries()) {
    const findingLabel = `${label}.findings[${String(index)}]`;
    if (
      !exactKeys(finding, ['evidence', 'id', 'severity', 'summary', 'triage']) ||
      !/^F-[0-9]{3}$/u.test(finding?.id ?? '') ||
      !FINDING_SEVERITIES.has(finding?.severity) ||
      !substantive(finding?.summary, 12, 512) ||
      !substantive(finding?.evidence, 12, 4_096)
    ) {
      findings.push(`${findingLabel} must be a bounded substantive finding`);
      continue;
    }
    if (ids.has(finding.id)) findings.push(`${findingLabel} duplicates finding ${finding.id}`);
    ids.add(finding.id);
    const triage = finding.triage;
    if (
      !exactKeys(triage, [
        'knownFailureId',
        'owner',
        'rationale',
        'registerState',
        'releaseBlocking',
      ]) ||
      typeof triage?.releaseBlocking !== 'boolean' ||
      !substantive(triage?.rationale, 12, 1_024)
    ) {
      findings.push(`${findingLabel}.triage must link a reviewed known-failure disposition`);
      continue;
    }
    const registered =
      knownFailures instanceof Map ? knownFailures.get(triage.knownFailureId) : null;
    if (registered === undefined || registered === null) {
      findings.push(
        `${findingLabel}.triage.knownFailureId is absent from the known-failure register`,
      );
      continue;
    }
    if (triage.registerState !== registered.state || triage.owner !== registered.owner) {
      findings.push(`${findingLabel}.triage does not match the registered state and owner`);
    }
    if (
      (registered.state === 'retired' ||
        finding.severity === 'blocking' ||
        finding.severity === 'major') &&
      triage.releaseBlocking !== true
    ) {
      findings.push(`${findingLabel}.triage must block a regression or major finding`);
    }
    if (triage.releaseBlocking === true) hasBlocking = true;
  }
  return hasBlocking;
}

function validateTranscriptSignature(transcript, evaluator, label, findings) {
  const signature = transcript?.signature;
  if (
    !exactKeys(signature, ['algorithm', 'keyFingerprint', 'payloadSha256', 'value']) ||
    signature?.algorithm !== 'ed25519' ||
    signature?.keyFingerprint !== evaluator?.publicKey?.fingerprint
  ) {
    findings.push(`${label}.signature must bind the preregistered Ed25519 key`);
    return;
  }
  let payload;
  try {
    payload = externalEvaluatorTranscriptPayload(transcript);
  } catch (error) {
    findings.push(`${label}.signature payload is not canonical JSON: ${error.message}`);
    return;
  }
  if (signature.payloadSha256 !== sha256(payload)) {
    findings.push(`${label}.signature payload digest does not match the transcript`);
    return;
  }
  try {
    const publicKeyBytes = canonicalBase64(
      evaluator.publicKey.spki,
      `${label} evaluator public key`,
    );
    const signatureBytes = canonicalBase64(signature.value, `${label} signature`);
    if (
      signatureBytes.byteLength !== 64 ||
      !verifyEd25519Spki(payload, publicKeyBytes, signatureBytes)
    ) {
      findings.push(`${label}.signature failed Ed25519 verification`);
    }
  } catch (error) {
    findings.push(`${label}.signature is malformed or unverifiable: ${error.message}`);
  }
}

function validateEvaluatorPublicKey(record, label, findings) {
  if (
    !exactKeys(record, ['algorithm', 'fingerprint', 'spki']) ||
    record?.algorithm !== 'ed25519' ||
    !validDigest(record?.fingerprint)
  ) {
    findings.push(`${label}.publicKey must be an exact Ed25519 SPKI record`);
    return;
  }
  try {
    const bytes = canonicalBase64(record.spki, `${label}.publicKey.spki`);
    if (!isEd25519Spki(bytes)) {
      findings.push(`${label}.publicKey must decode as Ed25519`);
    }
    if (record.fingerprint !== sha256(bytes)) {
      findings.push(`${label}.publicKey fingerprint does not match its SPKI bytes`);
    }
  } catch (error) {
    findings.push(`${label}.publicKey is malformed: ${error.message}`);
  }
}

function validateArtifactSubject(subject, label, findings) {
  if (
    !exactKeys(subject, [
      'packageSet',
      'packageSetSha256',
      'packedManifestSha256',
      'schema',
      'sourceCommit',
    ]) ||
    subject?.schema !== EXTERNAL_EVALUATOR_ARTIFACT_SUBJECT_SCHEMA ||
    !validGitObjectId(subject?.sourceCommit) ||
    !validDigest(subject?.packedManifestSha256) ||
    !validDigest(subject?.packageSetSha256) ||
    !Array.isArray(subject?.packageSet) ||
    subject.packageSet.length === 0
  ) {
    findings.push(`${label} must be an exact authenticated packed artifact subject`);
    return;
  }
  const names = new Set();
  let previousName = null;
  for (const [index, pkg] of subject.packageSet.entries()) {
    if (
      !exactKeys(pkg, ['name', 'sha512', 'version']) ||
      !substantive(pkg?.name, 2, 256) ||
      !substantive(pkg?.version, 1, 64) ||
      !validSha512Integrity(pkg?.sha512)
    ) {
      findings.push(`${label}.packageSet[${String(index)}] is invalid`);
    }
    if (names.has(pkg?.name)) findings.push(`${label}.packageSet duplicates ${String(pkg?.name)}`);
    names.add(pkg?.name);
    if (previousName !== null && compareUtf8(previousName, pkg?.name) >= 0) {
      findings.push(`${label}.packageSet must be uniquely sorted by package name`);
    }
    previousName = pkg?.name;
  }
  if (subject.packageSetSha256 !== sha256(canonicalJson(subject.packageSet))) {
    findings.push(`${label}.packageSetSha256 does not match the exact package set`);
  }
}

function validateHistory(history, actualSubject, findings) {
  if (
    history?.currentTreeClean !== true ||
    !validGitObjectId(history?.currentCommit) ||
    !validGitObjectId(history?.policyIntroductionCommit) ||
    !validGitObjectId(history?.policyIntroductionParent)
  ) {
    findings.push('release evidence must be verified from a clean, exact Git history');
  }
  if (actualSubject?.sourceCommit !== history?.currentCommit) {
    findings.push('release evidence subject must bind the exact current HEAD');
  }
  if (history?.policyUnchangedSinceIntroduction !== true) {
    findings.push('evaluator policy changed after preregistration');
  }
  if (history?.policyOnlyIntroduction !== true) {
    findings.push('evaluator policy introduction commit must change only the policy path');
  }
  if (
    history?.policyPredatesCurrent !== true ||
    history?.policyIntroductionCommit === history?.currentCommit
  ) {
    findings.push('evaluator roster must be immutable and committed before the release HEAD');
  }
  if (history?.currentPackedManifestAuthenticated !== true) {
    findings.push(
      'release HEAD did not authenticate the exact current packed manifest and tarballs',
    );
  }
}

function collectEvidenceHistory({ policyBytes, policyPath, repoRoot }) {
  const currentCommit = gitOutput(repoRoot, ['rev-parse', 'HEAD']);
  const policyIntroductionCommit = introductionCommit(repoRoot, policyPath, 'evaluator policy');
  const parents = gitOutput(repoRoot, [
    'rev-list',
    '--parents',
    '-n',
    '1',
    policyIntroductionCommit,
  ]).split(/\s+/u);
  if (parents.length !== 2) {
    throw new Error('evaluator policy introduction must be a non-root, single-parent commit');
  }
  const introductionPaths = gitOutput(repoRoot, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    policyIntroductionCommit,
  ])
    .split(/\r?\n/u)
    .filter(Boolean);
  return Object.freeze({
    currentCommit,
    currentTreeClean:
      gitOutput(repoRoot, ['status', '--porcelain=v1', '--untracked-files=no']) === '',
    policyIntroductionCommit,
    policyIntroductionParent: parents[1],
    policyOnlyIntroduction: introductionPaths.length === 1 && introductionPaths[0] === policyPath,
    policyPredatesCurrent:
      policyIntroductionCommit !== currentCommit &&
      gitSucceeds(repoRoot, [
        'merge-base',
        '--is-ancestor',
        policyIntroductionCommit,
        currentCommit,
      ]),
    policyUnchangedSinceIntroduction:
      gitBlob(repoRoot, policyIntroductionCommit, policyPath).equals(policyBytes) &&
      gitOutput(repoRoot, [
        'log',
        '--format=%H',
        `${policyIntroductionCommit}..${currentCommit}`,
        '--',
        policyPath,
      ]) === '',
  });
}

function introductionCommit(repoRoot, relativePath, label) {
  const commits = gitOutput(repoRoot, ['log', '--diff-filter=A', '--format=%H', '--', relativePath])
    .split(/\r?\n/u)
    .filter(Boolean);
  if (commits.length !== 1 || !validGitObjectId(commits[0])) {
    throw new Error(`${label} must have exactly one auditable introduction commit`);
  }
  return commits[0];
}

function gitBlob(repoRoot, commit, relativePath) {
  return Buffer.from(
    execFileSync('git', ['show', `${commit}:${relativePath}`], {
      cwd: repoRoot,
      encoding: null,
      maxBuffer: MAX_POLICY_BYTES + 1,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

function gitOutput(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: MAX_EVIDENCE_BYTES + 1,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitSucceeds(repoRoot, args) {
  return (
    spawnSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'ignore',
    }).status === 0
  );
}

function repositoryFile(repoRoot, relativePath, label) {
  return nonSymlinkDescendant(repoRoot, relativePath, { kind: 'file', label });
}

function materializeExternalEvaluatorEvidenceInput({ encoded, evidencePath, repoRoot }) {
  const bytes = decodeExternalEvaluatorEvidenceInput(encoded);
  const relativePath = canonicalRepositoryRelativePath(evidencePath, 'evidence bundle');
  const directory = path.posix.dirname(relativePath);
  if (directory === '.') {
    throw new Error('evidence bundle must be materialized in a repository subdirectory');
  }
  ensureNonSymlinkDescendantDirectory(repoRoot, directory, 'evidence bundle directory');
  const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
  if (existsSync(absolutePath)) {
    throw new Error('external evaluator evidence input refuses to replace an existing path');
  }
  writeFileSync(absolutePath, bytes, { flag: 'wx', mode: 0o600 });
  const written = repositoryFile(repoRoot, relativePath, 'evidence bundle');
  if (!readBoundedRegularFile(written, MAX_EVIDENCE_BYTES, 'evidence bundle').equals(bytes)) {
    throw new Error('external evaluator evidence input changed while it was materialized');
  }
}

function canonicalRepositoryRelativePath(relativePath, label) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a canonical relative path`);
  }
  return relativePath;
}

function readBoundedJsonBytes(filePath, maxBytes, label) {
  const bytes = readBoundedRegularFile(filePath, maxBytes, label);
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error(`${label} must contain 1 through ${String(maxBytes)} bytes`);
  }
  return bytes;
}

function safeSubjectDigest(subject, findings) {
  try {
    return externalEvaluatorArtifactSubjectDigest(subject);
  } catch (error) {
    findings.push(`artifact subject is not finite canonical JSON: ${error.message}`);
    return null;
  }
}

function canonicalBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new TypeError(`${label} must be canonical base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength === 0 || bytes.toString('base64') !== value) {
    throw new TypeError(`${label} must be canonical base64`);
  }
  return bytes;
}

function substantive(value, minimum, maximum) {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length >= minimum &&
    value.length <= maximum &&
    !PLACEHOLDER.test(value)
  );
}

function validUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validGitObjectId(value) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value ?? '');
}

function validDigest(value) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '');
}

function validSha512Integrity(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) return false;
  try {
    return canonicalBase64(value.slice('sha512-'.length), 'package integrity').byteLength === 64;
  } catch {
    return false;
  }
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(compareUtf8), [...expected].sort(compareUtf8))
  );
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('external evaluator evidence contains a non-JSON value');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
}

if (isMainEntry(import.meta.url)) await runGate(runExternalEvaluatorEvidence);
