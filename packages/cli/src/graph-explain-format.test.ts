import { describe, expect, it } from 'vitest';

import { accessLine, capabilityLine } from './graph-explain-format.js';

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
});
