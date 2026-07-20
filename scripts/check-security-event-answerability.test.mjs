import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkSecurityEventAnswerability,
  repoRoot,
} from './check-security-event-answerability.mjs';

const paths = [
  'security/security-event-decision-sites.json',
  'packages/core/src/internal/security-decision.ts',
  'packages/core/src/secret.ts',
  'packages/core/src/storage.ts',
  'packages/server/src/egress.ts',
  'packages/server/src/generated-runtime-posture-registry.ts',
  'packages/server/src/guards.ts',
  'packages/server/src/replay.ts',
  'packages/server/src/security-event.ts',
  'packages/server/src/security-event-export.ts',
  'packages/server/src/task-queue.ts',
  'packages/cli/src/commands/build-export.ts',
  'packages/cli/src/commands/incident-scope.ts',
];

function sources() {
  return Object.fromEntries(
    paths.map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')]),
  );
}

function run(files) {
  return checkSecurityEventAnswerability({
    files: paths.filter((file) => /\.[cm]?tsx?$/u.test(file) && !/\.(?:test|spec)\./u.test(file)),
    readText: (file) => files[file],
    repoRoot: '/fixture',
  });
}

describe('security-event retrospective answerability gate', () => {
  it('accepts the exact runtime, export, and CLI denominator binding', () => {
    expect(run(sources())).toEqual({ findings: [], ok: true });
  });

  it('rejects denominator shrinkage and missing required event facts', () => {
    const missingDoor = sources();
    missingDoor['packages/server/src/security-event.ts'] = missingDoor[
      'packages/server/src/security-event.ts'
    ].replace("  'declassification',\n", '');
    expect(run(missingDoor)).toMatchObject({
      findings: [expect.stringContaining('incident-door denominator')],
      ok: false,
    });

    const optionalEpochCarrier = sources();
    optionalEpochCarrier['packages/server/src/security-event.ts'] = optionalEpochCarrier[
      'packages/server/src/security-event.ts'
    ].replace(
      'readonly principal: SecurityEventPrincipalScope;',
      'readonly principal?: SecurityEventPrincipalScope;',
    );
    expect(run(optionalEpochCarrier)).toMatchObject({
      findings: [expect.stringContaining('cannot be optional')],
      ok: false,
    });

    const optionalEpoch = sources();
    optionalEpoch['packages/server/src/security-event.ts'] = optionalEpoch[
      'packages/server/src/security-event.ts'
    ].replace('readonly epoch: number;', 'readonly epoch?: number;');
    expect(run(optionalEpoch)).toMatchObject({
      findings: [expect.stringContaining('must require epoch')],
      ok: false,
    });
  });

  it('rejects export/CLI drift and loss of the unanswerable verdict', () => {
    const driftedExport = sources();
    driftedExport['packages/server/src/security-event-export.ts'] = driftedExport[
      'packages/server/src/security-event-export.ts'
    ].replace('doors: SECURITY_EVENT_INCIDENT_DOORS', 'doors: []');
    expect(run(driftedExport).findings).toEqual([
      expect.stringContaining('export must carry the exact incident-door'),
    ]);

    const unsignedHead = sources();
    unsignedHead['packages/server/src/security-event-export.ts'] = unsignedHead[
      'packages/server/src/security-event-export.ts'
    ].replace('head: securityEventExportHead()', 'head: securityEventChainHead()');
    expect(run(unsignedHead).findings).toEqual([expect.stringContaining('authenticated v2 head')]);

    const dishonestCli = sources();
    dishonestCli['packages/cli/src/commands/incident-scope.ts'] = dishonestCli[
      'packages/cli/src/commands/incident-scope.ts'
    ].replaceAll('unanswerable within the covered doors', 'no impact');
    expect(run(dishonestCli).findings).toEqual([
      expect.stringContaining('absent evidence into no impact'),
    ]);

    const unverifiedHead = sources();
    unverifiedHead['packages/cli/src/commands/incident-scope.ts'] = unverifiedHead[
      'packages/cli/src/commands/incident-scope.ts'
    ].replace('verifier.verifyExportHead(head)', 'true');
    expect(run(unverifiedHead).findings).toEqual([
      expect.stringContaining('authenticate the v2 export head'),
    ]);
  });

  it('rejects runtime or CLI principal vocabulary and identity-bound drift', () => {
    const shrunkRuntimeVocabulary = sources();
    shrunkRuntimeVocabulary['packages/server/src/security-event.ts'] = shrunkRuntimeVocabulary[
      'packages/server/src/security-event.ts'
    ].replace("  'principal-unrecordable',\n", '');
    expect(run(shrunkRuntimeVocabulary).findings).toEqual([
      expect.stringContaining('runtime principal vocabulary and identity bound'),
    ]);

    const narrowedCliBound = sources();
    narrowedCliBound['packages/cli/src/commands/incident-scope.ts'] = narrowedCliBound[
      'packages/cli/src/commands/incident-scope.ts'
    ].replace(
      'const INCIDENT_PRINCIPAL_IDENTITY_MAX_LENGTH = 1_024;',
      'const INCIDENT_PRINCIPAL_IDENTITY_MAX_LENGTH = 512;',
    );
    expect(run(narrowedCliBound).findings).toEqual([
      expect.stringContaining('CLI principal vocabulary and identity bound'),
    ]);
  });

  it('rejects reopening the no-journal decision path', () => {
    const reopened = sources();
    reopened['packages/server/src/security-event.ts'] = reopened[
      'packages/server/src/security-event.ts'
    ].replace(
      'Answerability-bearing security decisions require the journal before the decision can proceed.',
      'decision dropped',
    );
    expect(run(reopened).findings).toEqual([
      expect.stringContaining('without a journal must fail closed'),
    ]);
  });

  it('C13 rejects unenrolled, stale, incomplete, and payload-bearing decision sites', () => {
    const unreviewed = sources();
    unreviewed['packages/server/src/replay.ts'] +=
      '\n// @kovo-security-decision replay shadow-reservation\n';
    expect(run(unreviewed).findings).toEqual([
      expect.stringContaining('unreviewed security decision marker'),
    ]);

    const stale = sources();
    stale['packages/server/src/task-queue.ts'] = stale['packages/server/src/task-queue.ts'].replace(
      '@kovo-security-decision task enqueue-scope-admission',
      '@kovo-security-decision task removed-marker',
    );
    expect(run(stale).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('enrolled marker must occur exactly once'),
        expect.stringContaining('unreviewed security decision marker'),
        expect.stringContaining('stale security decision census marker'),
      ]),
    );

    const missingEmission = sources();
    missingEmission['packages/server/src/guards.ts'] = missingEmission[
      'packages/server/src/guards.ts'
    ].replace(
      "decisionSite: 'framework:authorization:access-guard-chain'",
      "decisionSite: 'framework:authorization:removed'",
    );
    expect(run(missingEmission).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must have exactly one emission constructor'),
        expect.stringContaining('not enrolled in the closed census'),
        expect.stringContaining('has no complete production emission'),
      ]),
    );

    const payload = sources();
    payload['packages/core/src/storage.ts'] = payload['packages/core/src/storage.ts'].replace(
      "door: 'storage',",
      "door: 'storage',\n    payload: facts,",
    );
    expect(run(payload).findings).toEqual([
      expect.stringContaining('complete no-payload fact set'),
    ]);
  });

  it('C13 rejects outcome, census, and production-registration drift', () => {
    const allowOnly = sources();
    allowOnly['packages/server/src/replay.ts'] = allowOnly['packages/server/src/replay.ts'].replace(
      "? 'deny' : 'allow'",
      "? 'allow' : 'allow'",
    );
    expect(run(allowOnly).findings).toEqual([
      expect.stringContaining('retain explicit allow and deny outcomes'),
    ]);

    const shrunkCensus = sources();
    const census = JSON.parse(shrunkCensus['security/security-event-decision-sites.json']);
    census.decisionSites = census.decisionSites.filter((row) => row.door !== 'egress');
    shrunkCensus['security/security-event-decision-sites.json'] = JSON.stringify(census);
    expect(run(shrunkCensus).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exactly one site for every incident door'),
        expect.stringContaining('unreviewed security decision marker'),
        expect.stringContaining('not enrolled in the closed census'),
      ]),
    );

    const unarmed = sources();
    unarmed['packages/server/src/generated-runtime-posture-registry.ts'] = unarmed[
      'packages/server/src/generated-runtime-posture-registry.ts'
    ].replace('armSecurityDecisionEventRecorder();', '/* recorder omitted */');
    expect(run(unarmed).findings).toEqual([expect.stringContaining('before arming decisions')]);

    const optionalProductionRegistry = sources();
    optionalProductionRegistry['packages/cli/src/commands/build-export.ts'] =
      optionalProductionRegistry['packages/cli/src/commands/build-export.ts'].replace(
        'if (registry.runtimePosture === undefined)',
        'if (false)',
      );
    expect(run(optionalProductionRegistry).findings).toEqual([
      expect.stringContaining('must require posture registration'),
    ]);
  });
});
