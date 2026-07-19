import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { kovoExplain, main } from './index.js';

describe('kovo explain', () => {
  it('explains component handlers, query consumers, and fragment targets', () => {
    expect(
      kovoExplain(
        {
          components: [
            {
              attributeMerges: [
                {
                  attr: 'aria-expanded',
                  decision: 'author-wins',
                  diagnostics: ['KV232'],
                  element: 'button',
                  rule: 'aria-author-override',
                },
                {
                  attr: 'data-bind:hidden',
                  decision: 'error',
                  diagnostics: ['KV233'],
                  element: 'button',
                  rule: 'binding-target-conflict',
                },
              ],
              clocks: [
                { cadence: "every='1s'", name: 'ago' },
                { cadence: 'renderOnce', name: 'pub' },
              ],
              derives: [
                {
                  inputs: ['cart'],
                  name: 'CartBadge$isEmpty',
                  ref: '/c/cart-badge.client.js#CartBadge$isEmpty',
                  target: 'button[data-bind:disabled]',
                },
              ],
              disambiguatedDomName: 'components/cart/cart-badge/cart-badge',
              domName: 'cart-badge',
              fragments: ['cart-badge'],
              handlers: [
                {
                  captures: ['ctx', 'element-params'],
                  event: 'click',
                  exportName: 'CartBadge$button_click',
                  params: ['itemId'],
                  ref: '/c/cart-badge.client.js#CartBadge$button_click',
                },
              ],
              name: 'CartBadge',
              platformSubstitutions: [
                {
                  action: 'show-modal',
                  event: 'click',
                  kind: 'dialog',
                  tag: 'button',
                  target: 'cart-drawer',
                },
              ],
              queries: ['cart'],
              securityOperations: [
                {
                  door: 'local-call-edge',
                  kind: 'server.helper.call',
                  root: 'endpoint:/report',
                  target: 'local:consume',
                },
                {
                  door: 'trustedHtml',
                  justification: 'reviewed static empty state',
                  kind: 'server.output.trusted-html',
                  target: 'trustedHtml',
                },
              ],
              securitySemanticGraph: {
                budgets: { callDepth: 16, nodes: 50_000, operations: 4_096, summaries: 256 },
                roots: [
                  {
                    binding: {
                      callback: 'handler',
                      callableSpan: { end: 90, start: 50 },
                      factory: 'endpoint',
                      factoryCallSpan: { end: 100, start: 40 },
                      root: 'endpoint:/report',
                    },
                    helperInvocations: [
                      {
                        argumentSpans: [{ end: 75, start: 68 }],
                        authorityInputs: ['arg0=context'],
                        callable: 'local:consume',
                        callableSpan: { end: 30, start: 10 },
                        callSpan: { end: 80, start: 60 },
                        operationKinds: ['server.egress.request'],
                        transfers: ['local:consume[arg0=context]'],
                        verdict: 'proved',
                      },
                    ],
                    root: 'endpoint:/report',
                    summaries: [
                      {
                        authorityInputs: ['arg0=context'],
                        callable: 'local:consume',
                        callableSpan: { end: 30, start: 10 },
                        operationKinds: ['server.egress.request'],
                        verdict: 'proved',
                      },
                    ],
                    traces: [
                      {
                        root: 'endpoint:/report',
                        sink: {
                          door: 'ctx.fetch',
                          kind: 'server.egress.request',
                          target: 'outbound',
                        },
                        transfers: ['local:consume[arg0=context]'],
                        verdict: 'proved',
                      },
                    ],
                  },
                ],
                schema: 'kovo-security-semantic-graph/v2',
              },
              styleRules: [
                {
                  className: 'kv-button-bg-a1b2c3',
                  source: 'button.tsx#root',
                  styleRef: 'base.root',
                },
              ],
              triggers: [
                {
                  deps: ['cart'],
                  exportName: 'CartBadge$mountChart',
                  justification: 'chart boots when visible',
                  ref: '/c/cart-badge.client.js#CartBadge$mountChart',
                  trigger: 'visible',
                },
              ],
            },
          ],
        },
        { kind: 'component', target: 'CartBadge' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'COMPONENT CartBadge',
        'queries: cart',
        'fragments: cart-badge',
        'dom-name: cart-badge',
        'effective-dom-name: components/cart/cart-badge/cart-badge',
        'STYLE class=kv-button-bg-a1b2c3 source=button.tsx#root style-ref=base.root',
        "CLOCK ago cadence=every='1s'",
        'CLOCK pub cadence=renderOnce',
        'HANDLER click export=CartBadge$button_click ref=/c/cart-badge.client.js#CartBadge$button_click captures=ctx,element-params params=itemId substitution=-',
        'OPERATION server.helper.call door=local-call-edge root=endpoint:/report target=local:consume justification=-',
        'OPERATION server.output.trusted-html door=trustedHtml root=- target=trustedHtml justification=reviewed static empty state',
        'SEMANTIC-ROOT root=endpoint:/report factory=endpoint callback=handler factory-span=40:100 callable-span=50:90',
        'SEMANTIC-INVOKE root=endpoint:/report call-span=60:80 argument-spans=68:75 callable=local:consume callable-span=10:30 authority-inputs=arg0=context effects=server.egress.request transfers=local:consume[arg0=context] verdict=proved',
        'SEMANTIC-SUMMARY root=endpoint:/report callable=local:consume authority-inputs=arg0=context effects=server.egress.request verdict=proved',
        'SEMANTIC-TRACE root=endpoint:/report transfers=local:consume[arg0=context] sink=server.egress.request:outbound verdict=proved',
        'SUBSTITUTION dialog tag=button event=click target=cart-drawer action=show-modal',
        'DERIVE CartBadge$isEmpty inputs=cart ref=/c/cart-badge.client.js#CartBadge$isEmpty target=button[data-bind:disabled]',
        'TRIGGER visible export=CartBadge$mountChart ref=/c/cart-badge.client.js#CartBadge$mountChart deps=cart justification=chart boots when visible',
        'MERGE button attr=aria-expanded rule=aria-author-override decision=author-wins diagnostics=KV232',
        'MERGE button attr=data-bind:hidden rule=binding-target-conflict decision=error diagnostics=KV233',
        '',
      ].join('\n'),
    });
  });

  it('prints package prefix provenance for a prefixed component target', () => {
    expect(
      kovoExplain(
        {
          components: [
            {
              fragments: ['kovo-dialog'],
              name: 'KovoDialog',
              queries: ['dialogState'],
            },
          ],
          packageComponentPrefixes: [
            {
              packageName: '@kovojs/headless-ui',
              prefix: 'kovo-',
            },
          ],
        },
        { kind: 'component', target: 'kovo-dialog' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'COMPONENT KovoDialog',
        'provenance: package=@kovojs/headless-ui prefix=kovo- effective-prefix=kovo- source=package-prefix-fact',
        'queries: dialogState',
        'fragments: kovo-dialog',
        '',
      ].join('\n'),
    });
  });

  it('explains mutation guards, writes, invalidations, and optimistic coverage', () => {
    expect(
      kovoExplain(
        {
          mutations: [
            {
              enctype: 'multipart/form-data',
              fileFields: ['receipt'],
              guards: ['authed'],
              invalidates: ['cart'],
              inputFields: ['productId', 'quantity', 'receipt'],
              key: 'cart/add',
              manualInvalidates: ['product'],
              session: 'commerceSession',
              writes: ['cart', 'product'],
            },
          ],
          optimistic: [
            { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
            { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
            { mutation: 'cart/add', query: 'cart.discount', status: 'UNHANDLED' },
          ],
          components: [
            { name: 'CartBadge', queries: ['cart'] },
            { name: 'Recommendations', queries: ['recommendations'] },
          ],
          pages: [{ queries: ['cart'], route: '/cart' }],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'recommendations' },
          ],
        },
        { kind: 'mutation', optimistic: true, target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'session: commerceSession',
        'enctype: multipart/form-data',
        'input-fields: productId,quantity,receipt',
        'file-fields: receipt',
        'writes: cart,product',
        'invalidates: cart',
        'manual-invalidates: product',
        'updates: cart->component:CartBadge,page:/cart; recommendations->component:Recommendations',
        'OPTIMISTIC cart hand-written',
        'OPTIMISTIC recommendations await-fragment',
        'OPTIMISTIC-SUMMARY total=2 derived=0 hand-written=1 await-fragment=1 UNHANDLED=0 PUNTED=0',
        '',
      ].join('\n'),
    });
  });

  it('explains durable task graph edges', () => {
    const graph = {
      tasks: [
        {
          cron: '0 2 * * *',
          key: 'email/send-receipt',
          runMutations: ['order/mark-sent'],
          runQueries: ['order/by-id'],
          schedules: ['email/send-receipt'],
        },
      ],
    };

    expect(kovoExplain(graph, { tasks: true })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'TASKS',
        'TASK email/send-receipt cron=0 2 * * * runMutations=order/mark-sent runQueries=order/by-id schedules=email/send-receipt',
        'SUMMARY total=1',
        '',
      ].join('\n'),
    });

    expect(kovoExplain(graph, { kind: 'task', target: 'email/send-receipt' })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'TASK email/send-receipt',
        'cron: 0 2 * * *',
        'run-mutations: order/mark-sent',
        'run-queries: order/by-id',
        'schedules: email/send-receipt',
        '',
      ].join('\n'),
    });
  });

  it('explains canonical handler write-sink facts in the endpoint audit', () => {
    expect(
      kovoExplain(
        {
          endpoints: [{ method: 'POST', name: '/api/sync', path: '/api/sync' }],
          handlerWriteSinks: [
            {
              canonicalTarget: { identity: 'request.db', provenance: 'property-access-path' },
              operationKind: 'insert',
              owner: { kind: 'key', value: '/api/sync' },
              path: 'request.db.insert',
              span: { end: 44, start: 27 },
              surface: 'endpoint',
            },
            {
              canonicalTarget: { identity: 'UNRESOLVED', provenance: 'computed-member' },
              operationKind: 'UNRESOLVED',
              owner: { kind: 'key', value: 'cart/save' },
              path: 'UNRESOLVED',
              span: { end: 19, start: 12 },
              surface: 'mutation',
            },
          ],
          mutations: [{ guards: ['authed'], key: 'cart/save', writes: ['cart'] }],
        },
        { endpoints: true },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'ENDPOINTS',
        'ENDPOINT /api/sync surface=endpoint method=POST path=/api/sync mount=exact auth=- csrf=checked cache=- body=- bodySize=- rateLimit=- headers=- files=- dynamic=- writes=-',
        'MUTATION cart/save method=POST auth=authed csrf=checked session=- writes=cart',
        'WRITE-SINK surface=endpoint owner=key:/api/sync operation=insert target=request.db targetProvenance=property-access-path path=request.db.insert span=27-44 status=resolved',
        'WRITE-SINK surface=mutation owner=key:cart/save operation=UNRESOLVED target=UNRESOLVED targetProvenance=computed-member path=UNRESOLVED span=12-19 status=unresolved',
        'SUMMARY total=2 writeSinks=2',
        '',
      ].join('\n'),
    });
  });

  it('explains computed literal request db write-sink facts from compiler extraction', async () => {
    const { compileComponentModule, deriveAppGraph } = await import('@kovojs/compiler');
    const compiled = compileComponentModule({
      fileName: 'src/mutations/cart.ts',
      source: `
export const save = mutation('cart/save', {
  input: s.object({ id: s.string() }),
  handler(input, request) {
    return request['db'].insert(input);
  },
});
`,
    });

    expect(compiled.handlerWriteSinkFacts).toEqual([
      expect.objectContaining({
        canonicalTarget: { identity: 'request.db', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart/save' },
        path: 'request.db.insert',
        surface: 'mutation',
      }),
    ]);

    const merged = deriveAppGraph({
      components: [
        {
          componentGraphFacts: compiled.componentGraphFacts,
          handlerWriteSinkFacts: compiled.handlerWriteSinkFacts,
          taskGraphFacts: compiled.taskGraphFacts,
        },
      ],
      graph: { mutations: [{ key: 'cart/save', writes: ['cart'] }] },
    });
    const result = kovoExplain(
      JSON.parse(JSON.stringify(merged.graph)) as Parameters<typeof kovoExplain>[0],
      { endpoints: true },
    );

    expect(result.output).toContain(
      'WRITE-SINK surface=mutation owner=key:cart/save operation=insert target=request.db targetProvenance=property-access-path path=request.db.insert',
    );
  });

  it('explains query write-reachability facts on query targets', () => {
    expect(
      kovoExplain(
        {
          queries: [{ domains: ['log'], guards: ['authed'], query: 'dashboard' }],
          queryWriteReachability: [
            {
              canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
              operation: 'delete',
              operationKind: 'delete',
              operationProvenance: 'receiver-method-alias',
              query: 'dashboard',
              site: 'q.ts:4',
              table: 'logs',
            },
            {
              canonicalTarget: { identity: 'logs', provenance: 'table-argument' },
              operation: 'UNRESOLVED',
              operationKind: 'UNRESOLVED',
              operationProvenance: 'computed-member',
              query: 'dashboard',
              site: 'q.ts:5',
              table: 'logs',
              unresolved: { code: 'KV406', reason: 'computed-member' },
            },
          ],
        },
        { kind: 'query', target: 'dashboard' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'QUERY dashboard',
        'reads: log',
        'consumers: -',
        'invalidated-by: -',
        'domain-writes: -',
        'WRITE-REACH operation=delete operationProvenance=receiver-method-alias target=logs targetProvenance=table-argument site=q.ts:4 status=resolved diagnostic=KV433',
        'WRITE-REACH operation=UNRESOLVED operationProvenance=computed-member target=logs targetProvenance=table-argument site=q.ts:5 status=unresolved diagnostic=KV406',
        '',
      ].join('\n'),
    });
  });

  it('explains missing optimistic coverage as derived UNHANDLED rows and ignores unrelated statuses', () => {
    expect(
      kovoExplain(
        {
          mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
          optimistic: [
            { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
          ],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'recommendations' },
          ],
        },
        { kind: 'mutation', optimistic: true, target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: -',
        'invalidates: cart',
        'manual-invalidates: -',
        'updates: -',
        'OPTIMISTIC cart UNHANDLED',
        "  -> hand-write in the mutation module, or declare 'await-fragment'",
        'OPTIMISTIC-SUMMARY total=1 derived=0 hand-written=0 await-fragment=0 UNHANDLED=1 PUNTED=0',
        '',
      ].join('\n'),
    });
  });

  it('reports derived coverage and named PUNTED derivations inline (SPEC §10.5/§10.6)', () => {
    expect(
      kovoExplain(
        {
          mutations: [
            {
              guards: ['authed'],
              invalidates: ['cart', 'order'],
              key: 'cart/add',
              writes: ['cart', 'order'],
            },
          ],
          optimistic: [
            {
              derivation: {
                proof: { level: 'exact-row', privateScope: ['session:id'] },
                status: 'derived',
              },
              mutation: 'cart/add',
              query: 'cart',
              status: 'derived',
            },
            {
              derivation: {
                proof: { level: 'scoped-rowset', privateScope: ['tenant:id'] },
                status: 'derived',
              },
              mutation: 'cart/add',
              query: 'cart.total',
              status: 'derived',
            },
            {
              derivation: {
                proof: { level: 'opaque' },
                reason: { code: 'opaque-set', expr: 'compute_total' },
                status: 'PUNTED',
              },
              mutation: 'cart/add',
              query: 'orders',
              status: 'UNHANDLED',
            },
            {
              derivation: {
                proof: { level: 'table-level' },
                reason: { code: 'non-key-match', expr: 'gt(orders.total, 100)' },
                status: 'PUNTED',
              },
              mutation: 'cart/add',
              query: 'orders.byPrice',
              status: 'UNHANDLED',
            },
          ],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['cart'], query: 'cart.total' },
            { domains: ['order'], query: 'orders' },
            { domains: ['order'], query: 'orders.byPrice' },
          ],
        },
        { kind: 'mutation', optimistic: true, target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart,order',
        'invalidates: cart,order',
        'manual-invalidates: -',
        'updates: -',
        'OPTIMISTIC cart derived',
        'OPTIMISTIC-PROOF cart level=exact-row private-scope=session:id',
        'OPTIMISTIC cart.total derived',
        'OPTIMISTIC-PROOF cart.total level=scoped-rowset private-scope=tenant:id',
        'OPTIMISTIC orders UNHANDLED',
        'OPTIMISTIC-PROOF orders level=opaque private-scope=-',
        // A PUNTED derivation is metadata, not coverage: the pair stays UNHANDLED,
        // shows its named reason, and still gets the fix line.
        'OPTIMISTIC-PUNT orders: Opaque: compute_total',
        "  -> hand-write in the mutation module, or declare 'await-fragment'",
        'OPTIMISTIC orders.byPrice UNHANDLED',
        'OPTIMISTIC-PROOF orders.byPrice level=table-level private-scope=-',
        'OPTIMISTIC-PUNT orders.byPrice: non-key match: gt(orders.total, 100)',
        "  -> hand-write in the mutation module, or declare 'await-fragment'",
        'OPTIMISTIC-SUMMARY total=4 derived=2 hand-written=0 await-fragment=0 UNHANDLED=2 PUNTED=2',
        '',
      ].join('\n'),
    });
  });

  it('audits unguarded mutations with stable explain output', () => {
    const result = kovoExplain(
      {
        mutations: [
          {
            guards: ['rateLimit:session'],
            invalidates: ['cart'],
            key: 'cart/add',
            writes: ['cart'],
          },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
          { key: 'inventory/sync', manualInvalidates: ['product'], writes: ['product'] },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=cart manual-invalidates=-
      MUTATION inventory/sync guards=- writes=product invalidates=- manual-invalidates=product
      SUMMARY total=2
      "
    `);
  });

  it('treats mutation auth declarations as guarded audit facts', () => {
    const input = {
      mutations: [
        {
          auth: 'custom:better-auth-credential',
          invalidates: ['auth'],
          inputFields: ['email', 'password', 'next'],
          key: 'auth/sign-in',
          writes: ['auth'],
        },
      ],
    };

    expect(kovoExplain(input, { kind: 'mutation', target: 'auth/sign-in' })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION auth/sign-in',
        'guards: -',
        'auth: custom:better-auth-credential',
        'input-fields: email,password,next',
        'writes: auth',
        'invalidates: auth',
        'manual-invalidates: -',
        'updates: -',
        '',
      ].join('\n'),
    });
    expect(kovoExplain(input, { unguarded: true })).toEqual({
      exitCode: 0,
      output: 'kovo-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
  });

  it('surfaces SQL safety facts on mutation and query explain output', () => {
    const input = {
      mutations: [{ key: 'cart/add', writes: ['cart'] }],
      queries: [{ domains: ['product'], query: 'product/list' }],
      sqlSafety: [
        {
          declarations: ['KV406:tables=cart_items'],
          justificationSite: 'cart.domain.ts:44:13',
          site: 'cart.domain.ts:44',
          target: 'cart/add',
          targetKind: 'mutation',
          text: 'trusted',
        },
        {
          declarations: ['KV410:reads=products'],
          site: 'products.query.ts:12',
          target: 'product/list',
          targetKind: 'query',
          text: 'parameterized',
        },
        {
          declarations: [],
          site: 'cart.domain.ts:20',
          target: 'cart/add',
          targetKind: 'mutation',
          text: 'static',
        },
      ],
    } as const;

    expect(kovoExplain(input, { kind: 'mutation', target: 'cart/add' })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION cart/add',
        'guards: -',
        'writes: cart',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: -',
        'SQL cart.domain.ts:20 text=static declarations=- justification=-',
        'SQL cart.domain.ts:44 text=trusted declarations=KV406:tables=cart_items justification=cart.domain.ts:44:13',
        '',
      ].join('\n'),
    });
    expect(kovoExplain(input, { kind: 'query', target: 'product/list' })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'QUERY product/list',
        'reads: product',
        'consumers: -',
        'invalidated-by: -',
        'domain-writes: -',
        'SQL products.query.ts:12 text=parameterized declarations=KV410:reads=products justification=-',
        '',
      ].join('\n'),
    });
  });

  it('audits unguarded queries and pages with stable explain output', () => {
    const result = kovoExplain(
      {
        mutations: [
          { guards: ['authed'], key: 'cart/add' },
          { guards: ['rateLimit:session'], key: 'inventory/sync', writes: ['product'] },
        ],
        pages: [
          { guards: ['authed'], queries: ['cart'], route: '/cart' },
          { guards: [], queries: ['adminOrders'], route: '/admin' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['order'], guards: [], query: 'adminOrders' },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNGUARDED
      MUTATION inventory/sync guards=rateLimit:session writes=product invalidates=- manual-invalidates=-
      PAGE /admin guards=- queries=adminOrders
      QUERY adminOrders guards=- reads=order
      SUMMARY total=3
      "
    `);
  });

  it('audits unguarded endpoints with stable explain output', () => {
    const result = kovoExplain(
      {
        endpoints: [
          {
            auth: 'none',
            csrf: 'safe:read-only',
            method: 'GET',
            mount: 'prefix',
            name: 'auth/mount',
            path: '/auth',
          },
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'app-shell/order-paid',
            path: '/webhooks/order-paid',
          },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNGUARDED
      ENDPOINT auth/mount method=GET path=/auth mount=prefix auth=none csrf=safe:read-only
      SUMMARY total=1
      "
    `);
  });

  it('audits producer-owned access decisions with stable explain output', () => {
    const result = kovoExplain(
      {
        access: [
          {
            decision: 'public',
            detail: 'access=public method=GET path=/healthz mount=exact auth=none',
            justification: 'public uptime probe',
            kind: 'endpoint',
            name: 'health',
            source: 'access',
          },
          {
            decision: 'missing',
            detail: 'missing access fact method=GET path=/raw mount=exact auth=-',
            kind: 'endpoint',
            name: 'raw',
            source: 'access',
          },
          {
            decision: 'guard',
            detail: 'access=guards guards=authed',
            kind: 'mutation',
            name: 'cart/add',
            source: 'access',
          },
          {
            decision: 'missing',
            detail: 'missing access fact',
            kind: 'mutation',
            name: 'inventory/sync',
            source: 'access',
          },
          {
            decision: 'guard',
            detail: 'access=guards guards=authed',
            kind: 'page',
            name: '/cart',
            source: 'access',
          },
          {
            decision: 'missing',
            detail: 'missing access fact',
            kind: 'page',
            name: '/login',
            source: 'access',
          },
          {
            decision: 'guard',
            detail: 'access=guards guards=authed',
            kind: 'query',
            name: 'cart',
            source: 'access',
          },
          {
            decision: 'missing',
            detail: 'missing access fact',
            kind: 'query',
            name: 'catalog',
            source: 'access',
          },
          {
            decision: 'missing',
            detail: 'no access property',
            kind: 'query',
            name: 'explicit-missing',
            site: 'queries.ts:4',
            source: 'access',
          },
          {
            decision: 'verified',
            detail:
              'access=verified-machine-auth method=POST path=/webhooks/order-paid mount=exact auth=verifier:stripe-signature',
            justification: 'signed stripe webhook',
            kind: 'webhook',
            name: 'app-shell/order-paid',
            source: 'access',
          },
        ],
        endpoints: [
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'app-shell/order-paid',
            path: '/webhooks/order-paid',
            surface: 'webhook',
          },
          {
            auth: 'none',
            authJustification: 'public uptime probe',
            csrf: 'safe:read-only',
            method: 'GET',
            name: 'health',
            path: '/healthz',
          },
          {
            method: 'GET',
            name: 'raw',
            path: '/raw',
          },
        ],
        mutations: [
          { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
          { key: 'inventory/sync', writes: ['product'] },
        ],
        pages: [
          { guards: ['authed'], queries: ['cart'], route: '/cart' },
          { queries: [], route: '/login' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['product'], query: 'catalog' },
        ],
      },
      { access: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ACCESS
      ACCESS ENDPOINT health decision=public source=access site=- detail="access=public method=GET path=/healthz mount=exact auth=none" justification="public uptime probe"
      ACCESS ENDPOINT raw decision=missing source=access site=- detail="missing access fact method=GET path=/raw mount=exact auth=-" justification=-
      ACCESS MUTATION cart/add decision=guard source=access site=- detail="access=guards guards=authed" justification=-
      ACCESS MUTATION inventory/sync decision=missing source=access site=- detail="missing access fact" justification=-
      ACCESS PAGE /cart decision=guard source=access site=- detail="access=guards guards=authed" justification=-
      ACCESS PAGE /login decision=missing source=access site=- detail="missing access fact" justification=-
      ACCESS QUERY cart decision=guard source=access site=- detail="access=guards guards=authed" justification=-
      ACCESS QUERY catalog decision=missing source=access site=- detail="missing access fact" justification=-
      ACCESS QUERY explicit-missing decision=missing source=access site=queries.ts:4 detail="no access property" justification=-
      ACCESS WEBHOOK app-shell/order-paid decision=verified source=access site=- detail="access=verified-machine-auth method=POST path=/webhooks/order-paid mount=exact auth=verifier:stripe-signature" justification="signed stripe webhook"
      SUMMARY total=10 guard=3 verified=1 public=1 missing=5
      "
    `);
  });

  it('prints executable guard names for access decisions, not relabeled audit steps', async () => {
    const [{ accessFactsFromApp }, { createApp, guard, guards, route }] = await Promise.all([
      import('@kovojs/server/internal/execution'),
      import('@kovojs/server'),
    ]);
    const adminOnly = guards.role<{
      session?: { user?: { id?: string; roles: readonly string[] } | null } | null;
    }>('admin');
    const app = createApp({
      routes: [
        route('/admin', {
          access: [guard('admin-only', adminOnly)],
          page: () => '<main>admin</main>',
        }),
      ],
    });

    expect(kovoExplain({ access: accessFactsFromApp(app) }, { access: true })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'ACCESS',
        'ACCESS PAGE /admin decision=guard source=access site=- detail="access=guards guards=admin-only" justification=-',
        'SUMMARY total=1 guard=1 verified=0 public=0 missing=0',
        '',
      ].join('\n'),
    });
  });

  it('does not derive access output from graph surfaces without producer facts', () => {
    const result = kovoExplain(
      {
        endpoints: [{ auth: 'none', method: 'GET', name: 'health', path: '/healthz' }],
        mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
        pages: [{ guards: ['authed'], route: '/cart' }],
        queries: [{ domains: ['cart'], guards: ['authed'], query: 'cart' }],
      },
      { access: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ACCESS
      SUMMARY total=0 guard=0 verified=0 public=0 missing=0
      "
    `);
  });

  it('prints all endpoints with stable explain output', () => {
    const result = kovoExplain(
      {
        endpoints: [
          {
            auth: 'verifier:stripe-signature',
            body: 'raw',
            bodySize: '1mb',
            cache: 'no-store',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            headers: ['Stripe-Signature'],
            method: 'POST',
            name: 'app-shell/order-paid',
            path: '/webhooks/order-paid',
            rateLimit: 'webhook:stripe',
            surface: 'webhook',
            writes: ['order'],
          },
          {
            auth: 'custom:api-key',
            body: 'bytes',
            bodySize: 'stream',
            cache: 'private,no-store',
            csrf: 'safe:read-only',
            files: ['inventory.bin'],
            headers: ['Content-Disposition', 'Content-Type'],
            method: 'GET',
            name: 'inventory/download',
            path: '/downloads/inventory.bin',
            rateLimit: 'download:user',
            surface: 'route-file',
          },
          {
            auth: 'none',
            authJustification: 'public uptime probe',
            body: 'json',
            cache: 'no-store',
            csrf: 'safe:read-only',
            method: 'GET',
            name: 'health',
            path: '/healthz',
          },
          {
            access: { kind: 'public', reason: 'public echo endpoint is CSRF checked' },
            body: 'json',
            cache: 'no-store',
            csrf: 'checked',
            method: 'POST',
            name: 'echo',
            path: '/api/echo-json',
          },
        ],
      },
      { endpoints: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ENDPOINTS
      ENDPOINT app-shell/order-paid surface=webhook method=POST path=/webhooks/order-paid mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook cache=no-store body=raw bodySize=1mb rateLimit=webhook:stripe headers=Stripe-Signature files=- dynamic=- writes=order
      ENDPOINT echo surface=endpoint method=POST path=/api/echo-json mount=exact auth=public:public echo endpoint is CSRF checked csrf=checked cache=no-store body=json bodySize=- rateLimit=- headers=- files=- dynamic=- writes=-
      ENDPOINT health surface=endpoint method=GET path=/healthz mount=exact auth=none:public uptime probe csrf=safe:read-only cache=no-store body=json bodySize=- rateLimit=- headers=- files=- dynamic=- writes=-
      ENDPOINT inventory/download surface=route-file method=GET path=/downloads/inventory.bin mount=exact auth=custom:api-key csrf=safe:read-only cache=private,no-store body=bytes bodySize=stream rateLimit=download:user headers=Content-Disposition,Content-Type files=inventory.bin dynamic=- writes=-
      SUMMARY total=4
      "
    `);
  });

  it('prints webhook mutation dispatch and derives webhook writes from the called mutation', () => {
    const result = kovoExplain(
      {
        endpoints: [
          {
            auth: 'verifier:stripe-signature',
            body: 'raw',
            cache: 'no-store',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'billing/stripe',
            path: '/webhooks/stripe',
            runMutations: ['billing/record-invoice'],
            surface: 'webhook',
          },
        ],
        mutations: [{ key: 'billing/record-invoice', writes: ['invoice'] }],
      },
      { endpoints: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ENDPOINTS
      ENDPOINT billing/stripe surface=webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook cache=no-store body=raw bodySize=- rateLimit=- headers=- files=- dynamic=- writes=invoice runMutations=billing/record-invoice
      MUTATION billing/record-invoice method=POST auth=- csrf=checked session=- writes=invoice
      SUMMARY total=2
      "
    `);
  });

  it('lists every mutation CSRF posture in --endpoints alongside endpoints (SPEC §11.4)', () => {
    const result = kovoExplain(
      {
        endpoints: [
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
            surface: 'webhook',
            writes: ['order'],
          },
        ],
        mutations: [
          { guards: ['authed'], key: 'cart/add', session: 'commerceSession', writes: ['cart'] },
          {
            csrf: 'exempt',
            csrfJustification: 'machine ingest, no session',
            key: 'ingest/rows',
            writes: ['inventory'],
          },
        ],
      },
      { endpoints: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ENDPOINTS
      ENDPOINT stripe/webhook surface=webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:signed webhook cache=- body=- bodySize=- rateLimit=- headers=- files=- dynamic=- writes=order
      MUTATION cart/add method=POST auth=authed csrf=checked session=commerceSession writes=cart
      MUTATION ingest/rows method=POST auth=- csrf=exempt:machine ingest, no session session=- writes=inventory
      SUMMARY total=3
      "
    `);
  });

  it('accepts kovo explain --endpoints as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-endpoints-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          endpoints: [
            {
              auth: 'verifier:stripe-signature',
              body: 'raw',
              cache: 'no-store',
              csrf: 'exempt',
              csrfJustification: 'signed stripe webhook',
              headers: ['Stripe-Signature'],
              method: 'POST',
              name: 'stripe/webhook',
              path: '/webhooks/stripe',
              surface: 'webhook',
              writes: ['order'],
            },
          ],
        }),
      );

      expect(main(['explain', '--endpoints', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-explain/v1',
        'ENDPOINTS',
        'ENDPOINT stripe/webhook surface=webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook cache=no-store body=raw bodySize=- rateLimit=- headers=Stripe-Signature files=- dynamic=- writes=order',
        'SUMMARY total=1',
        '',
      ].join('\n'),
    );
  });

  it('prints trust escape hatches with stable explain output', () => {
    const result = kovoExplain(
      {
        trustEscapes: [
          {
            justification: 'cms sanitizer owns rich text',
            kind: 'trustedHtml',
            owner: 'html.dom.output',
            safePath: 'trustedHtml',
            site: 'app/promo.tsx:12',
            source: 'cms.promo.body',
          },
          {
            justification: 'provider retries unsigned local dev',
            kind: 'webhookVerifyNone',
            owner: 'ingress.endpoint.webhook',
            safePath: 'webhook({verify:none})',
            site: 'app/webhook.ts:8',
            source: 'stripe',
          },
          {
            justification: 'tenant export root mounted by deploy',
            kind: 'staticExportPathOverride',
            owner: 'file.storage.static-export',
            safePath: 'static export path override',
            site: 'app/export.ts:4',
            source: 'EXPORT_ROOT',
          },
        ],
      },
      { trust: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      TRUST
      TRUST kind=staticExportPathOverride site=app/export.ts:4 source=EXPORT_ROOT owner=file.storage.static-export safePath=static export path override justification="tenant export root mounted by deploy"
      TRUST kind=trustedHtml site=app/promo.tsx:12 source=cms.promo.body owner=html.dom.output safePath=trustedHtml justification="cms sanitizer owns rich text"
      TRUST kind=webhookVerifyNone site=app/webhook.ts:8 source=stripe owner=ingress.endpoint.webhook safePath=webhook({verify:none}) justification="provider retries unsigned local dev"
      SUMMARY total=3
      "
    `);
  });

  // SPEC §6.6 (KV426, audit-only): the trust-escape producer rides through deriveAppGraph and
  // `kovo explain --trust` enumerates an app `trustedHtml(...)` call site.
  it('surfaces an app trust escape end-to-end through --trust', async () => {
    const { collectTrustEscapesFromProject } = await import('@kovojs/drizzle/internal/static');
    const { deriveAppGraph } = await import('@kovojs/compiler/graph');

    const trustEscapes = collectTrustEscapesFromProject({
      files: [
        {
          fileName: 'promo.tsx',
          source: ['export const body = trustedHtml(cms.promo);'].join('\n'),
        },
      ],
    });

    expect(trustEscapes.map((escape) => escape.kind)).toContain('trustedHtml');

    const merged = deriveAppGraph({ graph: { trustEscapes } } as Parameters<
      typeof deriveAppGraph
    >[0]);
    const result = kovoExplain(
      JSON.parse(JSON.stringify(merged.graph)) as Parameters<typeof kovoExplain>[0],
      { trust: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('TRUST kind=trustedHtml site=promo.tsx');
  });

  // SPEC §6.6 (audit-only), threat-matrix-plan.md M3: the capability-escape producer rides through
  // deriveAppGraph and `kovo explain --capabilities` enumerates every app-authored escape CALL SITE
  // from REAL source — not a hand-injected graph. This is the end-to-end proof for M3.
  it('surfaces app escape-hatch call sites end-to-end through --capabilities', async () => {
    const { collectCapabilityEscapesFromProject } = await import('@kovojs/drizzle/internal/static');
    const { deriveAppGraph } = await import('@kovojs/compiler/graph');

    const capabilities = collectCapabilityEscapesFromProject({
      files: [
        {
          fileName: 'admin.ts',
          source: [
            `import { serverValue, unsafeRegex, declarePublicRelation, accept } from '@kovojs/server';`,
            `export const id = serverValue(generatedId, 'server-generated order id');`,
            `export const re = unsafeRegex(/(a+)+$/, 'legacy importer format is trusted');`,
            `export const rel = declarePublicRelation({ relation: 'public.totals', reason: 'no tenant ids' });`,
            `export const zip = accept.unverified(['application/zip'], 'legacy importer trusts type');`,
            `export async function support(reader: any) {`,
            `  return reader.crossOwnerRead({ relation: 'public.orders', reason: 'admin support export' });`,
            `}`,
          ].join('\n'),
        },
      ],
    });

    // The REAL producer detected each escape at its call site (no hand-injection).
    expect([...new Set(capabilities.map((capability) => capability.kind))].sort()).toEqual([
      'acceptUnverified',
      'crossOwnerRead',
      'publicRelation',
      'serverValue',
      'unsafeRegex',
    ]);

    const merged = deriveAppGraph({ graph: { capabilities } } as Parameters<
      typeof deriveAppGraph
    >[0]);
    const result = kovoExplain(
      JSON.parse(JSON.stringify(merged.graph)) as Parameters<typeof kovoExplain>[0],
      { capabilities: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('CAPABILITY kind=serverValue site=admin.ts:2');
    expect(result.output).toContain('CAPABILITY kind=unsafeRegex site=admin.ts:3');
    expect(result.output).toContain(
      'CAPABILITY kind=publicRelation site=admin.ts:4 module=- target=public.totals',
    );
    expect(result.output).toContain('CAPABILITY kind=acceptUnverified site=admin.ts:5');
    expect(result.output).toContain(
      'CAPABILITY kind=crossOwnerRead site=admin.ts:7 module=- target=public.orders',
    );
  });

  // SPEC §6.6 (audit-only): a boot-time app.env credential reveal uses the existing reveal-fact
  // graph. `--capabilities` may fold the same fact for a combined audit, but there is no parallel
  // capability producer for trustedReveal.
  it('surfaces a config-secret credential-factory reveal end-to-end through --revealed', async () => {
    const { collectRuntimeRevealFactsFromProject } =
      await import('@kovojs/drizzle/internal/static');
    const { deriveAppGraph } = await import('@kovojs/compiler/graph');

    const revealed = collectRuntimeRevealFactsFromProject({
      files: [
        {
          fileName: 'payment.ts',
          source: [
            `import { trustedReveal, type SecretValue } from '@kovojs/core';`,
            `export function createPaymentClient(key: SecretValue<string>) {`,
            `  const raw = trustedReveal(key, { justification: 'initialize payment SDK once at boot', method: 'arbitrary-fn', source: 'app.env.PAYMENT_API_KEY' });`,
            `  return new PaymentClient(raw);`,
            `}`,
          ].join('\n'),
        },
      ],
    });

    expect(revealed).toMatchObject([
      {
        grade: 'audit',
        justification: 'initialize payment SDK once at boot',
        method: 'arbitrary-fn',
        path: 'app.env.PAYMENT_API_KEY',
        query: 'runtime',
        selectedSecret: true,
        site: 'payment.ts:3',
        source: 'app.env.PAYMENT_API_KEY',
      },
    ]);

    const merged = deriveAppGraph({ graph: { revealed } } as Parameters<typeof deriveAppGraph>[0]);
    const result = kovoExplain(
      JSON.parse(JSON.stringify(merged.graph)) as Parameters<typeof kovoExplain>[0],
      { revealed: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      'REVEAL grade=audit method=arbitrary-fn query=runtime path=app.env.PAYMENT_API_KEY site=payment.ts:3 source=app.env.PAYMENT_API_KEY selectedSecret=yes justification="initialize payment SDK once at boot"',
    );
  });

  // SPEC §6.6/§9.1 (audit-only), M3: the cookie-downgrade producer rides through deriveAppGraph and
  // `kovo explain --cookies` surfaces a `serializeCookie(..., { unsafe: unsafeCookie(...) })` from
  // REAL source (this field previously had no static producer at all).
  it('surfaces a credential-cookie downgrade end-to-end through --cookies', async () => {
    const { collectCookieDowngradesFromProject } = await import('@kovojs/drizzle/internal/static');
    const { deriveAppGraph } = await import('@kovojs/compiler/graph');

    const cookieDowngrades = collectCookieDowngradesFromProject({
      files: [
        {
          fileName: 'embed.ts',
          source: [
            `import { serializeCookie, unsafeCookie } from '@kovojs/server';`,
            `export const header = serializeCookie('embed_sid', value, {`,
            `  class: 'session',`,
            `  unsafe: unsafeCookie({ downgrade: { sameSite: 'none' }, justification: 'third-party embed' }),`,
            `});`,
          ].join('\n'),
        },
      ],
    });

    expect(cookieDowngrades).toEqual([
      {
        class: 'session',
        downgrade: { sameSite: 'none' },
        justification: 'third-party embed',
        name: 'embed_sid',
        site: 'embed.ts:2',
      },
    ]);

    const merged = deriveAppGraph({ graph: { cookieDowngrades } } as Parameters<
      typeof deriveAppGraph
    >[0]);
    const result = kovoExplain(
      JSON.parse(JSON.stringify(merged.graph)) as Parameters<typeof kovoExplain>[0],
      { cookies: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('COOKIE name=embed_sid class=session');
    expect(result.output).toContain('downgrade=sameSite=none');
  });

  // RENDERER/FOLD unit test: this hand-injects `graph.capabilities` to pin the `capabilityLine`
  // shape, the stable sort, and the `trustedReveal` fold in `collectCapabilityFacts` across ALL
  // capability kinds — including the framework-FIXED ones (`managedSqlStatement`,
  // `postgresRoleTopology`, `authAdapterDb`) that have NO per-app call site and so no static
  // producer (they are tracked by the capability-surface census gate; see threat-matrix-plan.md M3).
  // The REAL app-authored producer path is proven separately by the source-driven
  // `--capabilities`/`--cookies` end-to-end tests above (collectCapabilityEscapesFromProject →
  // deriveAppGraph → kovo explain).
  it('renders the held dangerous-capability audit table for every capability kind (--capabilities)', () => {
    const result = kovoExplain(
      {
        capabilities: [
          {
            justification: 'Stripe SDK is a client-safe published handle',
            kind: 'publishToClient',
            moduleSpecifier: './checkout-config',
            site: 'app/checkout.tsx:9',
            target: 'stripeClient',
          },
          {
            justification: 'internal metrics sidecar on the pod network',
            kind: 'egressAllowInternal',
            site: 'app/server.ts:14',
            target: '10.0.0.5:9090',
          },
          {
            justification: 'admin export reveals masked emails',
            kind: 'serverValue',
            site: 'app/admin.ts:3',
            target: 'export.email',
          },
          {
            justification: 'admin support export across owners',
            kind: 'crossOwnerRead',
            site: 'app/admin.ts:12',
            target: 'public.orders',
          },
          {
            justification: 'Better Auth adapter owns session table writes before app session',
            kind: 'authAdapterDb',
            site: 'src/_kovo/app-runtime-db.ts:90',
            target: 'src/auth.ts',
          },
          {
            justification: 'managed SQL carrier is frozen before validation and execution',
            kind: 'managedSqlStatement',
            site: 'packages/server/src/sql-safe-handle.ts',
            target: 'postgres,sqlite',
          },
          {
            justification: 'external Postgres roles verified by db provision/check/boot',
            kind: 'postgresRoleTopology',
            site: 'kovo db check',
            target: 'reader,writer,admin,system',
          },
          {
            justification: 'aggregate totals contain no tenant identifiers',
            kind: 'publicRelation',
            site: 'src/_kovo/app-runtime-db.ts:14',
            target: 'public.kovo_order_totals_mv',
          },
          {
            justification: 'framework-owned system DB capability remains opaque',
            kind: 'systemDb',
            site: 'src/_kovo/app-runtime-db.ts:79',
            target: 'auth-adapter',
          },
        ],
        // An audit-grade reveal folds into the table as a trustedReveal capability.
        revealed: [
          {
            grade: 'audit',
            justification: 'masked email for support tooling',
            method: 'arbitrary-fn',
            path: 'email',
            query: 'supportUser',
            site: 'app/support.ts:7',
          },
          // A proof-grade server projection is NOT an escape — it must be excluded.
          {
            grade: 'proof',
            method: 'server-projection',
            path: 'name',
            query: 'publicProfile',
            site: 'app/profile.ts:2',
          },
        ],
      },
      { capabilities: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      CAPABILITIES
      CAPABILITY kind=authAdapterDb site=src/_kovo/app-runtime-db.ts:90 module=- target=src/auth.ts justification="Better Auth adapter owns session table writes before app session"
      CAPABILITY kind=crossOwnerRead site=app/admin.ts:12 module=- target=public.orders justification="admin support export across owners"
      CAPABILITY kind=egressAllowInternal site=app/server.ts:14 module=- target=10.0.0.5:9090 justification="internal metrics sidecar on the pod network"
      CAPABILITY kind=managedSqlStatement site=packages/server/src/sql-safe-handle.ts module=- target=postgres,sqlite justification="managed SQL carrier is frozen before validation and execution"
      CAPABILITY kind=postgresRoleTopology site=kovo db check module=- target=reader,writer,admin,system justification="external Postgres roles verified by db provision/check/boot"
      CAPABILITY kind=publicRelation site=src/_kovo/app-runtime-db.ts:14 module=- target=public.kovo_order_totals_mv justification="aggregate totals contain no tenant identifiers"
      CAPABILITY kind=publishToClient site=app/checkout.tsx:9 module=./checkout-config target=stripeClient justification="Stripe SDK is a client-safe published handle"
      CAPABILITY kind=serverValue site=app/admin.ts:3 module=- target=export.email justification="admin export reveals masked emails"
      CAPABILITY kind=systemDb site=src/_kovo/app-runtime-db.ts:79 module=- target=auth-adapter justification="framework-owned system DB capability remains opaque"
      CAPABILITY kind=trustedReveal site=app/support.ts:7 module=- target=supportUser.email justification="masked email for support tooling"
      SUMMARY total=10
      "
    `);
  });

  it('explains untrusted roots, reviewed doors, package verdicts, and closed provenance', () => {
    const result = kovoExplain(
      {
        capabilityClosure: [
          {
            kind: 'root',
            module: 'src/webhooks/billing.ts',
            name: 'billing',
            rootKind: 'webhook',
            site: 'src/webhooks/billing.ts:4:16',
          },
          {
            conditions: ['default', 'import', 'node'],
            kind: 'summary',
            manifestFingerprint: 'sha256:abc123',
            packageName: 'safe-parser',
            packageVersion: '1.2.3',
            site: 'src/webhooks/billing.ts:2:1',
            status: 'valid',
            summaryVersion: 'safe-parser/4',
          },
          {
            capability: 'database-driver',
            kind: 'door',
            module: 'src/webhooks/billing.ts',
            name: 'billing',
            path: ['webhook:billing', 'src/db.ts', '@kovojs/server/postgres'],
            reason: 'framework-owned Postgres door',
            rootKind: 'webhook',
            site: 'src/db.ts:7:1',
          },
          {
            capability: 'network',
            kind: 'closed',
            module: 'src/webhooks/billing.ts',
            name: 'billing',
            path: ['webhook:billing', 'src/send.ts', 'package:raw-http'],
            reason: 'package summary is absent',
            rootKind: 'webhook',
            site: 'src/send.ts:3:1',
            status: 'unresolved',
          },
        ],
      },
      { capabilities: true },
    );

    expect(result).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'CAPABILITIES',
        'CAPABILITY-CLOSURE',
        'CLOSED root=webhook:"billing" capability=network module=src/webhooks/billing.ts site=src/send.ts:3:1 path="webhook:billing -> src/send.ts -> package:raw-http" reason="package summary is absent"',
        'DOOR root=webhook:"billing" capability=database-driver module=src/webhooks/billing.ts site=src/db.ts:7:1 path="webhook:billing -> src/db.ts -> @kovojs/server/postgres" reason="framework-owned Postgres door"',
        'ROOT kind=webhook name="billing" module=src/webhooks/billing.ts site=src/webhooks/billing.ts:4:16',
        'PACKAGE-SUMMARY package=safe-parser@1.2.3 summary=safe-parser/4 status=valid conditions=default,import,node fingerprint=sha256:abc123 site=src/webhooks/billing.ts:2:1',
        'CLOSURE-SUMMARY roots=1 doors=1 packages=1 closed=1',
        'SUMMARY total=0',
        '',
      ].join('\n'),
    });
  });

  it('prints the cookie downgrade audit table (--cookies)', () => {
    const result = kovoExplain(
      {
        cookieDowngrades: [
          {
            class: 'session',
            downgrade: { sameSite: 'none' },
            justification: 'third-party embed login',
            name: 'embed_sid',
            site: 'app/embed.ts:5',
          },
          {
            class: 'auth',
            downgrade: { httpOnly: false },
            justification: 'legacy JS reads the token',
            name: 'legacy_token',
            site: 'app/legacy.ts:2',
          },
        ],
      },
      { cookies: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      COOKIES
      COOKIE name=embed_sid class=session site=app/embed.ts:5 downgrade=sameSite=none justification="third-party embed login"
      COOKIE name=legacy_token class=auth site=app/legacy.ts:2 downgrade=httpOnly justification="legacy JS reads the token"
      SUMMARY total=2
      "
    `);
  });

  it('prints the structured document shell audit view', () => {
    const result = kovoExplain(
      {
        trustEscapes: [
          {
            justification: 'reviewed document rich text island',
            kind: 'trustedHtml',
            owner: 'document.shell.output',
            safePath: 'InlineScript|InlineStyle|structured document primitives',
            site: 'app/document.tsx:12',
            source: 'cms.documentChrome',
          },
          {
            justification: 'route content sanitizer',
            kind: 'trustedHtml',
            owner: 'html.dom.output',
            safePath: 'trustedHtml',
            site: 'app/page.tsx:5',
            source: 'cms.page',
          },
        ],
      },
      { document: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('kovo-explain/v1\nDOCUMENT\n');
    expect(result.output).toContain(
      'SINK source=app-document-TSX|inline-script-source|inline-style-source|font-preload-url|modulepreload-url|body-end-ui sink=document.shell.output',
    );
    expect(result.output).toContain(
      'TRUST kind=trustedHtml site=app/document.tsx:12 source=cms.documentChrome owner=document.shell.output safePath=InlineScript|InlineStyle|structured document primitives justification="reviewed document rich text island"',
    );
    expect(result.output).not.toContain('cms.page');
    expect(result.output).toContain('SUMMARY sinks=1 trustEscapes=1');
  });

  it('prints confidentiality reveals with stable explain output', () => {
    const result = kovoExplain(
      {
        revealed: [
          {
            grade: 'audit',
            justification: 'bcrypt digest is intentionally displayed to admins',
            method: 'arbitrary-fn',
            path: 'passwordDigest',
            query: 'admin/users',
            selectedSecret: true,
            site: 'app/queries/users.ts:31',
            source: 'users.passwordHash',
          },
          {
            grade: 'proof',
            justification: 'server SQL projects only the email domain',
            method: 'server-projection',
            path: 'emailDomain',
            query: 'admin/users',
            selectedSecret: false,
            site: 'app/queries/users.ts:18',
            source: 'users.email',
          },
        ],
      },
      { revealed: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      REVEALED
      REVEAL grade=proof method=server-projection query=admin/users path=emailDomain site=app/queries/users.ts:18 source=users.email selectedSecret=no justification="server SQL projects only the email domain"
      REVEAL grade=audit method=arbitrary-fn query=admin/users path=passwordDigest site=app/queries/users.ts:31 source=users.passwordHash selectedSecret=yes justification="bcrypt digest is intentionally displayed to admins"
      SUMMARY total=2 proof=1 audit=1
      "
    `);
  });

  it('accepts kovo explain --revealed as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-revealed-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          revealed: [
            {
              grade: 'audit',
              justification: 'reviewed support-only reveal',
              method: 'arbitrary-fn',
              path: 'tokenPreview',
              query: 'support/user',
              selectedSecret: true,
              site: 'app/support.ts:9',
              source: 'users.apiToken',
            },
          ],
        }),
      );

      expect(main(['explain', '--revealed', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-explain/v1',
        'REVEALED',
        'REVEAL grade=audit method=arbitrary-fn query=support/user path=tokenPreview site=app/support.ts:9 source=users.apiToken selectedSecret=yes justification="reviewed support-only reveal"',
        'SUMMARY total=1 proof=0 audit=1',
        '',
      ].join('\n'),
    );
  });

  it('accepts kovo explain --trust as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-trust-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          trustEscapes: [
            {
              justification: 'reviewed external redirect',
              kind: 'trustedUrl',
              owner: 'url.navigation.selector',
              safePath: 'trustedUrl',
              site: 'app/link.tsx:3',
              source: 'partner.redirect',
            },
          ],
        }),
      );

      expect(main(['explain', '--trust', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-explain/v1',
        'TRUST',
        'TRUST kind=trustedUrl site=app/link.tsx:3 source=partner.redirect owner=url.navigation.selector safePath=trustedUrl justification="reviewed external redirect"',
        'SUMMARY total=1',
        '',
      ].join('\n'),
    );
  });

  it('accepts kovo explain document as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-document-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          trustEscapes: [
            {
              justification: 'reviewed document shell escape',
              kind: 'trustedHtml',
              owner: 'document.shell.output',
              safePath: 'structured document primitive',
              site: 'app/document.tsx:3',
              source: 'cms.chrome',
            },
          ],
        }),
      );

      expect(main(['explain', 'document', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toContain('kovo-explain/v1\nDOCUMENT\n');
    expect(output).toContain('SUMMARY sinks=1 trustEscapes=1\n');
  });

  it('accepts kovo explain --unguarded as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        }),
      );

      expect(main(['explain', '--unguarded', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-
      SUMMARY total=1
      "
    `);
  });

  it('accepts kovo explain --access as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          access: [
            {
              decision: 'public',
              justification: 'marketing landing page',
              kind: 'page',
              name: '/',
              site: 'routes/index.tsx:3',
              source: 'access',
            },
          ],
        }),
      );

      expect(main(['explain', '--access', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ACCESS
      ACCESS PAGE / decision=public source=access site=routes/index.tsx:3 detail=- justification="marketing landing page"
      SUMMARY total=1 guard=0 verified=0 public=1 missing=0
      "
    `);
  });

  it('fails kovo explain --access when requested and missing decisions exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          access: [
            {
              decision: 'missing',
              detail: 'no access property',
              kind: 'query',
              name: 'cart',
              site: 'cart.query.ts:4',
              source: 'access',
            },
          ],
        }),
      );

      expect(main(['explain', '--access', '--fail-on-findings', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ACCESS
      ACCESS QUERY cart decision=missing source=access site=cart.query.ts:4 detail="no access property" justification=-
      SUMMARY total=1 guard=0 verified=0 public=0 missing=1
      "
    `);
  });

  it('fails kovo explain --unguarded when requested and findings exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [{ guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] }],
        }),
      );

      expect(main(['explain', '--unguarded', '--fail-on-findings', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-
      SUMMARY total=1
      "
    `);
  });

  it('audits owner-scoped queries and writes with stable explain output', () => {
    const result = kovoExplain(
      {
        ownerDomains: [{ domain: 'cart', owner: 'userId' }],
        scopeAudits: [
          {
            domain: 'cart',
            kind: 'write',
            name: 'cart.merge',
            scope: 'unknown',
            site: 'cart.domain.ts:30',
          },
          {
            detail: 'where eq(carts.id, args.cartId)',
            domain: 'cart',
            kind: 'query',
            name: 'cartById',
            scope: 'args',
            site: 'cart.queries.ts:21',
          },
          {
            domain: 'cart',
            kind: 'query',
            name: 'cart',
            scope: 'session',
            site: 'cart.queries.ts:8',
          },
          {
            domain: 'product',
            kind: 'query',
            name: 'productGrid',
            scope: 'unscoped',
            site: 'product.queries.ts:4',
          },
        ],
      },
      { unscoped: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)
      UNSCOPED WRITE cart.merge domain=cart scope=unknown site=cart.domain.ts:30
      SUMMARY total=2
      "
    `);
  });

  it('accepts kovo explain --unscoped as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          ownerDomains: [{ domain: 'cart', owner: 'userId' }],
          scopeAudits: [
            {
              domain: 'cart',
              kind: 'query',
              name: 'cartById',
              scope: 'args',
              site: 'cart.queries.ts:21',
            },
          ],
        }),
      );

      expect(main(['explain', '--unscoped', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21
      SUMMARY total=1
      "
    `);
  });

  it('fails kovo explain --unscoped when requested and findings exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          ownerDomains: [{ domain: 'cart', owner: 'userId' }],
          scopeAudits: [
            {
              domain: 'cart',
              kind: 'query',
              name: 'cartById',
              scope: 'args',
              site: 'cart.queries.ts:21',
            },
          ],
        }),
      );

      expect(main(['explain', '--unscoped', '--fail-on-findings', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21
      SUMMARY total=1
      "
    `);
  });

  it('explains query read sets with mutation invalidators separated per SPEC.md section 5.3', () => {
    expect(
      kovoExplain(
        {
          components: [
            { name: 'Recommendations', queries: ['recommendations'] },
            { name: 'CartBadge', queries: ['cart'] },
          ],
          pages: [
            { queries: ['cart'], route: '/cart' },
            { queries: ['cart'], route: '/checkout' },
          ],
          queries: [{ domains: ['cart'], query: 'cart' }],
          touchGraph: {
            'cart.addItem': {
              touches: [
                {
                  domain: 'cart',
                  keys: null,
                  site: 'cart.domain.ts:1',
                  via: 'cart_items',
                },
              ],
              unresolved: [],
            },
          },
        },
        { kind: 'query', target: 'cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,page:/cart,page:/checkout\ninvalidated-by: -\ndomain-writes: cart.addItem\n',
    });
  });

  it('explains query invalidations from declared mutation domains without a touch graph', () => {
    expect(
      kovoExplain(
        {
          components: [
            {
              exportName: 'CartBadge',
              name: 'components/cart-badge/cart-badge',
              queries: ['cart'],
            },
          ],
          mutations: [
            { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
            { guards: ['authed'], invalidates: ['cart'], key: 'cart/remove' },
          ],
          queries: [{ domains: ['cart'], query: 'cart' }],
        },
        { kind: 'query', target: 'cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge\ninvalidated-by: cart/add,cart/remove\ndomain-writes: -\n',
    });
  });

  it('explains component mutation form error bindings', () => {
    expect(
      kovoExplain(
        {
          components: [
            {
              mutationForms: [
                {
                  fieldErrors: [{ id: 'add-to-cart-quantity-error-p1', name: 'quantity' }],
                  fields: ['productId', 'quantity'],
                  formErrors: [{ code: 'OUT_OF_STOCK' }],
                  mutation: 'cart/add',
                  slot: 'addToCart',
                },
              ],
              name: 'ProductGrid',
            },
          ],
        },
        { kind: 'component', target: 'ProductGrid' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'COMPONENT ProductGrid',
        'queries: -',
        'fragments: -',
        'FORM addToCart mutation=cart/add fields=productId,quantity field-errors=quantity:add-to-cart-quantity-error-p1 form-errors=OUT_OF_STOCK',
        '',
      ].join('\n'),
    });
  });

  it('explains request provider fields and consumers', () => {
    expect(
      kovoExplain(
        {
          requestProviders: [
            {
              consumers: ['query:cart', 'layout:CartLayout', 'mutation:cart/add'],
              fields: ['cart', 'stock'],
              kind: 'db',
              source: 'createApp.db',
            },
            {
              consumers: ['guard:authed', 'layout:CartLayout'],
              fields: ['user.id', 'user.roles'],
              kind: 'session',
              source: 'createApp.sessionProvider',
            },
          ],
        },
        { kind: 'context', target: 'db' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'CONTEXT db',
        'fields: cart,stock',
        'consumers: query:cart,layout:CartLayout,mutation:cart/add',
        'source: createApp.db',
        '',
      ].join('\n'),
    });
  });

  it('explains mutation updates from writes when invalidates are absent', () => {
    expect(
      kovoExplain(
        {
          components: [{ name: 'CartBadge', queries: ['cart'] }],
          mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
          pages: [{ queries: ['cart'], route: '/checkout' }],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'productGrid' },
          ],
        },
        { kind: 'mutation', target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge,page:/checkout',
        '',
      ].join('\n'),
    });
  });

  it('explains mutation updates from writes even when invalidates are incomplete', () => {
    expect(
      kovoExplain(
        {
          components: [
            { name: 'CartBadge', queries: ['cart'] },
            { name: 'ProductGrid', queries: ['productGrid'] },
          ],
          mutations: [
            {
              guards: ['authed'],
              invalidates: ['cart'],
              key: 'cart/add',
              writes: ['cart', 'product'],
            },
          ],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'productGrid' },
          ],
        },
        { kind: 'mutation', target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart,product',
        'invalidates: cart',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge; productGrid->component:ProductGrid',
        '',
      ].join('\n'),
    });
  });

  it('explains page prefetch, modulepreload, and query payloads', () => {
    expect(
      kovoExplain(
        {
          pages: [
            {
              i18n: ['en-US:cartLabel,productStock'],
              meta: {
                description: 'Browse products.',
                title: 'Kovo Commerce',
              },
              modulepreloads: ['/c/cart-badge.client.js'],
              prefetch: 'conservative',
              queries: ['cart'],
              route: '/cart',
              stylesheets: ['/assets/styles.css'],
              viewTransitions: ['product-p1-image'],
            },
          ],
        },
        { kind: 'page', target: '/cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-explain/v1\nPAGE /cart\nprefetch: conservative\nmeta: title=Kovo Commerce description=Browse products. image=-\ni18n: en-US:cartLabel,productStock\nmodulepreloads: /c/cart-badge.client.js\nstylesheets: /assets/styles.css\nqueries: cart\nview-transitions: product-p1-image\n',
    });
  });

  it('explains inherited app and route stylesheet hrefs in page order', () => {
    expect(
      kovoExplain(
        {
          pages: [
            {
              route: '/cart',
              stylesheets: ['/assets/app.css', '/assets/cart.css'],
            },
          ],
        },
        { kind: 'page', target: '/cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-explain/v1\nPAGE /cart\nprefetch: false\nmodulepreloads: -\nstylesheets: /assets/app.css,/assets/cart.css\nqueries: -\nview-transitions: -\n',
    });
  });

  it('explains route layout chains and per-layout queries on request', () => {
    expect(
      kovoExplain(
        {
          pages: [
            {
              layouts: [
                { name: 'AppLayout', queries: ['viewer', 'cart'] },
                { name: 'AdminLayout', queries: ['permissions'] },
              ],
              navigationSegments: [
                {
                  id: 'layout:AppLayout',
                  kind: 'layout',
                  name: 'AppLayout',
                  queries: ['viewer', 'cart'],
                },
                {
                  id: 'layout:AdminLayout',
                  kind: 'layout',
                  name: 'AdminLayout',
                  queries: ['permissions'],
                },
                {
                  components: ['AdminUsers'],
                  id: 'page:/admin',
                  kind: 'page',
                  name: 'page',
                },
              ],
              queries: ['adminUsers'],
              route: '/admin',
            },
          ],
        },
        { kind: 'page', layouts: true, target: '/admin' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'PAGE /admin',
        'prefetch: false',
        'modulepreloads: -',
        'stylesheets: -',
        'queries: adminUsers',
        'layouts: AppLayout,AdminLayout',
        'layout: AppLayout queries=viewer,cart',
        'layout: AdminLayout queries=permissions',
        'navigation-segments: layout:AppLayout,layout:AdminLayout,page:/admin',
        'segment: layout id=layout:AppLayout name=AppLayout queries=viewer,cart components=-',
        'segment: layout id=layout:AdminLayout name=AdminLayout queries=permissions components=-',
        'segment: page id=page:/admin name=page queries=- components=AdminUsers',
        'view-transitions: -',
        '',
      ].join('\n'),
    });
  });

  it('parses page --layouts for the CLI command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-explain-layouts-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          pages: [
            {
              layouts: [{ name: 'AppLayout', queries: ['viewer'] }],
              navigationSegments: [
                {
                  id: 'layout:AppLayout',
                  kind: 'layout',
                  name: 'AppLayout',
                  queries: ['viewer'],
                },
                {
                  id: 'page:/admin',
                  kind: 'page',
                  name: 'page',
                },
              ],
              route: '/admin',
            },
          ],
        }),
      );

      expect(main(['explain', 'page', '/admin', '--layouts', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-explain/v1',
        'PAGE /admin',
        'prefetch: false',
        'modulepreloads: -',
        'stylesheets: -',
        'queries: -',
        'layouts: AppLayout',
        'layout: AppLayout queries=viewer',
        'navigation-segments: layout:AppLayout,page:/admin',
        'segment: layout id=layout:AppLayout name=AppLayout queries=viewer components=-',
        'segment: page id=page:/admin name=page queries=- components=-',
        'view-transitions: -',
        '',
      ].join('\n'),
    );
  });

  it('returns a stable not-found diagnostic for missing explain targets', () => {
    expect(kovoExplain({}, { kind: 'component', target: 'Missing' })).toEqual({
      exitCode: 1,
      output: 'kovo-explain/v1\nERROR NOT_FOUND component Missing\n',
    });
  });
});
