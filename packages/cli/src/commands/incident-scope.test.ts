import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import { afterEach, describe, expect, it } from 'vitest';

import { createSecurityEventCryptoHandle } from '../../../server/src/crypto-authority.js';
import {
  createSecurityEventJournal,
  createSecurityEventRecordVerifier,
  type SecurityDecisionEventInput,
  type SecurityEventInput,
} from '../../../server/src/security-event.js';
import { parseIncidentArgs, runIncidentScopeCommand } from './incident-scope.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const TEST_SECRET = 'incident-scope-cli-test-secret-0123456789abcdef0123456789abcdef';
const TEST_DEPLOYMENT_ID = 'deployment:incident-scope-test';
const verificationEnvironment = Object.freeze({
  KOVO_ATTESTATION_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID,
  KOVO_ATTESTATION_SECRET: TEST_SECRET,
});
const authority = createSecurityEventCryptoHandle(TEST_SECRET, TEST_DEPLOYMENT_ID);

function event(
  principal: string,
  tenant: string | null,
  decisionSite = 'framework:authorization:guard-chain',
): SecurityDecisionEventInput {
  return {
    decisionSite,
    door: 'authorization',
    outcome: 'allow',
    principal: { epoch: 12, id: principal, kind: 'principal', tenant },
    resourceScope: { identity: 'global', kind: 'resource' },
    type: 'security-decision',
  };
}

function advisory(coverage: 'covered' | 'outside-covered-doors' = 'covered'): object {
  return {
    id: 'KOVO-2026-001',
    incidentScope: {
      coverage,
      decisionSites: ['framework:authorization:guard-chain'],
      doors: ['authorization'],
      outcomes: ['allow'],
      resourceKinds: ['resource'],
      schema: 'kovo.security.incident-scope-predicate/v1',
    },
    schema: 'kovo.security.advisory/v1',
  };
}

function fixture(
  inputs: readonly SecurityEventInput[],
  options: { dropped?: number; advisory?: object } = {},
): { advisoryPath: string; eventsPath: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'kovo-incident-scope-'));
  roots.push(root);
  let now = 1_720_000_000_000;
  const journal = createSecurityEventJournal({
    authority,
    capacity: options.dropped === undefined ? 32 : 1,
    now: () => now++,
  });
  for (const input of inputs) journal.record(input);
  const advisoryPath = join(root, 'advisory.json');
  const eventsPath = join(root, 'events.json');
  writeFileSync(advisoryPath, canonicalJsonStringify(options.advisory ?? advisory()));
  writeFileSync(
    eventsPath,
    canonicalJsonStringify({
      coverage: {
        doors: ['auth', 'authorization', 'declassification', 'egress', 'storage', 'task', 'replay'],
        schema: 'kovo-security-event-coverage/v1',
      },
      events: journal.snapshot(),
      head: journal.exportHead(),
      schema: 'kovo-security-event-export/v2',
    }),
  );
  return { advisoryPath, eventsPath, root };
}

function runFixture(
  files: { advisoryPath: string; eventsPath: string; root: string },
  environment: NodeJS.ProcessEnv = verificationEnvironment,
) {
  return runIncidentScopeCommand(
    { advisoryPath: files.advisoryPath, eventsPath: files.eventsPath },
    files.root,
    environment,
  );
}

describe('kovo incident scope', () => {
  it('parses one advisory and a required event export without accepting extra flags', () => {
    expect(parseIncidentArgs(['scope', 'advisory.json', '--events', 'events.json'])).toEqual({
      ok: true,
      options: { advisoryPath: 'advisory.json', eventsPath: 'events.json' },
    });
    expect(parseIncidentArgs(['scope', 'advisory.json'])).toMatchObject({ ok: false });
    expect(
      parseIncidentArgs(['scope', 'advisory.json', '--events', 'events.json', '--quiet']),
    ).toMatchObject({ ok: false });
  });

  it('returns a deterministic deduplicated principal and tenant set, never payload data', () => {
    const files = fixture([
      { reason: 'invalid-token', type: 'csrf-rejected' },
      event('principal-z', 'tenant-b'),
      event('principal-a', 'tenant-a'),
      event('principal-a', 'tenant-a'),
      event('principal-ignored', 'tenant-ignored', 'framework:authorization:other-site'),
    ]);
    const result = runFixture(files);

    expect(result.exitCode).toBe(0);
    if (!('output' in result)) throw new Error(result.error);
    expect(JSON.parse(result.output)).toEqual({
      advisoryId: 'KOVO-2026-001',
      affectedPrincipals: ['principal-a', 'principal-z'],
      affectedTenants: ['tenant-a', 'tenant-b'],
      answerability: { complete: true, reason: null },
      coveredDoors: ['authorization'],
      decisionSites: ['framework:authorization:guard-chain'],
      matchedEvents: 3,
      schema: 'kovo.security.incident-scope/v1',
      status: 'affected',
    });
    expect(result.output.endsWith('\n')).toBe(true);
  });

  it('matches the runtime principal identity bound at 512, 513, 1024, and 1025 code units', () => {
    for (const length of [512, 513, 1_024]) {
      const principal = 'p'.repeat(length);
      const tenant = 't'.repeat(length);
      const files = fixture([event(principal, tenant)]);
      const result = runFixture(files);

      expect(result.exitCode, `accepted identity length ${length}`).toBe(0);
      if (!('output' in result)) throw new Error(result.error);
      expect(JSON.parse(result.output)).toMatchObject({
        affectedPrincipals: [principal],
        affectedTenants: [tenant],
        status: 'affected',
      });
    }

    const overBound = fixture([event('p', null)]);
    const document = JSON.parse(readFileSync(overBound.eventsPath, 'utf8')) as {
      events: Array<{ principal: { id: string } }>;
    };
    document.events[0]!.principal.id = 'p'.repeat(1_025);
    writeFileSync(overBound.eventsPath, canonicalJsonStringify(document));
    const rejected = runFixture(overBound);
    expect(rejected).toMatchObject({ exitCode: 1 });
    if (!('error' in rejected)) throw new Error(rejected.output);
    expect(rejected.error).toContain('bounded printable principal identity');
  });

  it('reports unanswerable within covered doors for bypasses, dropped history, and unresolved principals', () => {
    const outside = fixture([], { advisory: advisory('outside-covered-doors') });
    const outsideResult = runFixture(outside);
    expect(outsideResult).toMatchObject({ exitCode: 1 });
    if (!('output' in outsideResult)) throw new Error(outsideResult.error);
    expect(JSON.parse(outsideResult.output)).toMatchObject({
      answerability: {
        complete: false,
        reason:
          'unanswerable within the covered doors: advisory exploit path does not cross a Kovo decision door',
      },
      status: 'unanswerable',
    });

    const dropped = fixture([event('principal-a', 'tenant-a'), event('principal-b', 'tenant-b')], {
      dropped: 1,
    });
    const droppedResult = runFixture(dropped);
    expect(droppedResult).toMatchObject({ exitCode: 1 });
    if (!('output' in droppedResult)) throw new Error(droppedResult.error);
    expect(JSON.parse(droppedResult.output)).toMatchObject({
      answerability: {
        complete: false,
        reason: expect.stringContaining('journal dropped 1 record'),
      },
      status: 'unanswerable',
    });

    const unresolvedInput: SecurityDecisionEventInput = {
      ...event('unused', null),
      principal: {
        epoch: null,
        id: 'principal-known-without-epoch',
        kind: 'unresolved',
        reason: 'epoch-unavailable',
        tenant: 'tenant-known',
      },
    };
    const unresolved = fixture([unresolvedInput]);
    const unresolvedResult = runFixture(unresolved);
    expect(unresolvedResult).toMatchObject({ exitCode: 1 });
    if (!('output' in unresolvedResult)) throw new Error(unresolvedResult.error);
    expect(JSON.parse(unresolvedResult.output)).toMatchObject({
      affectedPrincipals: ['principal-known-without-epoch'],
      affectedTenants: ['tenant-known'],
      answerability: { complete: false, reason: expect.stringContaining('unresolved principal') },
      status: 'unanswerable',
    });

    const unrecordable = fixture([
      {
        ...event('unused', null),
        principal: {
          epoch: null,
          id: null,
          kind: 'unresolved',
          reason: 'principal-unrecordable',
          tenant: null,
        },
      },
    ]);
    const unrecordableResult = runFixture(unrecordable);
    expect(unrecordableResult).toMatchObject({ exitCode: 1 });
    if (!('output' in unrecordableResult)) throw new Error(unrecordableResult.error);
    expect(JSON.parse(unrecordableResult.output)).toMatchObject({
      affectedPrincipals: [],
      affectedTenants: [],
      answerability: { complete: false, reason: expect.stringContaining('unresolved principal') },
      status: 'unanswerable',
    });
  });

  it('rejects forged fields through the server verifier and the CLI', () => {
    const files = fixture([event('principal-a', 'tenant-a')]);
    const document = JSON.parse(readFileSync(files.eventsPath, 'utf8')) as {
      events: Array<{ outcome: 'allow' | 'deny' }>;
    };
    const verifier = createSecurityEventRecordVerifier({
      deploymentId: TEST_DEPLOYMENT_ID,
      secret: TEST_SECRET,
    });
    expect(verifier.verify(document.events[0])).toBe(true);

    document.events[0]!.outcome = 'deny';
    expect(verifier.verify(document.events[0])).toBe(false);
    writeFileSync(files.eventsPath, canonicalJsonStringify(document));

    const result = runFixture(files);
    expect(result).toMatchObject({ exitCode: 1 });
    if (!('error' in result)) throw new Error(result.output);
    expect(result.error).toContain('security-event record[0] MAC verification failed');
  });

  it('requires the exact deployment verification material and has no unverified fallback', () => {
    const files = fixture([event('principal-a', 'tenant-a')]);
    for (const environment of [
      {},
      { KOVO_ATTESTATION_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID },
      { KOVO_ATTESTATION_SECRET: TEST_SECRET },
    ]) {
      const result = runFixture(files, environment);
      expect(result).toMatchObject({ exitCode: 1 });
      if (!('error' in result)) throw new Error(result.output);
      expect(result.error).toContain(
        'security-event verification requires KOVO_ATTESTATION_DEPLOYMENT_ID and KOVO_ATTESTATION_SECRET',
      );
    }

    for (const environment of [
      {
        KOVO_ATTESTATION_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID,
        KOVO_ATTESTATION_SECRET: 'wrong-incident-scope-secret-0123456789abcdef0123456789abcdef',
      },
      {
        KOVO_ATTESTATION_DEPLOYMENT_ID: 'deployment:wrong-incident-scope',
        KOVO_ATTESTATION_SECRET: TEST_SECRET,
      },
    ]) {
      const result = runFixture(files, environment);
      expect(result).toMatchObject({ exitCode: 1 });
      if (!('error' in result)) throw new Error(result.output);
      expect(result.error).toContain('security-event record[0] MAC verification failed');
    }
  });

  it('accepts a deployment-authenticated empty export but rejects whole-chain replacement', () => {
    const empty = fixture([]);
    const valid = runFixture(empty);
    expect(valid).toMatchObject({ exitCode: 0 });
    if (!('output' in valid)) throw new Error(valid.error);
    expect(JSON.parse(valid.output)).toMatchObject({ matchedEvents: 0, status: 'not-observed' });

    const populated = fixture([event('principal-a', 'tenant-a')]);
    const document = JSON.parse(readFileSync(populated.eventsPath, 'utf8')) as {
      events: unknown[];
      head: {
        dropped: number;
        sequence: number;
        tailKeyId: string | null;
        tailMac: string | null;
      };
    };
    document.events = [];
    document.head.dropped = 0;
    document.head.sequence = 0;
    document.head.tailKeyId = null;
    document.head.tailMac = null;
    writeFileSync(populated.eventsPath, canonicalJsonStringify(document));

    const replaced = runFixture(populated);
    expect(replaced).toMatchObject({ exitCode: 1 });
    if (!('error' in replaced)) throw new Error(replaced.output);
    expect(replaced.error).toContain('security-event export head MAC verification failed');
  });

  it('rejects tail truncation even when unauthenticated head facts are rewritten to match', () => {
    const files = fixture([event('principal-a', 'tenant-a'), event('principal-b', 'tenant-b')]);
    const document = JSON.parse(readFileSync(files.eventsPath, 'utf8')) as {
      events: Array<{ keyId: string; mac: string; sequence: number }>;
      head: {
        dropped: number;
        sequence: number;
        tailKeyId: string | null;
        tailMac: string | null;
      };
    };
    document.events.pop();
    const retainedTail = document.events[0]!;
    document.head.sequence = retainedTail.sequence;
    document.head.tailKeyId = retainedTail.keyId;
    document.head.tailMac = retainedTail.mac;
    writeFileSync(files.eventsPath, canonicalJsonStringify(document));

    const result = runFixture(files);
    expect(result).toMatchObject({ exitCode: 1 });
    if (!('error' in result)) throw new Error(result.output);
    expect(result.error).toContain('security-event export head MAC verification failed');
  });

  it('rejects an authenticated empty export under the wrong deployment key', () => {
    const files = fixture([]);
    const result = runFixture(files, {
      KOVO_ATTESTATION_DEPLOYMENT_ID: TEST_DEPLOYMENT_ID,
      KOVO_ATTESTATION_SECRET: 'wrong-incident-scope-secret-0123456789abcdef0123456789abcdef',
    });
    expect(result).toMatchObject({ exitCode: 1 });
    if (!('error' in result)) throw new Error(result.output);
    expect(result.error).toContain('security-event export head MAC verification failed');
  });

  it('fails closed on a broken append-only chain even when each record is genuine', () => {
    const files = fixture([event('principal-a', 'tenant-a'), event('principal-b', 'tenant-b')]);
    const other = fixture([event('principal-x', 'tenant-x'), event('principal-y', 'tenant-y')]);
    const document = JSON.parse(readFileSync(files.eventsPath, 'utf8')) as {
      events: unknown[];
      head: unknown;
    };
    const otherDocument = JSON.parse(readFileSync(other.eventsPath, 'utf8')) as {
      events: unknown[];
      head: unknown;
    };
    document.events[1] = otherDocument.events[1];
    document.head = otherDocument.head;
    writeFileSync(files.eventsPath, canonicalJsonStringify(document));

    const result = runFixture(files);
    expect(result).toMatchObject({ exitCode: 1 });
    if (!('error' in result)) throw new Error(result.output);
    expect(result.error).toContain('security-event chain is not contiguous');
  });

  it('uses NOT-OBSERVED language instead of claiming no impact', () => {
    const files = fixture([event('principal-a', null, 'framework:authorization:other-site')]);
    const result = runFixture(files);
    expect(result).toMatchObject({ exitCode: 0 });
    if (!('output' in result)) throw new Error(result.error);
    expect(JSON.parse(result.output)).toMatchObject({
      answerability: {
        complete: true,
        reason: 'no matching event was observed; this is not a no-impact claim',
      },
      status: 'not-observed',
    });
    expect(result.output).not.toContain('no impact');
  });
});
