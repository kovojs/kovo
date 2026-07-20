import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import { afterEach, describe, expect, it } from 'vitest';

import { createSecurityEventCryptoHandle } from '../../../server/src/crypto-authority.js';
import {
  createSecurityEventJournal,
  type SecurityDecisionEventInput,
  type SecurityEventInput,
} from '../../../server/src/security-event.js';
import { parseIncidentArgs, runIncidentScopeCommand } from './incident-scope.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const authority = createSecurityEventCryptoHandle(
  'incident-scope-cli-test-secret-0123456789abcdef0123456789abcdef',
  'deployment:incident-scope-test',
);

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
      head: journal.head(),
      schema: 'kovo-security-event-export/v1',
    }),
  );
  return { advisoryPath, eventsPath, root };
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
    const result = runIncidentScopeCommand(
      { advisoryPath: files.advisoryPath, eventsPath: files.eventsPath },
      files.root,
    );

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

  it('reports unanswerable within covered doors for bypasses, dropped history, and unresolved principals', () => {
    const outside = fixture([], { advisory: advisory('outside-covered-doors') });
    const outsideResult = runIncidentScopeCommand(
      { advisoryPath: outside.advisoryPath, eventsPath: outside.eventsPath },
      outside.root,
    );
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
    const droppedResult = runIncidentScopeCommand(
      { advisoryPath: dropped.advisoryPath, eventsPath: dropped.eventsPath },
      dropped.root,
    );
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
    const unresolvedResult = runIncidentScopeCommand(
      { advisoryPath: unresolved.advisoryPath, eventsPath: unresolved.eventsPath },
      unresolved.root,
    );
    expect(unresolvedResult).toMatchObject({ exitCode: 1 });
    if (!('output' in unresolvedResult)) throw new Error(unresolvedResult.error);
    expect(JSON.parse(unresolvedResult.output)).toMatchObject({
      affectedPrincipals: ['principal-known-without-epoch'],
      affectedTenants: ['tenant-known'],
      answerability: { complete: false, reason: expect.stringContaining('unresolved principal') },
      status: 'unanswerable',
    });
  });

  it('fails closed on malformed facts or a broken append-only chain', () => {
    const files = fixture([event('principal-a', 'tenant-a'), event('principal-b', 'tenant-b')]);
    const document = JSON.parse(readFileSync(files.eventsPath, 'utf8')) as {
      events: Array<{ previousMac: string | null }>;
    };
    document.events[1]!.previousMac = 'tampered';
    writeFileSync(files.eventsPath, canonicalJsonStringify(document));

    const result = runIncidentScopeCommand(
      { advisoryPath: files.advisoryPath, eventsPath: files.eventsPath },
      files.root,
    );
    expect(result).toMatchObject({ exitCode: 1 });
    if (!('error' in result)) throw new Error(result.output);
    expect(result.error).toContain('security-event chain is not contiguous');
  });

  it('uses NOT-OBSERVED language instead of claiming no impact', () => {
    const files = fixture([event('principal-a', null, 'framework:authorization:other-site')]);
    const result = runIncidentScopeCommand(
      { advisoryPath: files.advisoryPath, eventsPath: files.eventsPath },
      files.root,
    );
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
