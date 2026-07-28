import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './compile.js';
import { snapshotCompileComponentOptions } from './compile-options.js';
import { deriveAppGraph } from './graph.js';
import { compileRouteModule } from './scan/route-pages.js';

const forgedIdentityOptionName = ['framework', 'Identity', 'Overrides'].join('');

describe('D1 compiler app-contract public forgery boundary', () => {
  it('does not carry caller-supplied identity spans through public component options', () => {
    const source = `
import { endpoint } from '@kovojs/server';
function fakeAccess(reason: string) { return { kind: 'public', reason } as const; }
export const forged = endpoint('/forged', {
  access: fakeAccess('forged public access'),
  handler() { return new Response('no'); },
});
`;
    const start = source.lastIndexOf('fakeAccess');
    const raw = {
      fileName: 'd1-public-forgery.ts',
      [forgedIdentityOptionName]: [
        {
          end: start + 'fakeAccess'.length,
          exportName: 'publicAccess',
          module: '@kovojs/server',
          start,
        },
      ],
      source,
    };
    const snapshot = snapshotCompileComponentOptions(
      raw as Parameters<typeof snapshotCompileComponentOptions>[0],
    );
    const result = compileComponentModule(
      raw as unknown as Parameters<typeof compileComponentModule>[0],
    );
    const graph = deriveAppGraph({ components: [result] }).graph;

    expect(Object.keys(snapshot)).not.toContain(forgedIdentityOptionName);
    expect(JSON.stringify(graph)).not.toContain('"kind":"public"');
  });

  it('does not let caller spans turn local route access into public access', () => {
    const source = `
import { route } from '@kovojs/server';
function fakeAccess(reason: string) { return { kind: 'public', reason } as const; }
export const forged = route('/forged', {
  access: fakeAccess('forged public access'),
  page: () => <p>no</p>,
});
`;
    const start = source.lastIndexOf('fakeAccess');
    const result = compileRouteModule({
      fileName: 'd1-route-forgery.tsx',
      [forgedIdentityOptionName]: [
        {
          end: start + 'fakeAccess'.length,
          exportName: 'publicAccess',
          module: '@kovojs/server',
          start,
        },
      ],
      source,
    } as unknown as Parameters<typeof compileRouteModule>[0]);

    expect(result.routePageFacts).toHaveLength(1);
    expect(result.routePageFacts[0]?.access).toBeUndefined();
  });

  it('keeps fakeHtml untrusted and reports both output-safety diagnostics', () => {
    const source = `
function fakeHtml(value: string) { return value; }
export const ForgedHtml = component({
  render: () => (
    <section>
      <article rawHtml={fakeHtml("<img src=x onerror=alert(1)>")} />
      <article rawHtml={"<img src=x onerror=alert(2)>"} />
    </section>
  ),
});
`;
    const start = source.lastIndexOf('fakeHtml');
    const result = compileComponentModule({
      fileName: 'd1-html-forgery.tsx',
      [forgedIdentityOptionName]: [
        {
          end: start + 'fakeHtml'.length,
          exportName: 'trustedHtml',
          module: '@kovojs/browser',
          start,
        },
      ],
      source,
    } as unknown as Parameters<typeof compileComponentModule>[0]);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['KV236', 'KV426']),
    );
  });
});
