import { describe, expect, it } from 'vitest';

import { parseExplainArgs } from './graph-args.js';
import { kovoCheck, kovoExplain } from './graph-output.js';

describe('kovo explain --grants (Plan 3 §3.2 C13 anchor)', () => {
  it('parses the grant graph as an exclusive graph-backed explain mode', () => {
    expect(parseExplainArgs(['grants', 'graph.json'])).toEqual({
      artifact: false,
      format: 'human',
      inputPath: 'graph.json',
      ok: true,
      options: { view: 'grants' },
    });
    expect(parseExplainArgs(['grants', 'one.json', 'two.json'])).toMatchObject({ ok: false });
  });

  it('prints derived resources, decided transitions, and named budgeted escapes', () => {
    const result = kovoExplain(
      {
        grants: [
          {
            domain: 'membership',
            kind: 'resource',
            rightKinds: ['delegate', 'owner', 'read', 'write'],
            table: 'memberships',
          },
          {
            checkedStates: 16,
            kind: 'transition',
            mutation: 'membership.revoke',
            operation: 'delete',
            resource: 'memberships',
            site: 'src/grants.ts:20',
            verdict: 'attenuating',
          },
          {
            budget: 1,
            kind: 'escape',
            mutation: 'membership.grant',
            name: 'membership.grant:insert:memberships',
            operation: 'insert',
            resource: 'memberships',
            retainedObligation: 'review that the new right-set is authorized by current policy',
            site: 'src/grants.ts:21',
          },
        ],
      },
      { view: 'grants' },
    );

    expect(result).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'GRANTS',
        'RESOURCE memberships domain=membership rights=delegate,owner,read,write',
        'TRANSITION membership.revoke operation=delete resource=memberships verdict=attenuating checked-states=16 site="src/grants.ts:20"',
        'ESCAPE membership.grant:insert:memberships mutation=membership.grant operation=insert resource=memberships budget=1 retained-obligation="review that the new right-set is authorized by current policy" site="src/grants.ts:21"',
        'SUMMARY resources=1 delegations=0 transitions=1 escapes=1 top=0',
        '',
      ].join('\n'),
    });
  });

  it('makes a top transition fail kovo check with KV414', () => {
    const result = kovoCheck({
      grants: [
        {
          kind: 'transition',
          mutation: 'membership.opaque',
          operation: 'UNCLASSIFIED',
          reason: 'authz-bearing write escaped exact operation extraction',
          resource: 'memberships',
          site: 'src/grants.ts:30',
          verdict: 'top',
        },
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('ERROR KV414 GRANT membership.opaque');
    expect(result.output).toContain('fail-closed-top');
  });
});
