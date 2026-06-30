import { describe, expect, it } from 'vitest';

import { scanStaticExportDocumentProtocol } from './static-export-protocol.js';

describe('server static export protocol scanner', () => {
  it('extracts typed protocol facts from parsed HTML elements and attributes', () => {
    const protocol = scanStaticExportDocumentProtocol(
      [
        '<main>',
        '<FORM METHOD=post ACTION=&sol;_m&sol;cart&sol;add data-mutation="cart/add" data-mutation-stream>',
        '<button>Add</button>',
        '</FORM>',
        "<A HREF='/_q/cart?args=1'>Refresh</A>",
        '<button formaction="/_m/cart/remove">Remove</button>',
        '<button on:CLICK="/c/cart.client.js?v=1#Cart$add /c/%2Fescape.client.js?v=bad#Bad$run">Client</button>',
        '<SCRIPT TYPE=module SRC="https://shop.example.test/c/bootstrap.client.js?v=2"></SCRIPT>',
        '<LINK REL="modulepreload alternate" HREF="/c/head.client.js?v=3">',
        '<kovo-query name="cart" key="cart:1">{"count":1}</kovo-query>',
        '<script type="application/json" kovo-query="reviews" key="reviews:p1">{"items":[]}</script>',
        '<kovo-defer target="reviews:p1">Loading</kovo-defer>',
        '--kovo-boundary',
        '<KOVO-FRAGMENT TARGET=reviews:p1><section>Ready</section></KOVO-FRAGMENT>',
        '<template><form action="/_m/template/add"><button on:click="/c/template.client.js?v=1#open">Template</button></form>--kovo-boundary</template>',
        '<pre><form action="/_m/pre/add"><button on:click="/c/pre.client.js?v=1#open">Pre</button></form>--kovo-boundary</pre>',
        '<a href="https://api.example.test/_q/remote">Remote API</a>',
        '</main>',
      ].join(''),
      'https://shop.example.test',
    );

    expect(protocol.endpointRefs).toEqual([
      {
        name: 'action',
        path: '/_m/cart/add',
        phase: 'mutation',
        value: '/_m/cart/add',
      },
      { name: 'href', path: '/_q/cart', phase: 'query', value: '/_q/cart?args=1' },
      {
        name: 'formaction',
        path: '/_m/cart/remove',
        phase: 'mutation',
        value: '/_m/cart/remove',
      },
    ]);
    expect(
      protocol.clientModuleRefs.map(({ href, name, source, value }) => ({
        href,
        name,
        source,
        value,
      })),
    ).toEqual([
      {
        href: '/c/cart.client.js?v=1#Cart$add',
        name: 'on:click',
        source: 'event-handler',
        value: '/c/cart.client.js?v=1#Cart$add',
      },
      {
        href: '/c/%2Fescape.client.js?v=bad#Bad$run',
        name: 'on:click',
        source: 'event-handler',
        value: '/c/%2Fescape.client.js?v=bad#Bad$run',
      },
      {
        href: '/c/bootstrap.client.js?v=2',
        name: 'src',
        source: 'module-script',
        value: 'https://shop.example.test/c/bootstrap.client.js?v=2',
      },
      {
        href: '/c/head.client.js?v=3',
        name: 'href',
        source: 'modulepreload-link',
        value: '/c/head.client.js?v=3',
      },
    ]);
    expect(protocol.deferredMarkers).toEqual([
      { kind: 'defer', target: 'reviews:p1', value: 'kovo-defer' },
      { kind: 'boundary', value: '--kovo-boundary' },
      { kind: 'fragment', target: 'reviews:p1', value: 'kovo-fragment' },
    ]);
    expect(protocol.queryScripts).toEqual([
      { key: 'cart:1', kind: 'kovo-query-element', name: 'cart' },
      { key: 'reviews:p1', kind: 'script-attribute', name: 'reviews' },
    ]);
    expect(protocol.mutationForms).toEqual([
      {
        action: '/_m/cart/add',
        dataMutation: 'cart/add',
        endpoint: {
          name: 'action',
          path: '/_m/cart/add',
          phase: 'mutation',
          value: '/_m/cart/add',
        },
        method: 'post',
        stream: true,
      },
    ]);
    expect(protocol.serverOnlyMarkers.map((marker) => marker.kind)).toEqual([
      'server-endpoint',
      'server-endpoint',
      'server-endpoint',
      'deferred-marker',
      'deferred-marker',
      'deferred-marker',
    ]);
  });
});
