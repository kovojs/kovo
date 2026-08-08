import { describe, expect, it } from 'vitest';

import {
  accessLine,
  capabilityClosureLine,
  capabilityLine,
  diagnosticsForTouchGraph,
  opaqueProtocolSinkExplanation,
  unregisteredSinkLine,
} from './graph-explain-format.js';

describe('graph explain formatters', () => {
  it('keeps access fact output stable', () => {
    expect(
      accessLine({
        decision: 'public',
        detail: 'marketing page',
        justification: 'public launch surface',
        kind: 'page',
        name: '/pricing',
        site: 'app/routes.tsx:12:4',
        source: 'route-access',
      }),
    ).toBe(
      'ACCESS PAGE /pricing decision=public source=route-access site=app/routes.tsx:12:4 detail="marketing page" justification="public launch surface"',
    );
  });

  it('keeps capability fact output stable', () => {
    expect(
      capabilityLine({
        justification: 'operator download',
        kind: 'downloadUrl',
        moduleSpecifier: '@app/files',
        site: 'app/files.ts:8:10',
        target: 'reports',
      }),
    ).toBe(
      'CAPABILITY kind=downloadUrl site=app/files.ts:8:10 module=@app/files target=reports justification="operator download"',
    );
  });

  it('prints the exact structured obligation and scanner-owned identity', () => {
    expect(
      capabilityLine({
        kind: 'serverValue',
        obligation: {
          evidence: {
            digest: `sha256:${'a'.repeat(64)}`,
            kind: 'test',
            reference: 'tests/authz/admin-role-grant',
          },
          invariant: 'governed-write.authorized-principal',
          why: { guard: 'guards.role:admin', kind: 'guard-chain' },
        },
        site: 'app/admin.ts:8',
        siteIdentity: 'app/admin.ts:120:420',
        target: 'trustedAssign',
      }),
    ).toBe(
      `CAPABILITY kind=serverValue site=app/admin.ts:8 module=- target=trustedAssign justification=- siteIdentity="app/admin.ts:120:420" obligation={"evidence":{"digest":"sha256:${'a'.repeat(64)}","kind":"test","reference":"tests/authz/admin-role-grant"},"invariant":"governed-write.authorized-principal","why":{"guard":"guards.role:admin","kind":"guard-chain"}}`,
    );
  });

  it('prints capability-closure provenance without hiding the failing edge', () => {
    expect(
      capabilityClosureLine({
        capability: 'network',
        kind: 'closed',
        module: 'src/routes/webhook.ts',
        name: 'billing',
        path: ['webhook:billing', 'src/lib/send.ts', 'package:raw-http'],
        reason: 'package summary is absent',
        rootKind: 'webhook',
        site: 'src/lib/send.ts:4:1',
        status: 'unresolved',
      }),
    ).toBe(
      'CLOSED root=webhook:"billing" capability=network module=src/routes/webhook.ts site=src/lib/send.ts:4:1 path="webhook:billing -> src/lib/send.ts -> package:raw-http" reason="package summary is absent"',
    );
  });

  // plans/good-perf.md DevEx defect 5: KV424 opaque-protocol rows teach the actual provenance
  // rule (destructured callback parameter accepted, property read on the parameter refused)
  // instead of the generic dangerous-output-sink help about raw HTML/eval/child_process.
  it('explains the opaque-protocol provenance rule on KV424 rows', () => {
    const line = unregisteredSinkLine({
      safePath:
        'use compiler-provable plain data or keep every authored protocol hook inside the authoritative app snapshot',
      sink: 'request-handler.opaque-protocol',
      site: 'src/app.tsx:314',
      source: '<property-getter:candidate>',
    });

    expect(line).toContain(
      'ERROR KV424 src/app.tsx:314 sink=request-handler.opaque-protocol source=<property-getter:candidate>',
    );
    expect(line).toContain('a hook site is accepted only when the compiler proves the receiver is plain data');
    expect(line).toContain('destructuring the same field at the callback parameter (({ slug }) => ...) is accepted');
    // The generic output-sink help would mislead here and must not be attached to this family.
    expect(line).not.toContain('raw HTML');
  });

  it('keeps the generic KV424 help for non-protocol sink families', () => {
    expect(
      opaqueProtocolSinkExplanation({ sink: 'child_process.spawnSync' }),
    ).toBeUndefined();
    const line = unregisteredSinkLine({
      safePath: 'runCommand(cmd(...), ...)',
      sink: 'child_process.spawnSync',
      site: 'app.mjs:10',
      source: "'true'",
    });
    expect(line).toContain('ERROR KV424 app.mjs:10 sink=child_process.spawnSync');
    expect(line).toContain('raw HTML');
  });

  it('fails closed when a tampered touch graph carries an unregistered diagnostic code', () => {
    const unregisteredCode = `KV${999}`;
    expect(() =>
      diagnosticsForTouchGraph({
        tampered: {
          touches: [],
          unresolved: [{ code: unregisteredCode, message: 'forged', site: 'forged.ts:1:1' }],
        },
      } as never),
    ).toThrow(`Unregistered touch-graph diagnostic code: ${unregisteredCode}`);
  });
});
