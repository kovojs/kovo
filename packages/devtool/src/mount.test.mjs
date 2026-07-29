import { describe, expect, it, vi } from 'vitest';

vi.mock('@kovojs/server/custom-adapters', async () => {
  const { createRequestHandler } = await import('../../server/src/app.js');
  const { resolveKovoAppToken } = await import('../../server/src/app-token.js');
  return {
    createRequestHandler: (token) =>
      createRequestHandler(resolveKovoAppToken(token, 'devtool test request handler')),
  };
});

import { createDevtoolApp } from './mount.mjs';
import { createRuntimeFrameStore } from './runtime-frames.mjs';

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
    const { requestHandler } = createDevtoolApp({
      bundles: [bundle()],
      mode: 'development',
    });

    const response = await requestHandler(
      new Request('https://kovo.test/?app=demo&q=orders&sel=domain%3Aorders'),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<style>@font-face');
    expect(html).toMatch(
      /on:visible="\/c\/__v\/[a-f0-9]{64}\/devtool-pz\.client\.js#Devtool\$init"/u,
    );
    expect(html).toContain('data-node-id="domain:orders"');
    expect(html).toContain('data-runtime-panel');
    expect(html).toContain(
      'Values, keys, target identities, inputs, cookies, and bodies stay redacted.',
    );
    expect(html).not.toContain('</style><script>');
  });

  it('serves the same bounded frame store to the development UI and SSE stream', async () => {
    const runtimeFrames = createRuntimeFrameStore({ limit: 2 });
    const devtool = createDevtoolApp({
      bundles: [bundle()],
      mode: 'development',
      runtimeFrames,
    });
    const frame = devtool.runtimeFrames.recordRoundTrip({
      app: 'demo',
      phase: 'settled',
      queries: [
        {
          bytes: 32,
          delta: false,
          keyed: false,
          name: 'orders',
          raw: '{"secret":"not-in-debug-output"}',
          settlesPendingWork: false,
          value: 'redacted',
        },
      ],
      status: 200,
      url: '/_m/orders%2Frefresh',
    });
    const page = await devtool.requestHandler(new Request('https://kovo.test/?app=demo'));
    const html = await page.text();

    expect(html).toContain(`#${frame.sequence} · orders/refresh · queries orders`);
    expect(html).toContain('values redacted');
    expect(html).not.toContain('not-in-debug-output');

    const abort = new AbortController();
    const stream = await devtool.requestHandler(
      new Request('https://kovo.test/_runtime/frames?app=demo', {
        signal: abort.signal,
      }),
    );
    const reader = stream.body.getReader();
    let output = '';
    while (!output.includes('event: frame')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
    }
    await reader.cancel();
    abort.abort();

    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(output).toContain(JSON.stringify(frame));
    expect(output).not.toContain('not-in-debug-output');
  });

  it('omits runtime modules, markup, and endpoints in production mode', async () => {
    const devtool = createDevtoolApp({ bundles: [bundle()], mode: 'production' });
    const page = await devtool.requestHandler(new Request('https://kovo.test/?app=demo'));
    const html = await page.text();
    const endpoint = await devtool.requestHandler(
      new Request('https://kovo.test/_runtime/frames?app=demo'),
    );

    expect(devtool.runtimeFrames).toBeUndefined();
    expect(html).not.toContain('data-runtime-panel');
    expect(html).not.toContain('devtool-runtime.client.js');
    expect(endpoint.status).toBe(404);
    expect(endpoint.headers.get('content-type')).not.toContain('text/event-stream');
  });

  it('refuses an explicit live override under the production process posture', () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createDevtoolApp({ bundles: [bundle()], mode: 'development' })).toThrow(
        /unavailable in production/u,
      );
    } finally {
      if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnvironment;
    }
  });
});
