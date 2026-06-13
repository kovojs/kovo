import { describe, expect, it } from 'vitest';

import {
  fwExplainComponentAssertionFact,
  fwExplainComponentDeriveFacts,
  fwExplainComponentHandlerFacts,
  fwExplainComponentMergeFacts,
  fwExplainComponentTriggerFacts,
  fwExplainEndpointAssertionFact,
  fwExplainEndpointFacts,
  fwExplainField,
  fwExplainListField,
  fwExplainMutationAssertionFact,
  fwExplainMutationQueryMatrixFact,
  fwExplainOptimisticStatuses,
  fwExplainPageAssertionFact,
  fwExplainQueryAssertionFact,
  fwExplainRecords,
  fwExplainScopeAuditAssertionFact,
  fwExplainScopeAuditFacts,
  fwExplainSummary,
  fwExplainUnguardedAssertionFact,
  fwExplainUnguardedFacts,
  fwExplainUpdateConsumerMap,
  fwExplainUpdateConsumers,
  fwExplainUpdateTargets,
  parseFwExplainOutput,
} from './fw-explain-fixtures.js';

const fixture = [
  'fw-explain/v1',
  'MUTATION cart/add',
  'guards: authed',
  'session: commerceSession',
  'input-fields: productId,quantity',
  'writes: cart',
  'invalidates: cart,product',
  'manual-invalidates: -',
  'updates: cart->component:CartBadge,page:/cart; product->page:/products',
  'OPTIMISTIC cart await-fragment',
  'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
  '',
].join('\n');

describe('@jiso/test fw explain fixture seam', () => {
  it('turns fw-explain/v1 output into structured field and record facts', () => {
    expect(parseFwExplainOutput(fixture)).toEqual({
      fields: [
        { key: 'guards', raw: 'guards: authed', value: 'authed' },
        { key: 'session', raw: 'session: commerceSession', value: 'commerceSession' },
        {
          key: 'input-fields',
          raw: 'input-fields: productId,quantity',
          value: 'productId,quantity',
        },
        { key: 'writes', raw: 'writes: cart', value: 'cart' },
        { key: 'invalidates', raw: 'invalidates: cart,product', value: 'cart,product' },
        { key: 'manual-invalidates', raw: 'manual-invalidates: -', value: '-' },
        {
          key: 'updates',
          raw: 'updates: cart->component:CartBadge,page:/cart; product->page:/products',
          value: 'cart->component:CartBadge,page:/cart; product->page:/products',
        },
      ],
      records: [
        { key: 'OPTIMISTIC', raw: 'OPTIMISTIC cart await-fragment', value: 'cart await-fragment' },
        {
          key: 'OPTIMISTIC-SUMMARY',
          raw: 'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
          value: 'total=1 hand-written=0 await-fragment=1 UNHANDLED=0',
        },
      ],
      subject: 'MUTATION cart/add',
      version: 'fw-explain/v1',
    });
  });

  it('exposes focused helpers for harness assertions without local output parsing', () => {
    expect(fwExplainField(fixture, 'session')).toBe('commerceSession');
    expect(fwExplainListField(fixture, 'input-fields')).toEqual(['productId', 'quantity']);
    expect(fwExplainRecords(fixture, 'OPTIMISTIC')).toEqual(['cart await-fragment']);
    expect(fwExplainOptimisticStatuses(fixture)).toEqual({ cart: 'await-fragment' });
    expect(fwExplainSummary(fixture, 'OPTIMISTIC-SUMMARY')).toMatchObject({
      UNHANDLED: '0',
      'await-fragment': '1',
      total: '1',
    });
    expect(fwExplainUpdateTargets(fixture)).toEqual([
      'cart->component:CartBadge,page:/cart',
      'product->page:/products',
    ]);
    expect(fwExplainUpdateConsumers(fixture)).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['page:/products'], query: 'product' },
    ]);
    expect(Object.fromEntries(fwExplainUpdateConsumerMap(fixture))).toEqual({
      cart: ['component:CartBadge', 'page:/cart'],
      product: ['page:/products'],
    });
    expect(
      fwExplainListField('fw-explain/v1\nMUTATION order/receipt\nupdates: -\n', 'updates'),
    ).toEqual([]);
    expect(fwExplainUpdateTargets('fw-explain/v1\nMUTATION order/receipt\nupdates: -\n')).toEqual(
      [],
    );
    expect(fwExplainUpdateConsumers('fw-explain/v1\nMUTATION order/receipt\nupdates: -\n')).toEqual(
      [],
    );
    expect(
      fwExplainEndpointFacts(
        [
          'fw-explain/v1',
          'ENDPOINTS',
          'ENDPOINT payment/stripe method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe:v1:hmac-sha256 csrf=exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256 writes=order',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      {
        auth: 'verifier:stripe:v1:hmac-sha256',
        csrf: 'exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256',
        endpoint: 'payment/stripe',
        method: 'POST',
        mount: 'exact',
        path: '/webhooks/stripe',
        writes: ['order'],
      },
    ]);
    expect(
      fwExplainScopeAuditFacts(
        [
          'fw-explain/v1',
          'UNSCOPED',
          'UNSCOPED QUERY attachments/download domain=attachment scope=unscoped site=examples/commerce/src/app.ts:10 attachment download filters id plus session user',
          '',
        ].join('\n'),
        'UNSCOPED',
      ),
    ).toEqual([
      {
        domain: 'attachment',
        reason: 'attachment download filters id plus session user',
        scope: 'unscoped',
        site: 'examples/commerce/src/app.ts:10',
        target: 'attachments/download',
        targetKind: 'QUERY',
      },
    ]);
  });

  it('exposes rawless assertion facts for query, mutation, and page explanations', () => {
    expect(fwExplainMutationAssertionFact({ exitCode: 0, output: fixture })).toEqual({
      exitCode: 0,
      guards: ['authed'],
      inputFields: ['productId', 'quantity'],
      invalidates: ['cart', 'product'],
      manualInvalidates: [],
      optimisticStatuses: { cart: 'await-fragment' },
      optimisticSummary: {
        UNHANDLED: '0',
        'await-fragment': '1',
        'hand-written': '0',
        total: '1',
      },
      session: 'commerceSession',
      subject: 'MUTATION cart/add',
      updateConsumers: [
        { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
        { consumers: ['page:/products'], query: 'product' },
      ],
      version: 'fw-explain/v1',
      writes: ['cart'],
    });
    expect(
      fwExplainMutationAssertionFact({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'MUTATION order/receipt',
          'guards: authed',
          'session: commerceSession',
          'enctype: multipart/form-data',
          'input-fields: orderId,receipt',
          'file-fields: receipt',
          'writes: attachment',
          'invalidates: -',
          'manual-invalidates: -',
          'updates: -',
          '',
        ].join('\n'),
      }),
    ).toEqual({
      enctype: 'multipart/form-data',
      exitCode: 0,
      fileFields: ['receipt'],
      guards: ['authed'],
      inputFields: ['orderId', 'receipt'],
      invalidates: [],
      manualInvalidates: [],
      session: 'commerceSession',
      subject: 'MUTATION order/receipt',
      updateConsumers: [],
      version: 'fw-explain/v1',
      writes: ['attachment'],
    });
    expect(
      fwExplainQueryAssertionFact({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'QUERY cart',
          'reads: cart',
          'consumers: component:CartBadge,page:/cart',
          'invalidated-by: cart/add',
          'domain-writes: cart.addItem',
          '',
        ].join('\n'),
      }),
    ).toEqual({
      consumers: ['component:CartBadge', 'page:/cart'],
      domainWrites: ['cart.addItem'],
      exitCode: 0,
      invalidatedBy: ['cart/add'],
      reads: ['cart'],
      subject: 'QUERY cart',
      version: 'fw-explain/v1',
    });
    expect(
      fwExplainPageAssertionFact({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'PAGE /cart',
          'prefetch: false',
          'meta: title=Cart description=Ready image=-',
          'i18n: en-US:cartTitle',
          'modulepreloads: -',
          'stylesheets: /src/styles.css',
          'queries: cart',
          'view-transitions: -',
          '',
        ].join('\n'),
      }),
    ).toEqual({
      exitCode: 0,
      i18n: ['en-US:cartTitle'],
      meta: 'title=Cart description=Ready image=-',
      modulepreloads: [],
      prefetch: 'false',
      queries: ['cart'],
      stylesheets: ['/src/styles.css'],
      subject: 'PAGE /cart',
      version: 'fw-explain/v1',
      viewTransitions: [],
    });
  });

  it('exposes rawless assertion facts for endpoint and scope audit explanations', () => {
    const componentOutput = [
      'fw-explain/v1',
      'COMPONENT CartBadge',
      'queries: cart',
      'fragments: cart-badge',
      'HANDLER click export=CartBadge$button_click ref=/components/cart-badge.js#CartBadge$button_click captures=ctx,element-params params=itemId substitution=-',
      'DERIVE CartBadge$isEmpty inputs=cart ref=/components/cart-badge.js#CartBadge$isEmpty target=data-bind:hidden',
      'TRIGGER visible export=CartBadge$mountChart ref=/components/cart-badge.js#CartBadge$mountChart deps=cart justification=charts are below the fold',
      'MERGE button attr=aria-expanded rule=primitive-owned decision=primitive diagnostics=-',
      'MERGE button attr=data-bind:hidden rule=single-binding-writer decision=diagnostic diagnostics=FW233',
      '',
    ].join('\n');

    expect(fwExplainComponentHandlerFacts(componentOutput)).toEqual([
      {
        captures: ['ctx', 'element-params'],
        event: 'click',
        exportName: 'CartBadge$button_click',
        params: ['itemId'],
        ref: '/components/cart-badge.js#CartBadge$button_click',
        substitution: '-',
      },
    ]);
    expect(fwExplainComponentDeriveFacts(componentOutput)).toEqual([
      {
        inputs: ['cart'],
        name: 'CartBadge$isEmpty',
        ref: '/components/cart-badge.js#CartBadge$isEmpty',
        target: 'data-bind:hidden',
      },
    ]);
    expect(fwExplainComponentTriggerFacts(componentOutput)).toEqual([
      {
        deps: ['cart'],
        exportName: 'CartBadge$mountChart',
        justification: 'charts are below the fold',
        ref: '/components/cart-badge.js#CartBadge$mountChart',
        trigger: 'visible',
      },
    ]);
    expect(fwExplainComponentMergeFacts(componentOutput)).toEqual([
      {
        attr: 'aria-expanded',
        decision: 'primitive',
        diagnostics: [],
        element: 'button',
        rule: 'primitive-owned',
      },
      {
        attr: 'data-bind:hidden',
        decision: 'diagnostic',
        diagnostics: ['FW233'],
        element: 'button',
        rule: 'single-binding-writer',
      },
    ]);
    expect(fwExplainComponentAssertionFact({ exitCode: 0, output: componentOutput })).toEqual({
      derives: [
        {
          inputs: ['cart'],
          name: 'CartBadge$isEmpty',
          ref: '/components/cart-badge.js#CartBadge$isEmpty',
          target: 'data-bind:hidden',
        },
      ],
      exitCode: 0,
      fragments: ['cart-badge'],
      handlers: [
        {
          captures: ['ctx', 'element-params'],
          event: 'click',
          exportName: 'CartBadge$button_click',
          params: ['itemId'],
          ref: '/components/cart-badge.js#CartBadge$button_click',
          substitution: '-',
        },
      ],
      merges: [
        {
          attr: 'aria-expanded',
          decision: 'primitive',
          diagnostics: [],
          element: 'button',
          rule: 'primitive-owned',
        },
        {
          attr: 'data-bind:hidden',
          decision: 'diagnostic',
          diagnostics: ['FW233'],
          element: 'button',
          rule: 'single-binding-writer',
        },
      ],
      queries: ['cart'],
      subject: 'COMPONENT CartBadge',
      triggers: [
        {
          deps: ['cart'],
          exportName: 'CartBadge$mountChart',
          justification: 'charts are below the fold',
          ref: '/components/cart-badge.js#CartBadge$mountChart',
          trigger: 'visible',
        },
      ],
      version: 'fw-explain/v1',
    });
    expect(
      fwExplainEndpointAssertionFact({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'ENDPOINTS',
          'ENDPOINT payment/stripe method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe:v1:hmac-sha256 csrf=exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256 writes=order',
          'SUMMARY total=1',
          '',
        ].join('\n'),
      }),
    ).toEqual({
      endpoints: [
        {
          auth: 'verifier:stripe:v1:hmac-sha256',
          csrf: 'exempt:payment/stripe webhook verifier stripe:v1:hmac-sha256',
          endpoint: 'payment/stripe',
          method: 'POST',
          mount: 'exact',
          path: '/webhooks/stripe',
          writes: ['order'],
        },
      ],
      exitCode: 0,
      subject: 'ENDPOINTS',
      summary: { total: '1' },
      version: 'fw-explain/v1',
    });
    expect(
      fwExplainScopeAuditAssertionFact({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'UNSCOPED',
          'UNSCOPED QUERY attachments/download domain=attachment scope=unscoped site=examples/commerce/src/app.ts:10 attachment download filters id plus session user',
          'SUMMARY total=1',
          '',
        ].join('\n'),
      }),
    ).toEqual({
      exitCode: 0,
      records: [
        {
          domain: 'attachment',
          reason: 'attachment download filters id plus session user',
          scope: 'unscoped',
          site: 'examples/commerce/src/app.ts:10',
          target: 'attachments/download',
          targetKind: 'QUERY',
        },
      ],
      subject: 'UNSCOPED',
      summary: { total: '1' },
      version: 'fw-explain/v1',
    });
    expect(
      fwExplainUnguardedFacts(
        [
          'fw-explain/v1',
          'UNGUARDED',
          'ENDPOINT health method=GET path=/health mount=exact auth=- csrf=checked',
          'MUTATION cart/add guards=- writes=cart invalidates=- manual-invalidates=-',
          'PAGE /cart guards=- queries=cart',
          'QUERY cart guards=- reads=cart',
          'SUMMARY total=4',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      {
        fields: { auth: '-', csrf: 'checked', method: 'GET', mount: 'exact', path: '/health' },
        target: 'health',
        targetKind: 'ENDPOINT',
      },
      {
        fields: { guards: [], invalidates: [], 'manual-invalidates': [], writes: ['cart'] },
        target: 'cart/add',
        targetKind: 'MUTATION',
      },
      {
        fields: { guards: [], queries: ['cart'] },
        target: '/cart',
        targetKind: 'PAGE',
      },
      {
        fields: { guards: [], reads: ['cart'] },
        target: 'cart',
        targetKind: 'QUERY',
      },
    ]);
    expect(
      fwExplainUnguardedAssertionFact({
        exitCode: 0,
        output: [
          'fw-explain/v1',
          'UNGUARDED',
          'QUERY cart guards=- reads=cart',
          'SUMMARY total=1',
          '',
        ].join('\n'),
      }),
    ).toEqual({
      exitCode: 0,
      records: [
        {
          fields: { guards: [], reads: ['cart'] },
          target: 'cart',
          targetKind: 'QUERY',
        },
      ],
      subject: 'UNGUARDED',
      summary: { total: '1' },
      version: 'fw-explain/v1',
    });
  });

  it('derives mutation-query matrix facts from fw-explain outputs', () => {
    const graph = {
      mutations: [{ key: 'cart/add' }, { key: 'order/receipt' }],
      queries: [{ query: 'cart' }, { query: 'productGrid' }],
    };
    const outputs = new Map([
      [
        'cart/add',
        [
          'fw-explain/v1',
          'MUTATION cart/add',
          'updates: cart->component:CartBadge,page:/cart; productGrid->component:ProductGrid,page:/cart',
          'OPTIMISTIC cart hand-written',
          'OPTIMISTIC productGrid await-fragment',
          'OPTIMISTIC-SUMMARY total=2 hand-written=1 await-fragment=1 UNHANDLED=0',
          '',
        ].join('\n'),
      ],
      [
        'order/receipt',
        [
          'fw-explain/v1',
          'MUTATION order/receipt',
          'updates: -',
          'OPTIMISTIC-SUMMARY total=0 hand-written=0 await-fragment=0 UNHANDLED=0',
          '',
        ].join('\n'),
      ],
    ]);

    expect(
      fwExplainMutationQueryMatrixFact({
        explainMutation: (mutationKey) => ({
          exitCode: 0,
          output: outputs.get(mutationKey) ?? '',
        }),
        graph,
        invalidatedBy: new Map([
          ['cart', ['cart/add']],
          ['productGrid', ['cart/add']],
        ]),
      }),
    ).toEqual({
      matrix: {
        'cart/add': {
          cart: 'hand-written',
          productGrid: 'await-fragment',
        },
        'order/receipt': {
          cart: 'no-invalidation',
          productGrid: 'no-invalidation',
        },
      },
      staticInvalidationMismatches: [],
      unhandledMutations: [],
      updateQueriesByMutation: {
        'cart/add': ['cart', 'productGrid'],
        'order/receipt': [],
      },
    });
  });

  it('reports matrix mismatches and unhandled optimistic statuses as facts', () => {
    expect(
      fwExplainMutationQueryMatrixFact({
        explainMutation: () => ({
          exitCode: 0,
          output: [
            'fw-explain/v1',
            'MUTATION cart/add',
            'updates: cart->page:/cart',
            'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=0 UNHANDLED=1',
            '',
          ].join('\n'),
        }),
        graph: {
          mutations: [{ key: 'cart/add' }],
          queries: [{ query: 'cart' }, { query: 'productGrid' }],
        },
        invalidatedBy: new Map([
          ['cart', []],
          ['productGrid', ['cart/add']],
        ]),
      }),
    ).toMatchObject({
      matrix: {
        'cart/add': {
          cart: 'UNHANDLED',
          productGrid: 'no-invalidation',
        },
      },
      staticInvalidationMismatches: ['cart/add->cart', 'cart/add->productGrid'],
      unhandledMutations: ['cart/add'],
    });
  });

  it('rejects malformed explain output at the fixture seam', () => {
    expect(() => parseFwExplainOutput('fw-check/v1\nOK\n')).toThrow(
      'fw explain output starts with fw-explain/v1: fw-check/v1',
    );
    expect(() => parseFwExplainOutput('fw-explain/v1\n')).toThrow(
      'fw explain output includes a subject line',
    );
    expect(() => fwExplainField(fixture, 'missing')).toThrow('fw explain output includes missing:');
    expect(() => fwExplainSummary(fixture, 'MISSING')).toThrow(
      'fw explain output includes MISSING',
    );
    expect(() =>
      fwExplainOptimisticStatuses('fw-explain/v1\nMUTATION cart/add\nOPTIMISTIC cart\n'),
    ).toThrow("fw explain OPTIMISTIC record is '<query> <status>': cart");
    expect(() =>
      fwExplainUpdateConsumers('fw-explain/v1\nMUTATION cart/add\nupdates: cart\n'),
    ).toThrow("fw explain update target is '<query>-><consumers>': cart");
    expect(() => fwExplainEndpointFacts('fw-explain/v1\nENDPOINTS\nENDPOINT cart/add\n')).toThrow(
      'fw explain ENDPOINT record is',
    );
    expect(() =>
      fwExplainScopeAuditFacts('fw-explain/v1\nUNSCOPED\nUNSCOPED cart\n', 'UNSCOPED'),
    ).toThrow('fw explain UNSCOPED record is');
    expect(() =>
      fwExplainComponentHandlerFacts('fw-explain/v1\nCOMPONENT CartBadge\nHANDLER click\n'),
    ).toThrow('fw explain HANDLER record is');
    expect(() =>
      fwExplainComponentDeriveFacts('fw-explain/v1\nCOMPONENT CartBadge\nDERIVE value\n'),
    ).toThrow('fw explain DERIVE record is');
    expect(() =>
      fwExplainComponentTriggerFacts('fw-explain/v1\nCOMPONENT CartBadge\nTRIGGER visible\n'),
    ).toThrow('fw explain TRIGGER record is');
    expect(() =>
      fwExplainComponentMergeFacts('fw-explain/v1\nCOMPONENT CartBadge\nMERGE button\n'),
    ).toThrow('fw explain MERGE record is');
    expect(() => fwExplainUnguardedFacts('fw-explain/v1\nUNGUARDED\nQUERY\n')).toThrow(
      'fw explain UNGUARDED record includes a target',
    );
    expect(() => fwExplainUnguardedFacts('fw-explain/v1\nUNGUARDED\nQUERY cart guards\n')).toThrow(
      'fw explain record field is key=value',
    );
    expect(() =>
      fwExplainUnguardedAssertionFact({
        exitCode: 0,
        output: 'fw-explain/v1\nENDPOINTS\nSUMMARY total=0\n',
      }),
    ).toThrow('fw explain unguarded subject is UNGUARDED: ENDPOINTS');
    expect(() =>
      fwExplainScopeAuditAssertionFact({
        exitCode: 0,
        output: 'fw-explain/v1\nENDPOINTS\nSUMMARY total=0\n',
      }),
    ).toThrow('fw explain scope audit subject is UNGUARDED or UNSCOPED: ENDPOINTS');
  });
});
