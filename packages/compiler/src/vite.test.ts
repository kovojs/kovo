import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clientModuleContentVersion,
  clientModuleHrefForSourceFile,
} from '@kovojs/core/internal/client-module-url';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it, vi } from 'vitest';

import type { KovoViteMiddleware } from './internal.js';
import { kovoVitePlugin } from './index.js';
import { createKovoVitePlugin } from './vite.js';
import type { HmrImpactMetadata } from './types.js';

const cartBadgeSource = `
import { component } from '@kovojs/core';
import { removeItem } from './cart-actions';

export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`;

const kv201 = diagnosticDefinitions.KV201;
const kv210 = diagnosticDefinitions.KV210;
const kv235 = diagnosticDefinitions.KV235;
const kv236 = diagnosticDefinitions.KV236;
const kv330 = diagnosticDefinitions.KV330;
const kv437 = diagnosticDefinitions.KV437;

function createMiddlewareResponse(): {
  body: string;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  end(body: string): void;
} {
  return {
    body: '',
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

function findVersionedClientRef(
  source: string | undefined,
  modulePath: string,
): string | undefined {
  const escapedModulePath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source?.match(new RegExp(`/c/__v/[^"'\\s#]+/${escapedModulePath}(?=[#"'\\s])`))?.[0];
}

describe('kovoVitePlugin', () => {
  it('exposes a Vite transform hook for component modules', async () => {
    const plugin = kovoVitePlugin();

    expect(plugin.name).toBe('kovo');
    expect(await plugin.transform?.(cartBadgeSource, 'cart-badge.tsx')).toMatchObject({
      code: expect.stringContaining('export const CartBadge = component({'),
      map: null,
    });
  });

  it('unwraps compiler source-generator server artifacts for Vite execution', async () => {
    const plugin = createKovoVitePlugin(() => ({
      files: [
        {
          kind: 'server',
          source: `
// @kovojs-ir
export function renderSource() {
  return \`export const lowered = true;\`;
}
`,
        },
      ],
    }));

    expect(await plugin.transform('component(', 'src/cart-badge.tsx')).toEqual({
      code: 'export const lowered = true;',
      map: null,
    });
  });

  it('throws registry-error diagnostics from the Vite transform with teaching text', async () => {
    const onModuleDiagnostics = vi.fn();
    const plugin = createKovoVitePlugin(
      () => ({
        diagnostics: [
          {
            code: 'KV201',
            fileName: 'src/bad.tsx',
            help: kv201.help,
            length: 9,
            message: kv201.message,
            severity: kv201.severity,
            start: { line: 3, column: 12 },
          },
        ],
        files: [
          { kind: 'server', source: 'export function renderSource() {}' },
          { kind: 'client', source: 'export const Bad$button_click = () => null;' },
        ],
      }),
      { onModuleDiagnostics },
    );

    let thrown: unknown;
    try {
      await plugin.transform('component(', 'src/bad.tsx');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      [
        'Kovo Vite transform failed with 1 error diagnostic.',
        [
          'KV201 src/bad.tsx:3:12 Closure captures unserializable value.',
          ...kv201.help.split('\n').map((line) => `  help: ${line}`),
        ].join('\n'),
      ].join('\n\n'),
    );
    expect(onModuleDiagnostics).toHaveBeenCalledWith({
      diagnostics: [
        expect.objectContaining({
          code: 'KV201',
          fileName: 'src/bad.tsx',
          help: expect.stringContaining('SPEC §4.3 and §5.2'),
          length: 9,
          message: kv201.message,
          severity: kv201.severity,
          start: { line: 3, column: 12 },
        }),
      ],
      fileName: 'src/bad.tsx',
      source: 'component(',
    });
  });

  it.each([
    ['KV235', kv235],
    ['KV236', kv236],
    ['KV330', kv330],
    ['KV437', kv437],
  ] as const)('blocks Vite transform output for %s error diagnostics', async (code, definition) => {
    const plugin = createKovoVitePlugin(() => ({
      diagnostics: [
        {
          code,
          fileName: `src/${code.toLowerCase()}.tsx`,
          help: definition.help,
          length: 11,
          message: definition.message,
          severity: definition.severity,
          start: { line: 7, column: 15 },
        },
      ],
      files: [
        { kind: 'server', source: `export const leakedServer = "${code}";` },
        { kind: 'client', source: `export const leakedClient = "${code}";` },
      ],
    }));

    await expect(plugin.transform('component(', `src/${code.toLowerCase()}.tsx`)).rejects.toThrow(
      [
        'Kovo Vite transform failed with 1 error diagnostic.',
        [
          `${code} src/${code.toLowerCase()}.tsx:7:15 ${definition.message}`,
          ...definition.help.split('\n').map((line) => `  help: ${line}`),
        ].join('\n'),
      ].join('\n\n'),
    );
  });

  it('formats real compiler KV235, KV236, and KV437 diagnostics through Vite transform', async () => {
    const cases = [
      {
        fileName: 'src/real-kv235.tsx',
        source: `
import { component } from '@kovojs/core';

export const RealKv235 = component({
  render: () => \`<real-kv235 kovo-deps="cart"><span data-bind="cart.count">1</span></real-kv235>\`,
});
`,
      },
      {
        fileName: 'src/real-kv236.tsx',
        source: `
import { component } from '@kovojs/core';

export const RealKv236 = component({
  render: () => <a href="javascript:alert(1)">bad</a>,
});
`,
      },
      {
        fileName: 'src/real-kv437.tsx',
        source: `
import { component } from '@kovojs/core';
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from './secrets';

export const RealKv437 = component({
  render: () => <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>,
});
`,
      },
    ];

    const messages: string[] = [];
    const plugin = kovoVitePlugin();

    for (const { fileName, source } of cases) {
      try {
        await plugin.transform?.(source, fileName);
      } catch (error) {
        messages.push((error as Error).message);
      }
    }

    expect(messages).toMatchInlineSnapshot(`
      [
        "Kovo Vite transform failed with 1 error diagnostic.

      KV235 src/real-kv235.tsx:5:17 App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.
        help: Blocked reason: app source is hand-authoring lowered string/render IR instead of TSX.
        help: Fixes: write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.
        help: SPEC §5.2: TSX is the sole app-authoring surface.
        help: Escape: there is no v1 suppression or ejection workflow for hand-authored lowered IR.
        help: TSX equivalent direction: render with JSX, for example \`render: (...) => (<real-kv235>...</real-kv235>)\`, and use typed expressions such as \`{cart.count}\` instead of data-bind strings.",
        "Kovo Vite transform failed with 1 error diagnostic.

      KV236 src/real-kv236.tsx:5:20 Unsafe output context requires an explicit trusted Kovo escape hatch. href="javascript:alert(1)" uses an unsafe URL scheme
        help: Blocked reason: the output context can execute script, navigate unexpectedly, inject unsafe CSS, or bypass normal JSX escaping.
        help: Fixes: route URLs through typed route helpers; mark intentional external links with external; keep dynamic styling to compiler-generated safe properties; or pass raw HTML only as a Kovo TrustedHtml value.
        help: SPEC §1 and §5.2 require compiler output to be auditable; unsafe output contexts cannot depend on implicit browser or runtime sanitization.",
        "Kovo Vite transform failed with 1 error diagnostic.

      KV437 src/real-kv437.tsx:7:52 Server-only value captured into a client handler reaches the client bundle. import="STRIPE_SECRET_KEY" from="./secrets" form=named
        help: Would lower to: a client handler module whose captured cross-module imports all resolve to serializable literals or whitelisted client symbols.
        help: Blocked reason: a client handler closure that captures a server-only binding (a secret/process.env-derived value, or any cross-module import not provably client-safe) re-emits it verbatim into the client bundle, leaking confidential server state to the browser.
        help: Fixes: do not capture the server value in client code; pass a server-computed safe value as a prop, or use publishToClient(value, { reason }) as the audited escape, surfaced in kovo explain --capabilities.
        help: SPEC §6.6/§6.2 and secure-framework Phase 4/Tier 0: the emit filter is fail-closed whole-channel (a narrow process.env/brand-only gate is unsound — call-wrapped secrets escape).",
      ]
    `);
  });

  it('reports warn, lint, and notice diagnostics without blocking the Vite transform', async () => {
    const onDiagnostic = vi.fn();
    const plugin = createKovoVitePlugin(
      () => ({
        diagnostics: [
          {
            code: 'KV311',
            fileName: 'src/diagnostics.tsx',
            message: 'Query/state-dependent DOM position has no update status.',
            severity: 'warn',
            start: { line: 4, column: 9 },
          },
          {
            code: 'KV210',
            fileName: 'src/diagnostics.tsx',
            message: kv210.message,
            severity: 'lint',
            start: { line: 5, column: 11 },
          },
          {
            code: 'KV409',
            fileName: 'src/diagnostics.tsx',
            message: 'Non-eq predicate degraded to table-level invalidation.',
            severity: 'notice',
            start: { line: 6, column: 13 },
          },
        ],
        files: [
          { kind: 'server', source: 'export function renderSource() {}' },
          { kind: 'client', source: 'export const Diagnostics$button_click = () => null;' },
        ],
      }),
      { onDiagnostic },
    );

    expect(await plugin.transform('component(', 'src/diagnostics.tsx')).toEqual({
      code: 'export function renderSource() {}',
      map: null,
    });
    expect(onDiagnostic).toHaveBeenCalledTimes(3);
    expect(onDiagnostic.mock.calls.map(([diagnostic]) => diagnostic.code)).toEqual([
      'KV311',
      'KV210',
      'KV409',
    ]);
  });

  it('does not retain emitted client modules from transforms with error diagnostics', async () => {
    const plugin = createKovoVitePlugin(() => ({
      diagnostics: [
        {
          code: 'KV236' as const,
          fileName: 'src/unsafe-link.tsx',
          message: kv236.message,
          severity: kv236.severity,
          start: { line: 4, column: 18 },
        },
      ],
      files: [
        { kind: 'server', source: 'export const unsafeServer = true;' },
        { kind: 'client', source: 'export const unsafeClient = true;' },
      ],
      hmrImpact: hmrMetadata({ clientHref: '/c/__v/unsafe/src/unsafe-link.client.js' }),
    }));
    const middlewares: KovoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    await expect(plugin.transform('component(', 'src/unsafe-link.tsx')).rejects.toThrow('KV236');

    const res = createMiddlewareResponse();
    const next = vi.fn();
    middlewares[0]?.({ url: '/c/__v/unsafe/src/unsafe-link.client.js' }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBe('');
  });

  it('serves emitted client modules from Vite dev middleware', async () => {
    const plugin = kovoVitePlugin();
    const middlewares: KovoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const transformed = await plugin.transform?.(cartBadgeSource, 'components/cart/cart-badge.tsx');
    const clientRef = findVersionedClientRef(
      transformed?.code,
      'components/cart/cart-badge.client.js',
    );
    expect(clientRef).toBeDefined();
    const res = {
      body: '',
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(body: string) {
        this.body = body;
      },
    };
    const next = vi.fn();

    middlewares[0]?.({ url: clientRef ?? '' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.headers).toEqual({
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Type': 'text/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(res.body).toContain('export const CartBadge$button_click');
    expect(res.body).toContain('return removeItem(ctx.state, ctx.params.id);');
  });

  it('serves Vite dev client modules through the shared URL ABI request key', async () => {
    const clientSource = 'export const SharedAbi$button_click = () => true;';
    const plugin = createKovoVitePlugin(() => ({
      files: [
        { kind: 'server', source: 'export function renderSource() {}' },
        { kind: 'client', source: clientSource },
      ],
    }));
    const middlewares: KovoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    await plugin.transform('component(', 'src/shared-abi.tsx');

    const version = clientModuleContentVersion(clientSource);
    const versionedPath = clientModuleHrefForSourceFile('src/shared-abi.tsx', version);
    const queryVersionedPath = `/c/src/shared-abi.client.js?v=${version}`;
    for (const href of [versionedPath, queryVersionedPath]) {
      const res = createMiddlewareResponse();
      const next = vi.fn();

      middlewares[0]?.({ url: href }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body).toBe(clientSource);
      expect(res.headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
      expect(res.headers['Cache-Control']).toBe('no-store');
    }
  });

  it('surfaces a deduped CSS asset manifest for transformed app components', async () => {
    const plugin = createKovoVitePlugin(() => ({
      cssAssets: [
        {
          componentName: 'cart-badge',
          criticalCss: '.cart-badge{color:teal}',
          fragmentTargets: ['components/cart/cart-badge/cart-badge'],
          href: '/assets/components/cart/cart-badge.css',
          sourceFileName: 'components/cart/cart-badge.css',
        },
      ],
      files: [{ kind: 'server', source: 'export function renderSource() {}' }],
    }));

    await plugin.transform('component(', 'components/cart/cart-badge.tsx');
    await plugin.transform('component(', 'components/cart/cart-badge.tsx');

    expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([
      expect.objectContaining({
        componentName: 'cart-badge',
        criticalCss: '.cart-badge{color:teal}',
        fragmentTargets: ['components/cart/cart-badge/cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      }),
    ]);
  });

  it('uses the resolved Vite root for build CSS asset names', async () => {
    const compiledFileNames: string[] = [];
    const plugin = createKovoVitePlugin((options) => {
      compiledFileNames.push(options.fileName);
      return {
        cssAssets: [
          {
            componentName: 'cart-badge',
            criticalCss: '.cart-badge{color:teal}',
            fragmentTargets: ['src/cart-badge/cart-badge'],
            href: '/assets/src/cart-badge.css',
            sourceFileName: 'src/cart-badge.css',
          },
        ],
        files: [{ kind: 'server', source: 'export function renderSource() {}' }],
      };
    });

    plugin.configResolved?.({ root: '/workspace/app' });
    await plugin.transform('component(', '/workspace/app/src/cart-badge.tsx');

    expect(compiledFileNames).toEqual(['src/cart-badge.tsx']);
    expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([
      expect.objectContaining({
        href: '/assets/src/cart-badge.css',
        sourceFileName: 'src/cart-badge.css',
      }),
    ]);
  });

  it('serves project-relative client modules when Vite passes absolute ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-absolute-id-'));
    const plugin = kovoVitePlugin();
    const middlewares: KovoViteMiddleware[] = [];
    try {
      plugin.configureServer?.({
        config: { root },
        middlewares: {
          use(handler) {
            middlewares.push(handler);
          },
        },
      });

      const transformed = await plugin.transform?.(
        cartBadgeSource,
        join(root, 'src/components/cart/cart-badge.tsx'),
      );
      const clientRef = findVersionedClientRef(
        transformed?.code,
        'src/components/cart/cart-badge.client.js',
      );
      expect(clientRef).toBeDefined();
      expect(transformed?.code).not.toContain(root);

      const res = {
        body: '',
        headers: {} as Record<string, string>,
        setHeader(name: string, value: string) {
          this.headers[name] = value;
        },
        end(body: string) {
          this.body = body;
        },
      };

      middlewares[0]?.({ url: clientRef ?? '' }, res, vi.fn());

      expect(res.body).toContain('export const CartBadge$button_click');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('blocks direct Vite client-module load when compilation reports an error diagnostic', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-client-load-error-'));
    const sourceFile = join(root, 'src/secret-button.tsx');
    const plugin = createKovoVitePlugin(() => ({
      diagnostics: [
        {
          code: 'KV437' as const,
          fileName: 'src/secret-button.tsx',
          help: kv437.help,
          message: kv437.message,
          severity: kv437.severity,
          start: { line: 6, column: 28 },
        },
      ],
      files: [
        { kind: 'server', source: 'export const blockedServer = true;' },
        { kind: 'client', source: 'export const leakedSecret = true;' },
      ],
    }));

    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(sourceFile, 'component(');
      plugin.configResolved?.({ root });

      await expect(plugin.load?.(join(root, 'src/secret-button.client.js'))).rejects.toThrow(
        [
          'Kovo Vite transform failed with 1 error diagnostic.',
          [
            'KV437 src/secret-button.tsx:6:28 Server-only value captured into a client handler reaches the client bundle.',
            ...kv437.help.split('\n').map((line) => `  help: ${line}`),
          ].join('\n'),
        ].join('\n\n'),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('feeds discovered package prefix facts into the Vite transform', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-prefix-'));

    try {
      writePackageManifest(root, '@acme/primitives', {
        kovo: { prefix: 'dupe-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/widgets', {
        kovo: { prefix: 'dupe-' },
        name: '@other/widgets',
      });

      const plugin = kovoVitePlugin();
      plugin.configureServer?.({
        config: { root },
        middlewares: {
          use() {},
        },
      });

      await expect(
        Promise.resolve().then(() =>
          plugin.transform?.(
            `
import { component } from '@kovojs/core';
import '@acme/primitives';
import '@other/widgets/menu';

export const Shell = component({
  render: () => <section></section>,
});
`,
            join(root, 'src/shell.tsx'),
          ),
        ),
      ).rejects.toThrow(
        'Package component prefix registration conflict or reservation violation. Effective package prefix "dupe-" is claimed by @acme/primitives and @other/widgets.',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('retains old versioned client modules after a newer transform', async () => {
    const plugin = kovoVitePlugin();
    const middlewares: KovoViteMiddleware[] = [];
    const source = (handler: string) => `
import { component } from '@kovojs/core';
import { ${handler} } from './cart-actions';

export const CartBadge = component({
  render: () => <button onClick={${handler}}>Add</button>,
});
`;
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const first = await plugin.transform?.(source('removeItem'), 'components/cart/cart-badge.tsx');
    const oldClientRef = findVersionedClientRef(
      first?.code,
      'components/cart/cart-badge.client.js',
    );
    const second = await plugin.transform?.(source('clearCart'), 'components/cart/cart-badge.tsx');
    const newClientRef = findVersionedClientRef(
      second?.code,
      'components/cart/cart-badge.client.js',
    );
    const oldResponse = createMiddlewareResponse();
    const newResponse = createMiddlewareResponse();

    expect(oldClientRef).toBeDefined();
    expect(newClientRef).toBeDefined();
    expect(newClientRef).not.toBe(oldClientRef);

    middlewares[0]?.({ url: oldClientRef ?? '' }, oldResponse, vi.fn());
    middlewares[0]?.({ url: newClientRef ?? '' }, newResponse, vi.fn());

    expect(oldResponse.body).toContain('return removeItem(event, ctx);');
    expect(newResponse.body).toContain('return clearCart(event, ctx);');
  });

  it('passes through unknown Vite dev middleware requests', () => {
    const plugin = kovoVitePlugin();
    const middlewares: KovoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });
    const res = {
      end: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    middlewares[0]?.({ url: '/src/app.tsx' }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();
  });

  it('scopes transforms with include and exclude filters', async () => {
    const compileComponentModule = vi.fn(() => ({
      files: [{ kind: 'server', source: 'export function renderSource() {}' }],
    }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      exclude: ['src/components/private'],
      include: ['src/components'],
    });

    expect(await plugin.transform('component(', 'src/fixtures/fake.tsx')).toBeNull();
    expect(await plugin.transform('component(', 'src/components/private/secret.tsx')).toBeNull();
    expect(await plugin.transform('component(', 'src/components/cart-badge.tsx')).toEqual({
      code: 'export function renderSource() {}',
      map: null,
    });
    expect(compileComponentModule).toHaveBeenCalledTimes(1);
  });

  it('passes registry facts to the compile step', async () => {
    const compileComponentModule = vi.fn(() => ({
      files: [{ kind: 'server', source: 'export function renderSource() {}' }],
    }));
    const registryFacts = {
      mutationInputs: {
        'cart/add': [
          {
            coercion: 'string' as const,
            defaulted: false,
            name: 'productId',
            optional: false,
            provenance: 'registry' as const,
            required: true,
          },
        ],
      },
      mutations: { 'cart/add': 'typeof addToCart' },
    };
    const plugin = createKovoVitePlugin(compileComponentModule, { registryFacts });

    await plugin.transform('component(', 'src/cart-badge.tsx');

    expect(compileComponentModule).toHaveBeenCalledWith(expect.objectContaining({ registryFacts }));
  });

  it('caches repeated transforms by source hash and compile context', async () => {
    const compileComponentModule = vi.fn(({ source }: { source: string }) => ({
      dependencyFootprint: {},
      files: [{ kind: 'server', source: `export const sourceLength = ${source.length};` }],
    }));
    const plugin = createKovoVitePlugin(compileComponentModule);
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-persistent-cache-'));
    plugin.configResolved?.({ root } as never);

    try {
      expect((await plugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        'export const sourceLength = 10;',
      );
      expect((await plugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        'export const sourceLength = 10;',
      );
      expect((await plugin.transform('component(1)', 'src/cart-badge.tsx'))?.code).toBe(
        'export const sourceLength = 12;',
      );
      expect(compileComponentModule).toHaveBeenCalledTimes(2);

      const secondCompile = vi.fn(() => ({
        dependencyFootprint: {},
        files: [{ kind: 'server', source: 'export const sourceLength = -1;' }],
      }));
      const secondPlugin = createKovoVitePlugin(secondCompile);
      secondPlugin.configResolved?.({ root } as never);
      expect((await secondPlugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        'export const sourceLength = 10;',
      );
      expect(secondCompile).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bypasses compiler caches when cache is false', async () => {
    const compileComponentModule = vi.fn(({ source }: { source: string }) => ({
      dependencyFootprint: {},
      files: [{ kind: 'server', source: `export const sourceLength = ${source.length};` }],
    }));
    const plugin = createKovoVitePlugin(compileComponentModule, { cache: false });
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-no-cache-'));
    plugin.configResolved?.({ root } as never);

    try {
      expect((await plugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        'export const sourceLength = 10;',
      );
      expect((await plugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        'export const sourceLength = 10;',
      );
      expect(compileComponentModule).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sends a Kovo component-render HMR event for classified component refreshes', async () => {
    const ws = { send: vi.fn() };
    const previous = hmrMetadata({
      clientHref: '/c/__v/11111111/src/counter.client.js',
      factHash: 'previous',
    });
    const next = hmrMetadata({
      clientHref: '/c/__v/22222222/src/counter.client.js',
      factHash: 'next',
    });
    const plugin = createKovoVitePlugin(
      vi
        .fn()
        .mockReturnValueOnce(compileResult(previous, 'export const oldHandler = () => null;'))
        .mockReturnValueOnce(compileResult(next, 'export const newHandler = () => null;')),
    );
    plugin.configureServer?.({
      config: { root: '/workspace/app' },
      middlewares: { use() {} },
      ws,
    });

    await plugin.transform('component(', '/workspace/app/src/counter.tsx');
    const modules = await plugin.handleHotUpdate?.({
      file: '/workspace/app/src/counter.tsx',
      modules: ['vite-module'],
      read: async () => 'component(updated)',
      server: {
        config: { root: '/workspace/app' },
        middlewares: { use() {} },
        ws,
      },
    });

    expect(modules).toEqual([]);
    expect(ws.send).toHaveBeenCalledWith({
      data: expect.objectContaining({
        impact: 'componentRefresh',
        liveTargets: ['counter'],
        newClientHref: '/c/__v/22222222/src/counter.client.js',
        oldClientHref: '/c/__v/11111111/src/counter.client.js',
        reasons: ['handler-only'],
        sourceFile: 'src/counter.tsx',
      }),
      event: 'kovo:component-render',
      type: 'custom',
    });
    expect(ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('sends Kovo diagnostics HMR events for compiler errors without throwing', async () => {
    const ws = { send: vi.fn() };
    const diagnostic = {
      code: 'KV201' as const,
      fileName: 'src/counter.tsx',
      message: kv201.message,
      severity: kv201.severity,
    };
    const previous = hmrMetadata({ factHash: 'previous' });
    const next = hmrMetadata({
      diagnostics: [{ code: 'KV201', message: kv201.message, severity: kv201.severity }],
      factHash: 'diagnostic',
    });
    const plugin = createKovoVitePlugin(
      vi
        .fn()
        .mockReturnValueOnce(compileResult(previous, 'export const oldHandler = () => null;'))
        .mockReturnValueOnce({
          ...compileResult(next, 'export const brokenHandler = () => null;'),
          diagnostics: [diagnostic],
        }),
    );
    const server = {
      config: { root: '/workspace/app' },
      middlewares: { use() {} },
      ws,
    };
    plugin.configureServer?.(server);

    await plugin.transform('component(', '/workspace/app/src/counter.tsx');
    const modules = await plugin.handleHotUpdate?.({
      file: '/workspace/app/src/counter.tsx',
      modules: ['vite-module'],
      read: async () => 'component(broken)',
      server,
    });

    expect(modules).toEqual([]);
    expect(ws.send).toHaveBeenCalledWith({
      data: expect.objectContaining({
        diagnostics: [{ code: 'KV201', message: kv201.message, severity: kv201.severity }],
        impact: 'diagnosticError',
        reasons: ['diagnostics'],
        sourceFile: 'src/counter.tsx',
      }),
      event: 'kovo:diagnostics',
      type: 'custom',
    });
    expect(ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('delegates unsafe Kovo hot updates to Vite full reload', async () => {
    const ws = { send: vi.fn() };
    const next = hmrMetadata({ factHash: 'unsafe', liveTargetFacts: [] });
    const plugin = createKovoVitePlugin(
      vi.fn().mockReturnValueOnce(compileResult(next, 'export const handler = () => null;')),
    );
    const server = {
      config: { root: '/workspace/app' },
      middlewares: { use() {} },
      ws,
    };
    plugin.configureServer?.(server);

    const modules = await plugin.handleHotUpdate?.({
      file: '/workspace/app/src/counter.tsx',
      modules: ['vite-module'],
      read: async () => 'component(',
      server,
    });

    expect(modules).toEqual([]);
    expect(ws.send).toHaveBeenCalledWith({
      data: expect.objectContaining({
        impact: 'fullReload',
        reasons: ['missing-facts'],
        sourceFile: 'src/counter.tsx',
      }),
      event: 'kovo:full-reload',
      type: 'custom',
    });
    expect(ws.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });
});

function compileResult(hmrImpact: HmrImpactMetadata, clientSource: string) {
  return {
    diagnostics: [],
    files: [
      { kind: 'server', source: 'export function renderSource() {}' },
      { kind: 'client', source: clientSource },
    ],
    hmrImpact,
  };
}

function hmrMetadata({
  clientHref = '/c/__v/11111111/src/counter.client.js',
  diagnostics = [],
  factHash = 'fact',
  liveTargetFacts = [
    {
      component: 'components/counter/counter',
      coverage: [],
      identityProps: [],
      propsType: 'CounterProps',
      queryBindings: [],
      queries: [],
      target: 'counter',
      targetBase: 'counter',
    },
  ],
}: {
  clientHref?: string;
  diagnostics?: HmrImpactMetadata['diagnostics'];
  factHash?: string;
  liveTargetFacts?: HmrImpactMetadata['liveTargetFacts'];
} = {}): HmrImpactMetadata {
  return {
    clientHref,
    component: { domLeaf: 'Counter', registryKey: 'Counter' },
    diagnostics,
    factHash,
    liveTargetFacts,
    liveTargetFactsHash: 'live-targets',
    queryUpdatePlanHash: 'queries',
    renderOutputHash: 'render',
    routeShellHash: null,
    sourceFileName: 'src/counter.tsx',
    sourceKind: 'component',
    stylesheetAssets: [],
    stylesheetAssetsHash: 'styles',
  };
}

function writePackageManifest(
  root: string,
  packageName: string,
  manifest: Record<string, unknown>,
): void {
  const dir = join(root, 'node_modules', ...packageName.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
}
