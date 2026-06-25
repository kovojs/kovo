import { describe, expect, it } from 'vitest';

import { renderPage } from './render.mjs';

describe('devtool renderPage', () => {
  it('escapes hostile input at HTML attribute sinks', () => {
    const hostile = `x" autofocus onfocus="alert(1)`;
    const html = renderPage({
      app: hostile,
      bundle: {
        app: hostile,
        counts: { component: 1, mutation: 1, query: 1 },
        edges: [
          {
            from: `query-${hostile}`,
            id: `edge-${hostile}`,
            kind: 'feeds',
            to: `component-${hostile}`,
          },
          {
            from: `component-${hostile}`,
            id: 'edge-2',
            kind: 'emits',
            to: `mutation-${hostile}`,
          },
        ],
        label: `Bundle ${hostile}`,
        nodes: [
          {
            data: { domains: [`domain-${hostile}`] },
            id: `query-${hostile}`,
            kind: 'query',
            label: `Query ${hostile}`,
            name: `queryName-${hostile}`,
          },
          {
            data: { domName: `section-${hostile}`, fragments: [`frag-${hostile}`] },
            id: `component-${hostile}`,
            kind: 'component',
            label: `Component ${hostile}`,
            name: `componentName-${hostile}`,
          },
          {
            data: {
              inputFields: [`field-${hostile}`],
              optimistic: [
                {
                  derivation: { reason: { code: hostile }, status: 'PUNTED' },
                  query: `queryName-${hostile}`,
                  status: 'hand-written',
                },
              ],
              writes: [`domain-${hostile}`],
            },
            id: `mutation-${hostile}`,
            kind: 'mutation',
            label: `Mutation ${hostile}`,
            name: `mutationName-${hostile}`,
          },
        ],
      },
      manifest: [{ blurb: `Blurb ${hostile}`, id: hostile, label: `App ${hostile}` }],
      pzHref: `/c/devtool.js" onclick="alert(1)`,
      q: hostile,
      sel: `component-${hostile}`,
    });

    expect(html).toContain('&quot;');
    expect(html).toContain('autofocus onfocus=&quot;alert(1)');
    expect(html).not.toContain(`value="${hostile}"`);
    expect(html).not.toContain(`href="?app=${hostile}`);
    expect(html).not.toContain(`on:visible="/c/devtool.js" onclick="alert(1)#Devtool$init"`);
    expect(html).not.toContain(`data-node-id="component-${hostile}"`);
  });
});
