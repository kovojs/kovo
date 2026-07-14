import { describe, expect, it, vi } from 'vitest';

vi.mock('@kovojs/server', async (importOriginal) => ({
  ...(await importOriginal()),
  createRequestHandler: (await import('@kovojs/server/internal/app-shell-vite'))
    .createRequestHandler,
}));

import { createDevtoolApp } from './mount.mjs';

function bundle() {
  return {
    app: 'demo',
    blurb: 'Mounted devtool fixture',
    counts: { domain: 1 },
    edges: [],
    label: 'Demo',
    nodes: [
      {
        data: {},
        id: 'domain:orders',
        kind: 'domain',
        label: 'Orders',
        name: 'orders',
        source: null,
      },
    ],
  };
}

describe('createDevtoolApp', () => {
  it('serves the bundled stylesheet through the encoded mount-owned raw-text boundary', async () => {
    const { requestHandler } = createDevtoolApp({ bundles: [bundle()] });

    const response = await requestHandler(
      new Request('https://kovo.test/?app=demo&q=orders&sel=domain%3Aorders'),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<style>@font-face');
    expect(html).toContain('on:visible="/c/__v/pz-r1/devtool-pz.client.js#Devtool$init"');
    expect(html).toContain('data-node-id="domain:orders"');
    expect(html).not.toContain('</style><script>');
  });
});
