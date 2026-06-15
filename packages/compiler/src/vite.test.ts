import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diagnosticDefinitions } from '@jiso/core';
import { describe, expect, it, vi } from 'vitest';

import { jisoVitePlugin, type JisoViteMiddleware } from './index.js';
import { createJisoVitePlugin } from './vite.js';

const cartBadgeSource = `
import { component } from '@jiso/core';
import { removeItem } from './cart-actions';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: {} },
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`;

const fw201 = diagnosticDefinitions.FW201;
const fw210 = diagnosticDefinitions.FW210;

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

describe('jisoVitePlugin', () => {
  it('exposes a Vite transform hook for component modules', () => {
    const plugin = jisoVitePlugin();

    expect(plugin.name).toBe('jiso');
    expect(plugin.transform?.(cartBadgeSource, 'cart-badge.tsx')).toMatchObject({
      code: expect.stringContaining('export function renderSource()'),
      map: null,
    });
  });

  it('throws registry-error diagnostics from the Vite transform with teaching text', () => {
    const onModuleDiagnostics = vi.fn();
    const plugin = createJisoVitePlugin(
      () => ({
        diagnostics: [
          {
            code: 'FW201',
            fileName: 'src/bad.tsx',
            help: [
              'Would lower to: on:click="/c/src/bad.client.js#Bad$button_click"',
              'Fixes: move the value into component/query state via ctx.',
            ].join('\n'),
            message: fw201.message,
            severity: 'lint',
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
        'Jiso Vite transform failed with 1 error diagnostic.',
        [
          'FW201 src/bad.tsx:3:12 Closure captures unserializable value.',
          '  help: Would lower to: on:click="/c/src/bad.client.js#Bad$button_click"',
          '  help: Fixes: move the value into component/query state via ctx.',
        ].join('\n'),
      ].join('\n\n'),
    );
    expect(onModuleDiagnostics).toHaveBeenCalledWith({
      diagnostics: [
        expect.objectContaining({
          code: 'FW201',
          fileName: 'src/bad.tsx',
          message: fw201.message,
        }),
      ],
      fileName: 'src/bad.tsx',
      source: 'component(',
    });
  });

  it('reports warn, lint, and notice diagnostics without blocking the Vite transform', () => {
    const onDiagnostic = vi.fn();
    const plugin = createJisoVitePlugin(
      () => ({
        diagnostics: [
          {
            code: 'FW311',
            fileName: 'src/diagnostics.tsx',
            message: 'Query/state-dependent DOM position has no update status.',
            severity: 'error',
            start: { line: 4, column: 9 },
          },
          {
            code: 'FW210',
            fileName: 'src/diagnostics.tsx',
            message: fw210.message,
            severity: 'error',
            start: { line: 5, column: 11 },
          },
          {
            code: 'FW409',
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
      'FW311',
      'FW210',
      'FW409',
    ]);
  });

  it('serves emitted client modules from Vite dev middleware', () => {
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
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
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
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
    const root = mkdtempSync(join(tmpdir(), 'jiso-vite-prefix-'));

    try {
      writePackageManifest(root, '@acme/primitives', {
        jiso: { prefix: 'dupe-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/widgets', {
        jiso: { prefix: 'dupe-' },
        name: '@other/widgets',
      });

      const plugin = jisoVitePlugin();
      plugin.configureServer?.({
        config: { root },
        middlewares: {
          use() {},
        },
      });

      expect(() =>
        plugin.transform?.(
          `
import { component } from '@jiso/core';
import '@acme/primitives';
import '@other/widgets/menu';

export const Shell = component('shell', {
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
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
    const source = (handler: string) => `
import { component } from '@jiso/core';
import { ${handler} } from './cart-actions';

export const CartBadge = component('cart-badge', {
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
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
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
