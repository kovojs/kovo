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
            csrf: 'exempt',
            csrfJustification: 'oauth callback',
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
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
          },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      UNGUARDED
      ENDPOINT auth/mount method=GET path=/auth mount=prefix auth=none csrf=exempt:oauth callback
      SUMMARY total=1
      "
    `);
  });

  it('audits access decisions with stable explain output', () => {
    const result = kovoExplain(
      {
        access: [
          {
            decision: 'missing',
            detail: 'no access property',
            kind: 'query',
            name: 'explicit-missing',
            site: 'queries.ts:4',
            source: 'access',
          },
        ],
        endpoints: [
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
            surface: 'webhook',
          },
          {
            auth: 'none',
            csrf: 'checked',
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
      ACCESS ENDPOINT health decision=public source=auth site=- detail="method=GET path=/healthz mount=exact auth=none csrf=checked" justification=-
      ACCESS ENDPOINT raw decision=missing source=legacy-guard site=- detail="method=GET path=/raw mount=exact auth=- csrf=checked" justification=-
      ACCESS MUTATION cart/add decision=guard source=legacy-guard site=- detail="guards=authed writes=cart invalidates=- manual-invalidates=-" justification=-
      ACCESS MUTATION inventory/sync decision=missing source=legacy-guard site=- detail="guards=- writes=product invalidates=- manual-invalidates=-" justification=-
      ACCESS PAGE /cart decision=guard source=legacy-guard site=- detail="guards=authed queries=cart" justification=-
      ACCESS PAGE /login decision=missing source=legacy-guard site=- detail="guards=- queries=-" justification=-
      ACCESS QUERY cart decision=guard source=legacy-guard site=- detail="guards=authed reads=cart" justification=-
      ACCESS QUERY catalog decision=missing source=legacy-guard site=- detail="guards=- reads=product" justification=-
      ACCESS QUERY explicit-missing decision=missing source=access site=queries.ts:4 detail="no access property" justification=-
      ACCESS WEBHOOK stripe/webhook decision=verified source=auth site=- detail="method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook" justification="signed stripe webhook"
      SUMMARY total=10 guard=3 verified=1 public=1 missing=5
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
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
            rateLimit: 'webhook:stripe',
            surface: 'webhook',
            writes: ['order'],
          },
          {
            auth: 'custom:api-key',
            body: 'bytes',
            bodySize: 'stream',
            cache: 'private,no-store',
            csrf: 'checked',
            files: ['inventory.bin'],
            headers: ['Content-Disposition', 'Content-Type'],
            method: 'GET',
            name: 'inventory/download',
            path: '/downloads/inventory.bin',
            rateLimit: 'download:user',
            surface: 'route-file',
          },
        ],
      },
      { endpoints: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      ENDPOINTS
      ENDPOINT inventory/download surface=route-file method=GET path=/downloads/inventory.bin mount=exact auth=custom:api-key csrf=checked cache=private,no-store body=bytes bodySize=stream rateLimit=download:user headers=Content-Disposition,Content-Type files=inventory.bin dynamic=- writes=-
      ENDPOINT stripe/webhook surface=webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook cache=no-store body=raw bodySize=1mb rateLimit=webhook:stripe headers=Stripe-Signature files=- dynamic=- writes=order
      SUMMARY total=2
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

  it('prints capability escapes with stable explain output', () => {
    const result = kovoExplain(
      {
        capabilities: [
          {
            detail: 'types=image/png,image/webp',
            kind: 'acceptUnverified',
            reason: 'legacy upload picker still gates client-side image types before storage',
            site: 'profile/avatar.ts:18',
            source: "['image/png', 'image/webp']",
          },
          {
            column: 'role',
            kind: 'adminAssign',
            reason: 'support role correction',
            site: 'account.domain.ts:10',
            source: 'input.role',
            table: 'accounts',
          },
          {
            kind: 'publishToClient',
            reason: 'prefix is intentionally public for support correlation',
            site: 'components/cart/cart-badge.tsx#KEY_PREFIX',
            source: 'process.env.API_KEY.slice(0, 4)',
          },
          {
            detail: 'scope=reports/*,method=GET,oneTime=yes',
            kind: 'capabilityUrl',
            reason: 'download link for a verified report recipient',
            site: 'reports/download.ts:42',
            source: 'request.signUrl',
          },
          {
            detail: 'host=otel:4318',
            kind: 'egressAllowInternal',
            reason: 'local telemetry collector',
            site: 'app.ts#egress.allowInternal[0]',
            source: 'otel:4318',
          },
          {
            detail: 'mode=instance-role',
            kind: 'cloudMetadata',
            site: 'app.ts#cloud.aws',
            source: 'aws',
          },
          {
            kind: 'cspAllow',
            reason: 'Stripe checkout frame',
            site: 'app.ts#document.csp.allow.frames',
            source: 'https://checkout.stripe.com',
          },
          {
            kind: 'unsafeRegex',
            reason: 'legacy SKU format reviewed for bounded input',
            site: 'schema/product.ts:21',
            source: '/^([A-Z]+)+$/',
          },
        ],
        cookies: [
          {
            class: 'auth',
            downgraded: ['sameSiteNone'],
            floor: 'HttpOnly; Secure; SameSite=None',
            justification: 'embedded checkout flow requires cross-site callback',
            name: 'embed_sid',
            site: 'auth/embed.ts:12',
            source: 'builder',
          },
        ],
        revealed: [
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
      { capabilities: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      CAPABILITIES
      CAPABILITY capability=adminAssign owner=auth.data-authorization surface=write source="input.role" sink="db.write:accounts.role" site=account.domain.ts:10 detail="tableColumn=accounts.role" justification="support role correction"
      CAPABILITY capability=publishToClient owner=confidentiality.client-module surface=client source="process.env.API_KEY.slice(0, 4)" sink="client-module" site=components/cart/cart-badge.tsx#KEY_PREFIX detail=- justification="prefix is intentionally public for support correlation"
      CAPABILITY capability=confidentialityReveal owner=confidentiality.query-wire surface=query source="users.email" sink="query:admin/users.emailDomain" site=app/queries/users.ts:18 detail="grade=proof,method=server-projection,selectedSecret=no" justification="server SQL projects only the email domain"
      CAPABILITY capability=capabilityUrl owner=file.storage.static-export surface=storage source="request.signUrl" sink="capability-url" site=reports/download.ts:42 detail="scope=reports/*,method=GET,oneTime=yes" justification="download link for a verified report recipient"
      CAPABILITY capability=acceptUnverified owner=file.storage.static-export surface=upload source="['image/png', 'image/webp']" sink="upload.content-type" site=profile/avatar.ts:18 detail="types=image/png,image/webp" justification="legacy upload picker still gates client-side image types before storage"
      CAPABILITY capability=cspAllow owner=html.dom.output surface=document source="https://checkout.stripe.com" sink="csp-allowlist" site=app.ts#document.csp.allow.frames detail=- justification="Stripe checkout frame"
      CAPABILITY capability=unsafeCookie owner=http.header.cookie surface=response source="builder" sink="Set-Cookie:embed_sid" site=auth/embed.ts:12 detail="class=auth,floor=HttpOnly; Secure; SameSite=None,downgraded=sameSiteNone" justification="embedded checkout flow requires cross-site callback"
      CAPABILITY capability=cloudMetadata owner=network.egress surface=egress source="aws" sink="cloud-metadata" site=app.ts#cloud.aws detail="mode=instance-role" justification=-
      CAPABILITY capability=egressAllowInternal owner=network.egress surface=egress source="otel:4318" sink="internal-network" site=app.ts#egress.allowInternal[0] detail="host=otel:4318" justification="local telemetry collector"
      CAPABILITY capability=unsafeRegex owner=resource.regex surface=schema source="/^([A-Z]+)+$/" sink="RegExp" site=schema/product.ts:21 detail=- justification="legacy SKU format reviewed for bounded input"
      SUMMARY total=10
      "
    `);
  });

  it('prints cookie floors and downgrades with stable explain output', () => {
    const result = kovoExplain(
      {
        cookies: [
          {
            class: 'session',
            floor: 'HttpOnly; Secure; SameSite=Lax',
            name: 'sid',
            site: 'auth/callback.ts:18',
            source: 'forwarded',
          },
          {
            class: 'auth',
            downgraded: ['sameSiteNone'],
            floor: 'HttpOnly; Secure; SameSite=None',
            justification: 'embedded cross-site login requires CHIPS',
            name: 'embed_sid',
            sealed: 'hmac-sha256',
            site: 'auth/embed.ts:12',
            source: 'builder',
          },
        ],
      },
      { cookies: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "kovo-explain/v1
      COOKIES
      COOKIE name=embed_sid class=auth source=builder floor="HttpOnly; Secure; SameSite=None" sealed=hmac-sha256 downgraded=sameSiteNone site=auth/embed.ts:12 justification="embedded cross-site login requires CHIPS"
      COOKIE name=sid class=session source=forwarded floor="HttpOnly; Secure; SameSite=Lax" sealed=- downgraded=- site=auth/callback.ts:18 justification=-
      SUMMARY total=2 forwarded=1 downgraded=1 sealed=1
      "
    `);
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

  it('accepts kovo explain --capabilities as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-capabilities-'));
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
          capabilities: [
            {
              kind: 'unsafeRegex',
              reason: 'bounded import file format',
              site: 'schema/import.ts:7',
              source: '/^(a+)+$/',
            },
          ],
        }),
      );

      expect(main(['explain', '--capabilities', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-explain/v1',
        'CAPABILITIES',
        'CAPABILITY capability=unsafeRegex owner=resource.regex surface=schema source="/^(a+)+$/" sink="RegExp" site=schema/import.ts:7 detail=- justification="bounded import file format"',
        'SUMMARY total=1',
        '',
      ].join('\n'),
    );
  });

  it('accepts kovo explain --cookies as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-cookies-'));
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
          cookies: [
            {
              class: 'session',
              floor: 'HttpOnly; Secure; SameSite=Lax',
              name: 'better-auth.session_token',
              site: 'auth/callback.ts:18',
              source: 'forwarded',
            },
          ],
        }),
      );

      expect(main(['explain', '--cookies', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'kovo-explain/v1',
        'COOKIES',
        'COOKIE name=better-auth.session_token class=session source=forwarded floor="HttpOnly; Secure; SameSite=Lax" sealed=- downgraded=- site=auth/callback.ts:18 justification=-',
        'SUMMARY total=1 forwarded=1 downgraded=0 sealed=0',
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

  it('records every public access decision in a stable reviewed snapshot', () => {
    const result = kovoExplain(
      {
        access: [
          {
            decision: 'public',
            justification: 'anonymous cart add is CSRF-protected and writes no identity',
            kind: 'mutation',
            name: 'cart/add',
            site: 'cart.mutations.ts:12',
            source: 'access',
          },
          {
            decision: 'public',
            justification: 'public health probe',
            kind: 'endpoint',
            name: '/healthz',
            site: 'health.ts:4',
            source: 'access',
          },
          {
            decision: 'public',
            justification: 'marketing landing page',
            kind: 'page',
            name: '/',
            site: 'routes/index.tsx:3',
            source: 'access',
          },
          {
            decision: 'public',
            justification: 'public product catalog',
            kind: 'query',
            name: 'catalog',
            site: 'catalog.query.ts:7',
            source: 'access',
          },
        ],
      },
      { access: true },
    );

    expect(result).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'ACCESS',
        'ACCESS ENDPOINT /healthz decision=public source=access site=health.ts:4 detail=- justification="public health probe"',
        'ACCESS MUTATION cart/add decision=public source=access site=cart.mutations.ts:12 detail=- justification="anonymous cart add is CSRF-protected and writes no identity"',
        'ACCESS PAGE / decision=public source=access site=routes/index.tsx:3 detail=- justification="marketing landing page"',
        'ACCESS QUERY catalog decision=public source=access site=catalog.query.ts:7 detail=- justification="public product catalog"',
        'SUMMARY total=4 guard=0 verified=0 public=4 missing=0',
        '',
      ].join('\n'),
    });
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
