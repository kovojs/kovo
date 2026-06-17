import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diagnosticDefinitions } from '@kovojs/core';
import { describe, expect, it, vi } from 'vitest';

import { kovoVitePlugin, type KovoViteMiddleware } from './index.js';
import { createKovoVitePlugin } from './vite.js';

const cartBadgeSource = `
import { component } from '@kovojs/core';
import { removeItem } from './cart-actions';

export const CartBadge = component({
  fragmentTarget: true,
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

describe('kovoVitePlugin', () => {
  it('exposes a Vite transform hook for component modules', () => {
    const plugin = kovoVitePlugin();

    expect(plugin.name).toBe('kovo');
    expect(plugin.transform?.(cartBadgeSource, 'cart-badge.tsx')).toMatchObject({
      code: expect.stringContaining('export function renderSource()'),
      map: null,
    });
  });

  it('throws registry-error diagnostics from the Vite transform with teaching text', () => {
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
      plugin.transform('component(', 'src/bad.tsx');
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

  it('reports warn, lint, and notice diagnostics without blocking the Vite transform', () => {
    const onDiagnostic = vi.fn();
    const plugin = createKovoVitePlugin(
      () => ({
        diagnostics: [
          {
            code: 'KV311',
            fileName: 'src/diagnostics.tsx',
            message: 'Query/state-dependent DOM position has no update status.',
            severity: 'error',
            start: { line: 4, column: 9 },
          },
          {
            code: 'KV210',
            fileName: 'src/diagnostics.tsx',
            message: kv210.message,
            severity: 'error',
            start: { line: 5, column: 11 },
          },
          {
            code: 'KV409',
            fileName: 'src/diagnostics.tsx',
            message: 'Non-eq predicate degraded to table-level invalidation.',
            severity: 'error',
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

    expect(plugin.transform('component(', 'src/diagnostics.tsx')).toEqual({
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

  it('serves emitted client modules from Vite dev middleware', () => {
    const plugin = kovoVitePlugin();
    const middlewares: KovoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const transformed = plugin.transform?.(cartBadgeSource, 'components/cart/cart-badge.tsx');
    const clientRef = transformed?.code.match(
      /\/c\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
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
    expect(res.headers['Content-Type']).toBe('text/javascript');
    expect(res.body).toContain('export const CartBadge$button_click');
    expect(res.body).toContain('return removeItem(ctx.state, ctx.params.id);');
  });

  it('serves project-relative client modules when Vite passes absolute ids', () => {
    const plugin = kovoVitePlugin();
    const middlewares: KovoViteMiddleware[] = [];
    plugin.configureServer?.({
      config: { root: '/workspace/app' },
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const transformed = plugin.transform?.(
      cartBadgeSource,
      '/workspace/app/src/components/cart/cart-badge.tsx',
    );
    const clientRef = transformed?.code.match(
      /\/c\/src\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
    expect(clientRef).toBeDefined();
    expect(transformed?.code).not.toContain('/c/workspace/app/');

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
  });

  it('feeds discovered package prefix facts into the Vite transform', () => {
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

      expect(() =>
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
      ).toThrow(
        'Package component prefix registration conflict or reservation violation. Effective package prefix "dupe-" is claimed by @acme/primitives and @other/widgets.',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('retains old versioned client modules after a newer transform', () => {
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

    const first = plugin.transform?.(source('removeItem'), 'components/cart/cart-badge.tsx');
    const oldClientRef = first?.code.match(
      /\/c\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
    const second = plugin.transform?.(source('clearCart'), 'components/cart/cart-badge.tsx');
    const newClientRef = second?.code.match(
      /\/c\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
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
});

function writePackageManifest(
  root: string,
  packageName: string,
  manifest: Record<string, unknown>,
): void {
  const dir = join(root, 'node_modules', ...packageName.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
}
