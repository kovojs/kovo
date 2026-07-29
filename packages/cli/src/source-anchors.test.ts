import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  snapshotBuildAppContractSourceAnchorsForTests,
  snapshotBuildCompilerDiagnosticAnchorsForTests,
  snapshotBuildCompilerSourceAnchorsForTests,
} from './commands/build-export.js';

describe('build graph compiler source anchors', () => {
  it('retains exact query, mutation, endpoint, component, and route declaration ranges', () => {
    const source = `
import { component } from '@kovojs/core';
import { domain, endpoint, mutation, query, route } from '@kovojs/server';
import { webhook } from '@kovojs/server/webhooks';

export const cartQuery = query('cart', {
  load: () => ({ count: 0 }),
  reads: [],
});

export const cartDomain = domain('cart');

export const addToCart = mutation('cart/add', {
  handler() {
    return null;
  },
});

export const health = endpoint('/health', {
  handler() {
    return null;
  },
});

export const inbound = webhook('/inbound', {
  handler() {
    return null;
  },
});

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <strong>{cart.count}</strong>,
});

export const home = route('/', {
  page: () => <CartBadge />,
});
`;
    const snapshot = snapshotBuildCompilerSourceAnchorsForTests(
      [{ fileName: 'app.tsx', source }],
      [
        { kind: 'query', name: 'cart' },
        { kind: 'domain', name: 'cart' },
        { kind: 'mutation', name: 'cart/add' },
        { kind: 'endpoint', name: '/health' },
        { kind: 'webhook', name: '/inbound' },
        { kind: 'page', name: '/' },
      ],
    );

    expect(
      snapshot.declarations.map((anchor) =>
        anchor === undefined ? undefined : source.slice(anchor.start, anchor.end),
      ),
    ).toEqual([
      expect.stringContaining("query('cart'"),
      expect.stringContaining("domain('cart'"),
      expect.stringContaining("mutation('cart/add'"),
      expect.stringContaining("endpoint('/health'"),
      expect.stringContaining("webhook('/inbound'"),
      expect.stringContaining("route('/'"),
    ]);
    expect(snapshot.components).toHaveLength(1);
    expect(snapshot.components[0]?.source?.file).toBe('app.tsx');
    expect(
      source.slice(snapshot.components[0]?.source?.start, snapshot.components[0]?.source?.end),
    ).toContain('CartBadge = component(');
    expect(snapshot.routes).toHaveLength(1);
    expect(snapshot.routes[0]?.source).toEqual(snapshot.declarations[5]);
  });

  it('retains exact compiler diagnostic ranges in the build graph projection', () => {
    const source = `
import { component } from '@kovojs/core';

export const UnsafeTrigger = component({
  render: () => <video-player onMedia={() => {}} />,
});
`;
    const diagnostics = snapshotBuildCompilerDiagnosticAnchorsForTests([
      { fileName: 'src/app.tsx', source },
    ]);
    const diagnostic = diagnostics.find((entry) => entry.code === 'KV212');

    expect(diagnostic?.source).toMatchObject({ file: 'src/app.tsx' });
    expect(source.slice(diagnostic?.source?.start, diagnostic?.source?.end)).toContain('onMedia');
  });

  it('associates imported shared declarations with their defining source files', () => {
    const shared = `
import { domain, mutation, query } from '@kovojs/server';

export const inventory = domain('inventory');
export const inventoryQuery = query('inventory/list', {
  load: () => [],
  reads: [],
});
export const reserveInventory = mutation('inventory/reserve', {
  handler() {
    return null;
  },
});
`;
    const entry = `
import { inventory, inventoryQuery, reserveInventory } from './shared.js';
void inventory;
void inventoryQuery;
void reserveInventory;
`;
    const snapshot = snapshotBuildCompilerSourceAnchorsForTests(
      [
        { fileName: 'src/app.ts', source: entry },
        { fileName: 'src/shared.ts', source: shared },
      ],
      [
        { kind: 'domain', name: 'inventory' },
        { kind: 'query', name: 'inventory/list' },
        { kind: 'mutation', name: 'inventory/reserve' },
      ],
    );

    expect(snapshot.declarations).toEqual([
      expect.objectContaining({ file: 'src/shared.ts' }),
      expect.objectContaining({ file: 'src/shared.ts' }),
      expect.objectContaining({ file: 'src/shared.ts' }),
    ]);
    expect(snapshot.declarations.map((anchor) => shared.slice(anchor?.start, anchor?.end))).toEqual(
      [
        expect.stringContaining("domain('inventory'"),
        expect.stringContaining("query('inventory/list'"),
        expect.stringContaining("mutation('inventory/reserve'"),
      ],
    );
  });

  it('associates integrated adapter mutation keys with their exact authored calls', () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-adapter-source-anchor-'));
    try {
      const serverRoot = join(root, 'node_modules/@kovojs/server');
      mkdirSync(serverRoot, { recursive: true });
      writeFileSync(
        join(serverRoot, 'package.json'),
        JSON.stringify({
          exports: { '.': './index.d.ts' },
          name: '@kovojs/server',
          type: 'module',
          version: '0.0.0-test',
        }),
      );
      writeFileSync(
        join(serverRoot, 'index.d.ts'),
        [
          'export declare function endpoint(path: string, definition: unknown): unknown;',
          'export declare function integrateMutation<const Mutation>(definition: Mutation): Mutation;',
          'export declare function layout(definition: unknown): unknown;',
          'export declare function mutation(definition: unknown): unknown;',
          'export declare function query(definition: { load(): unknown }): unknown;',
          'export declare function route(path: string, definition: unknown): unknown;',
          'export declare function task(definition: unknown): unknown;',
          'export declare function publicAccess(reason: string): unknown;',
          'export declare function defineKovo<const AppId extends string>(options: {',
          '  readonly appId: AppId;',
          '  readonly db?: unknown;',
          '  readonly provider?: unknown;',
          '  readonly providerKey?: string;',
          '}): {',
          '  readonly endpoint: typeof endpoint;',
          '  readonly integrateMutation: typeof integrateMutation;',
          '  readonly layout: typeof layout;',
          '  readonly mutation: typeof mutation;',
          '  readonly query: typeof query;',
          '  readonly route: typeof route;',
          '  readonly task: typeof task;',
          '  readonly assemble: (options: unknown) => unknown;',
          '};',
          '',
        ].join('\n'),
      );
      const sourceRoot = join(root, 'src');
      mkdirSync(sourceRoot, { recursive: true });
      const contractPath = join(sourceRoot, 'kovo.ts');
      const integrationPath = join(sourceRoot, 'auth-integration.ts');
      const contractSource = [
        "import { defineKovo } from '@kovojs/server';",
        'export const app = defineKovo({',
        "  appId: '00000000-0000-4000-8000-000000000002',",
        '});',
        '',
      ].join('\n');
      const integrationSource = [
        "import { app } from './kovo.js';",
        'interface GeneratedMutation<Key extends string> { readonly key: Key }',
        "declare const signIn: GeneratedMutation<'auth/sign-in'>;",
        "declare const signOut: GeneratedMutation<'auth/sign-out'>;",
        'export const integratedSignOut = app.integrateMutation(signOut);',
        'export const integratedSignIn = app.integrateMutation(signIn);',
        '',
      ].join('\n');
      writeFileSync(contractPath, contractSource);
      writeFileSync(integrationPath, integrationSource);
      const files = [
        {
          fileName: relative(process.cwd(), contractPath),
          source: contractSource,
        },
        {
          fileName: relative(process.cwd(), integrationPath),
          source: integrationSource,
        },
      ];

      const [signIn, signOut] = snapshotBuildAppContractSourceAnchorsForTests(files, [
        { kind: 'mutation', name: 'auth/sign-in' },
        { kind: 'mutation', name: 'auth/sign-out' },
      ]);

      expect(signIn?.file).toBe(relative(process.cwd(), integrationPath));
      expect(integrationSource.slice(signIn?.start, signIn?.end)).toBe(
        'app.integrateMutation(signIn)',
      );
      expect(signOut?.file).toBe(relative(process.cwd(), integrationPath));
      expect(integrationSource.slice(signOut?.start, signOut?.end)).toBe(
        'app.integrateMutation(signOut)',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed when a runtime declaration cannot be associated uniquely', () => {
    const first = `
import { query } from '@kovojs/server';
export const first = query('duplicate', { load: () => null, reads: [] });
`;
    const second = `
import { query } from '@kovojs/server';
export const second = query('duplicate', { load: () => null, reads: [] });
`;

    expect(() =>
      snapshotBuildCompilerSourceAnchorsForTests(
        [
          { fileName: 'src/first.ts', source: first },
          { fileName: 'src/second.ts', source: second },
        ],
        [{ kind: 'query', name: 'duplicate' }],
      ),
    ).toThrow(/source provenance refused ambiguous query declaration duplicate/u);

    expect(() =>
      snapshotBuildCompilerSourceAnchorsForTests(
        [{ fileName: 'src/first.ts', source: first }],
        [{ kind: 'query', name: 'missing' }],
      ),
    ).toThrow(/could not associate runtime query declaration missing/u);

    expect(() =>
      snapshotBuildCompilerSourceAnchorsForTests(
        [
          {
            fileName: 'src/ingress.ts',
            source: `
import { endpoint } from '@kovojs/server';
import { webhook } from '@kovojs/server/webhooks';
export const api = endpoint('/collision', { handler: () => new Response('ok') });
export const hook = webhook('/collision', { handler: () => new Response('ok') });
`,
          },
        ],
        [{ kind: 'endpoint', name: '/collision' }],
      ),
    ).toThrow(/refused endpoint\/webhook declaration collision/u);
  });
});
