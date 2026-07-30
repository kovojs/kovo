import { createHash, generateKeyPairSync, sign as createCryptographicSignature } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_EVALUATOR_ARTIFACT_SUBJECT_SCHEMA,
  EXTERNAL_EVALUATOR_CONTRACT_DIGEST,
  EXTERNAL_EVALUATOR_EVIDENCE_SCHEMA,
  EXTERNAL_EVALUATOR_JOURNEY_STEPS,
  EXTERNAL_EVALUATOR_POLICY_SCHEMA,
  EXTERNAL_EVALUATOR_REQUIRED_COUNT,
  EXTERNAL_EVALUATOR_TRANSCRIPT_SCHEMA,
  buildExternalEvaluatorArtifactSubject,
  decodeExternalEvaluatorEvidenceInput,
  externalEvaluatorArtifactSubjectDigest,
  externalEvaluatorPublicKeyFingerprint,
  externalEvaluatorTranscriptPayload,
  parseExternalEvaluatorEvidenceArgs,
  validateExternalEvaluatorEvidence,
} from './external-evaluator-evidence.mjs';

const NOW = Date.parse('2026-07-30T15:00:00.000Z');
const SOURCE_COMMIT = 'a'.repeat(40);
const POLICY_COMMIT = 'b'.repeat(40);
const RELEASE_COMMIT = 'd'.repeat(40);
const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('external evaluator release evidence', () => {
  it('accepts exactly three preregistered non-author signatures over one packed subject', () => {
    const fixture = validFixture();

    expect(
      validateExternalEvaluatorEvidence({
        ...fixture,
        now: NOW,
      }),
    ).toEqual([]);
    expect(fixture.evidence.transcripts).toHaveLength(EXTERNAL_EVALUATOR_REQUIRED_COUNT);
    expect(EXTERNAL_EVALUATOR_JOURNEY_STEPS.map((step) => step.id)).toEqual([
      'scaffold',
      'install',
      'dev-ready',
      'first-200',
      'login',
      'crud',
      'edit',
      'check-failing',
      'fix',
      'check-passing',
      'test',
      'build',
    ]);
  });

  it('fails closed for missing, duplicate, or placeholder transcripts', () => {
    const missing = validFixture();
    missing.evidence.transcripts.pop();
    missing.evidence.pass = true;
    expect(findings(missing)).toContain('evidence must contain exactly N=3 transcripts');

    const duplicate = validFixture();
    duplicate.evidence.transcripts[2] = structuredClone(duplicate.evidence.transcripts[0]);
    expect(findings(duplicate)).toContain(
      'evidence.transcripts[2] repeats evaluator identity evaluator-one',
    );

    const placeholder = validFixture();
    resignTranscript(placeholder, 0, (transcript) => {
      transcript.steps[0].observation = 'TODO placeholder observation';
    });
    expect(findings(placeholder)).toContain(
      'evidence.transcripts[0].steps[0] must record the exact scaffold outcome without placeholders',
    );
  });

  it('rejects transcript mutation and a coordinated key replacement after preregistration', () => {
    const mutated = validFixture();
    mutated.evidence.transcripts[0].steps[4].observation =
      'A modified login claim not covered by the evaluator signature.';
    expect(findings(mutated)).toContain(
      'evidence.transcripts[0].signature payload digest does not match the transcript',
    );

    const replaced = validFixture();
    const replacement = evaluatorKey();
    replaced.policy.evaluators[0].publicKey = replacement.publicKey;
    replaced.keys[0] = replacement.privateKey;
    resignTranscript(replaced, 0, () => {});
    replaced.history.policyUnchangedSinceIntroduction = false;
    expect(findings(replaced)).toContain('evaluator policy changed after preregistration');
  });

  it('rejects stale, future-dated, and pre-registration journeys even when re-signed', () => {
    const stale = validFixture();
    resignTranscript(stale, 0, (transcript) => {
      transcript.startedAt = '2026-07-01T10:00:00.000Z';
      transcript.completedAt = '2026-07-01T10:20:00.000Z';
    });
    expect(findings(stale)).toContain(
      'evidence.transcripts[0] is future-dated or older than the 14-day freshness window',
    );

    const future = validFixture();
    resignTranscript(future, 1, (transcript) => {
      transcript.startedAt = '2026-07-31T10:00:00.000Z';
      transcript.completedAt = '2026-07-31T10:20:00.000Z';
    });
    expect(findings(future)).toContain(
      'evidence.transcripts[1] is future-dated or older than the 14-day freshness window',
    );

    const early = validFixture();
    early.policy.registeredAt = '2026-07-30T10:30:00.000Z';
    expect(findings(early)).toContain(
      'evidence.transcripts[0] started before its evaluator roster was preregistered',
    );
  });

  it('rejects mixed manifest, package-set, and per-transcript artifact subjects', () => {
    const mixedTranscript = validFixture();
    resignTranscript(mixedTranscript, 2, (transcript) => {
      transcript.artifactSubjectSha256 = `sha256:${'e'.repeat(64)}`;
    });
    expect(findings(mixedTranscript)).toContain(
      'evidence.transcripts[2] mixes a different packed artifact subject',
    );

    const mixedManifest = validFixture();
    mixedManifest.actualSubject = buildExternalEvaluatorArtifactSubject({
      packageSet: mixedManifest.actualSubject.packageSet,
      packedManifestSha256: `sha256:${'f'.repeat(64)}`,
      sourceCommit: RELEASE_COMMIT,
    });
    expect(findings(mixedManifest)).toContain(
      'evidence.subject does not match the current authenticated release HEAD',
    );

    const mixedPackageSet = validFixture();
    const packageSet = structuredClone(mixedPackageSet.actualSubject.packageSet);
    packageSet[0].sha512 = `sha512-${Buffer.alloc(64, 9).toString('base64')}`;
    mixedPackageSet.actualSubject = buildExternalEvaluatorArtifactSubject({
      packageSet,
      packedManifestSha256: mixedPackageSet.actualSubject.packedManifestSha256,
      sourceCommit: RELEASE_COMMIT,
    });
    expect(findings(mixedPackageSet)).toContain(
      'evidence.subject does not match the current authenticated release HEAD',
    );
  });

  it('requires signed independence from authors, implementation, harness, and intervention', () => {
    const fixture = validFixture();
    resignTranscript(fixture, 0, (transcript) => {
      transcript.independence.noFrameworkAuthorInterventionDuringJourney = false;
    });
    expect(findings(fixture)).toContain(
      'evidence.transcripts[0].independence must be a signed non-author/no-intervention attestation',
    );
  });

  it('requires every finding to link the exact known-failure owner and state', () => {
    const linked = validFixture();
    resignTranscript(linked, 0, (transcript) => {
      transcript.findings = [minorFinding()];
    });
    expect(findings(linked)).toEqual([]);

    const unknown = validFixture();
    resignTranscript(unknown, 0, (transcript) => {
      const finding = minorFinding();
      finding.triage.knownFailureId = 'KF-DEVEX-999';
      transcript.findings = [finding];
    });
    expect(findings(unknown)).toContain(
      'evidence.transcripts[0].findings[0].triage.knownFailureId is absent from the known-failure register',
    );

    const wrongOwner = validFixture();
    resignTranscript(wrongOwner, 0, (transcript) => {
      const finding = minorFinding();
      finding.triage.owner = 'A different owner';
      transcript.findings = [finding];
    });
    expect(findings(wrongOwner)).toContain(
      'evidence.transcripts[0].findings[0].triage does not match the registered state and owner',
    );
  });

  it('blocks a major finding or regression instead of accepting optimistic triage', () => {
    const major = validFixture();
    resignTranscript(major, 0, (transcript) => {
      const finding = minorFinding();
      finding.severity = 'major';
      transcript.findings = [finding];
    });
    expect(findings(major)).toContain(
      'evidence.transcripts[0].findings[0].triage must block a regression or major finding',
    );

    const retired = validFixture();
    retired.knownFailures.set('KF-DEVEX-001', {
      id: 'KF-DEVEX-001',
      owner: 'Retired journey owner',
      state: 'retired',
    });
    resignTranscript(retired, 0, (transcript) => {
      const finding = minorFinding();
      finding.triage = {
        knownFailureId: 'KF-DEVEX-001',
        owner: 'Retired journey owner',
        rationale: 'The evaluator reproduced behavior whose register entry claims retirement.',
        registerState: 'retired',
        releaseBlocking: false,
      };
      transcript.findings = [finding];
    });
    expect(findings(retired)).toContain(
      'evidence.transcripts[0].findings[0].triage must block a regression or major finding',
    );
  });

  it('requires a clean policy-only preregistration commit before the exact release HEAD', () => {
    for (const [field, expected] of [
      ['currentTreeClean', 'release evidence must be verified from a clean, exact Git history'],
      ['policyUnchangedSinceIntroduction', 'evaluator policy changed after preregistration'],
      [
        'policyOnlyIntroduction',
        'evaluator policy introduction commit must change only the policy path',
      ],
      [
        'policyPredatesCurrent',
        'evaluator roster must be immutable and committed before the release HEAD',
      ],
      [
        'currentPackedManifestAuthenticated',
        'release HEAD did not authenticate the exact current packed manifest and tarballs',
      ],
    ]) {
      const fixture = validFixture();
      fixture.history[field] = false;
      expect(findings(fixture)).toContain(expected);
    }

    const wrongHead = validFixture();
    wrongHead.actualSubject = buildExternalEvaluatorArtifactSubject({
      packageSet: wrongHead.actualSubject.packageSet,
      packedManifestSha256: wrongHead.actualSubject.packedManifestSha256,
      sourceCommit: 'e'.repeat(40),
    });
    wrongHead.evidence.subject = structuredClone(wrongHead.actualSubject);
    wrongHead.evidence.artifactSubjectSha256 = externalEvaluatorArtifactSubjectDigest(
      wrongHead.actualSubject,
    );
    expect(findings(wrongHead)).toContain(
      'release evidence subject must bind the exact current HEAD',
    );
  });

  it('accepts only bounded canonical base64 JSON-object dispatch evidence', () => {
    const encoded = Buffer.from('{"schema":"example"}').toString('base64');
    expect(decodeExternalEvaluatorEvidenceInput(encoded)).toEqual(
      Buffer.from('{"schema":"example"}'),
    );
    expect(() => decodeExternalEvaluatorEvidenceInput(`${encoded}\n`)).toThrow(
      'external evaluator evidence input must be canonical base64',
    );
    expect(() => decodeExternalEvaluatorEvidenceInput('AA=A')).toThrow(
      'external evaluator evidence input must be canonical base64',
    );
    expect(() =>
      decodeExternalEvaluatorEvidenceInput(Buffer.from('[]').toString('base64')),
    ).toThrow('external evaluator evidence input must be a JSON object');
    expect(() =>
      decodeExternalEvaluatorEvidenceInput(Buffer.from([0xff]).toString('base64')),
    ).toThrow('external evaluator evidence input must be valid UTF-8');
    expect(() => decodeExternalEvaluatorEvidenceInput('A'.repeat(48 * 1024 + 4))).toThrow(
      'external evaluator evidence input must be canonical base64',
    );
    expect(() =>
      decodeExternalEvaluatorEvidenceInput(
        Buffer.from(JSON.stringify({ value: 'x'.repeat(33 * 1024) })).toString('base64'),
      ),
    ).toThrow('external evaluator evidence input must decode canonically');
  });

  it('keeps the release CLI bounded and exposes no skip or freshness override', () => {
    expect(rootPackage.scripts['check:external-evaluator-evidence']).toBe(
      'node scripts/external-evaluator-evidence.mjs',
    );
    expect(
      parseExternalEvaluatorEvidenceArgs([
        '--policy',
        'evidence/policy.json',
        '--evidence',
        'evidence/transcripts.json',
      ]),
    ).toEqual({
      evidencePath: 'evidence/transcripts.json',
      policyPath: 'evidence/policy.json',
    });
    expect(() => parseExternalEvaluatorEvidenceArgs(['--skip'])).toThrow(
      'unknown external evaluator evidence argument "--skip"',
    );
    expect(() =>
      parseExternalEvaluatorEvidenceArgs(['--policy', 'a.json', '--policy', 'b.json']),
    ).toThrow('--policy may appear only once');
  });
});

function validFixture() {
  const packageSet = [
    {
      name: '@kovojs/core',
      sha512: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
      version: '0.3.0',
    },
    {
      name: 'create-kovo',
      sha512: `sha512-${Buffer.alloc(64, 2).toString('base64')}`,
      version: '0.3.0',
    },
  ];
  const actualSubject = buildExternalEvaluatorArtifactSubject({
    packageSet,
    packedManifestSha256: `sha256:${'1'.repeat(64)}`,
    sourceCommit: RELEASE_COMMIT,
  });
  expect(actualSubject.schema).toBe(EXTERNAL_EVALUATOR_ARTIFACT_SUBJECT_SCHEMA);
  const artifactSubjectSha256 = externalEvaluatorArtifactSubjectDigest(actualSubject);
  const evaluatorRecords = [];
  const keys = [];
  for (const [index, id] of ['evaluator-one', 'evaluator-two', 'evaluator-three'].entries()) {
    const key = evaluatorKey();
    keys.push(key.privateKey);
    evaluatorRecords.push({
      id,
      identity: {
        kind: index === 0 ? 'human' : 'agent',
        organization: `Independent evaluator organization ${String(index + 1)}`,
        principal: `independent-principal-${String(index + 1)}`,
      },
      independence: {
        nonAuthor: true,
        noFrameworkImplementationContribution: true,
        noJourneyHarnessContribution: true,
      },
      publicKey: key.publicKey,
    });
  }
  const policy = {
    schema: EXTERNAL_EVALUATOR_POLICY_SCHEMA,
    contractDigest: EXTERNAL_EVALUATOR_CONTRACT_DIGEST,
    evaluators: evaluatorRecords,
    registeredAt: '2026-07-29T09:00:00.000Z',
    registeredBy: {
      id: 'kovo-release-evidence-reviewer',
      role: 'release-evidence-owner',
    },
    requiredEvaluators: EXTERNAL_EVALUATOR_REQUIRED_COUNT,
  };
  const transcripts = evaluatorRecords.map((evaluator, index) =>
    signedTranscript({
      artifactSubjectSha256,
      completedAt: `2026-07-30T${String(10 + index).padStart(2, '0')}:20:00.000Z`,
      evaluator,
      privateKey: keys[index],
      startedAt: `2026-07-30T${String(10 + index).padStart(2, '0')}:00:00.000Z`,
    }),
  );
  return {
    actualSubject,
    evidence: {
      schema: EXTERNAL_EVALUATOR_EVIDENCE_SCHEMA,
      artifactSubjectSha256,
      contractDigest: EXTERNAL_EVALUATOR_CONTRACT_DIGEST,
      pass: true,
      requiredEvaluators: EXTERNAL_EVALUATOR_REQUIRED_COUNT,
      subject: structuredClone(actualSubject),
      transcripts,
    },
    history: {
      currentCommit: RELEASE_COMMIT,
      currentPackedManifestAuthenticated: true,
      currentTreeClean: true,
      policyIntroductionCommit: POLICY_COMMIT,
      policyIntroductionParent: SOURCE_COMMIT,
      policyOnlyIntroduction: true,
      policyPredatesCurrent: true,
      policyUnchangedSinceIntroduction: true,
    },
    keys,
    knownFailures: new Map([
      [
        'KF-DEVEX-002',
        {
          id: 'KF-DEVEX-002',
          owner: 'Track 1 dev-reporter work item',
          state: 'executable',
        },
      ],
    ]),
    policy,
  };
}

function evaluatorKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return {
    privateKey,
    publicKey: {
      algorithm: 'ed25519',
      fingerprint: externalEvaluatorPublicKeyFingerprint(spki),
      spki,
    },
  };
}

function signedTranscript({
  artifactSubjectSha256,
  completedAt,
  evaluator,
  privateKey,
  startedAt,
}) {
  const unsigned = {
    schema: EXTERNAL_EVALUATOR_TRANSCRIPT_SCHEMA,
    artifactSubjectSha256,
    completedAt,
    environment: {
      arch: 'x64',
      node: 'v24.18.0',
      packageManager: 'pnpm 10.12.1',
      platform: 'linux',
      runner: `isolated-runner-for-${evaluator.id}`,
    },
    evaluatorId: evaluator.id,
    findings: [],
    independence: {
      nonAuthor: true,
      noFrameworkImplementationContribution: true,
      noJourneyHarnessContribution: true,
      noFrameworkAuthorInterventionDuringJourney: true,
    },
    pass: true,
    startedAt,
    steps: EXTERNAL_EVALUATOR_JOURNEY_STEPS.map((step, index) => ({
      action: `Execute independent ${step.id} action against authenticated packed packages`,
      durationMs: 100 + index,
      exitCode: step.exitCode,
      id: step.id,
      observation: `Observed the required ${step.outcome} outcome from the packed scaffold.`,
      outcome: step.outcome,
    })),
  };
  return attachSignature(unsigned, evaluator.publicKey, privateKey);
}

function attachSignature(unsigned, publicKey, privateKey) {
  const payload = externalEvaluatorTranscriptPayload(unsigned);
  return {
    ...unsigned,
    signature: {
      algorithm: 'ed25519',
      keyFingerprint: publicKey.fingerprint,
      payloadSha256: digest(payload),
      value: createCryptographicSignature(null, payload, privateKey).toString('base64'),
    },
  };
}

function resignTranscript(fixture, index, mutate) {
  const evaluator = fixture.policy.evaluators[index];
  const unsigned = structuredClone(fixture.evidence.transcripts[index]);
  delete unsigned.signature;
  mutate(unsigned);
  fixture.evidence.transcripts[index] = attachSignature(
    unsigned,
    evaluator.publicKey,
    fixture.keys[index],
  );
}

function minorFinding() {
  return {
    id: 'F-001',
    severity: 'minor',
    summary: 'The ready report was harder to scan than the evaluator expected.',
    evidence: 'The signed dev-ready observation records the exact output location and result.',
    triage: {
      knownFailureId: 'KF-DEVEX-002',
      owner: 'Track 1 dev-reporter work item',
      rationale: 'The observation is already owned by the registered dev-readiness failure.',
      registerState: 'executable',
      releaseBlocking: false,
    },
  };
}

function findings(fixture) {
  return validateExternalEvaluatorEvidence({
    actualSubject: fixture.actualSubject,
    evidence: fixture.evidence,
    history: fixture.history,
    knownFailures: fixture.knownFailures,
    now: NOW,
    policy: fixture.policy,
  });
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
