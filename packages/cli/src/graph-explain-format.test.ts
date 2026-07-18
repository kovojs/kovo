import { describe, expect, it } from 'vitest';

import { accessLine, capabilityClosureLine, capabilityLine } from './graph-explain-format.js';

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
});
