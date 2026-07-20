import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkSecurityEventAnswerability,
  repoRoot,
} from './check-security-event-answerability.mjs';

const paths = [
  'packages/server/src/security-event.ts',
  'packages/server/src/security-event-export.ts',
  'packages/cli/src/commands/incident-scope.ts',
];

function sources() {
  return Object.fromEntries(
    paths.map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')]),
  );
}

function run(files) {
  return checkSecurityEventAnswerability({
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

    const dishonestCli = sources();
    dishonestCli['packages/cli/src/commands/incident-scope.ts'] = dishonestCli[
      'packages/cli/src/commands/incident-scope.ts'
    ].replaceAll('unanswerable within the covered doors', 'no impact');
    expect(run(dishonestCli).findings).toEqual([
      expect.stringContaining('absent evidence into no impact'),
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
});
