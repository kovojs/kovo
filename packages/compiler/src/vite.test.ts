import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { lowerStandaloneSourceDerivedRegistryDeclarations } from './source-derived-lowering.js';
import { createKovoVitePlugin, viteFrameworkIdentityFiles } from './vite.js';
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
const kv435 = diagnosticDefinitions.KV435;
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

  it('registers local source files for framework identity during real Vite compilation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-identity-'));
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, 'browser-root.ts'),
      "export { trustedHtml as th } from '@kovojs/browser';\n",
    );
    writeFileSync(join(src, 'browser-barrel.ts'), "export * from './browser-root';\n");
    const appSource = `
import { th } from './browser-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`;

    const plugin = kovoVitePlugin({ include: ['src'] });
    plugin.configResolved?.({ root });

    try {
      await expect(plugin.transform(appSource, join(src, 'probe.tsx'))).rejects.toThrow(
        /KV426 src\/probe\.tsx:/,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not read framework identity sources through symlinks outside the Vite root', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-identity-boundary-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-vite-identity-outside-'));
    const src = join(root, 'src');
    try {
      mkdirSync(src, { recursive: true });
      const outsideSource = join(outside, 'browser-root.ts');
      writeFileSync(outsideSource, "export { trustedHtml as th } from '@kovojs/browser';\n");
      symlinkSync(outsideSource, join(src, 'browser-root.ts'));

      expect(
        viteFrameworkIdentityFiles(
          root,
          join(src, 'probe.tsx'),
          "import { th } from './browser-root.js';\nexport const C = component({});\n",
        ),
      ).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('does not omit framework identity files through late Array iterator replacement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-identity-iterator-'));
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, 'browser-root.ts'),
      "export { trustedHtml as th } from '@kovojs/browser';\n",
    );
    writeFileSync(join(src, 'browser-barrel.ts'), "export * from './browser-root';\n");
    const plugin = kovoVitePlugin({ include: ['src'] });
    plugin.configResolved?.({ root });
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeApply = Reflect.apply;
    const empty: unknown[] = [];

    try {
      Array.prototype[Symbol.iterator] = function poisonedModuleSpecifierIterator<
        T,
      >(): ArrayIterator<T> {
        if (typeof (this[0] as { specifier?: unknown } | undefined)?.specifier === 'string') {
          return nativeApply(nativeIterator, empty, []);
        }
        return nativeApply(nativeIterator, this, []);
      };
      expect(() =>
        plugin.transform(
          `
import { th } from './browser-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
          join(src, 'probe.tsx'),
        ),
      ).rejects.toThrow(/KV426 src\/probe\.tsx:/);
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('observes registered identity-file changes on the next Vite transform', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-identity-fresh-'));
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'browser-root.ts'), 'export const th = (value: string) => value;\n');
    writeFileSync(join(src, 'browser-barrel.ts'), "export * from './browser-root';\n");
    const appSource = `
import { th } from './browser-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`;

    const plugin = kovoVitePlugin({ include: ['src'] });
    plugin.configResolved?.({ root });

    try {
      await expect(plugin.transform(appSource, join(src, 'probe.tsx'))).resolves.toMatchObject({
        map: null,
      });

      writeFileSync(
        join(src, 'browser-root.ts'),
        "export { trustedHtml as th } from '@kovojs/browser';\n",
      );

      await expect(plugin.transform(appSource, join(src, 'probe.tsx'))).rejects.toThrow(
        /KV426 src\/probe\.tsx:/,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
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

  it('lowers standalone source-derived registry declarations without component compilation', async () => {
    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      include: ['src'],
    });
    const transformed = await plugin.transform(
      `
import { domain, mutation, query, task, webhook } from '@kovojs/server';

export const contact = domain();
export const addToCart = mutation({ handler() {}, input: {} });
export const cartQuery = query({ load: () => ({ count: 1 }), reads: [] });
export const auditQuery = query({ load: () => ({ ok: true }), reads: [] });
export const sendReceipt = task({ input: {}, run() {} });
export const orderPaid = webhook('/webhooks/order-paid', {
  handler() {},
  input: {},
  verify: 'none',
  verifyJustification: 'fixture',
});
`,
      'src/app-shell.ts',
    );

    expect(compileComponentModule).not.toHaveBeenCalled();
    expect(transformed).toMatchObject({ map: null });
    expect(transformed?.code).toContain(
      "import { assignDerivedDomainKey as __kovoAssignDerivedDomainKey, assignDerivedMutationKey as __kovoAssignDerivedMutationKey, assignDerivedQueryKey as __kovoAssignDerivedQueryKey, assignDerivedTaskKey as __kovoAssignDerivedTaskKey, assignDerivedWebhookName as __kovoAssignDerivedWebhookName } from '@kovojs/server/internal/wire';",
    );
    expect(transformed?.code).toContain(
      'export const contact = __kovoAssignDerivedDomainKey(domain(), "app-shell/contact")',
    );
    expect(transformed?.code).toContain(
      'export const addToCart = __kovoAssignDerivedMutationKey(mutation({ handler() {}, input: {} }), "app-shell/add-to-cart")',
    );
    expect(transformed?.code).toContain(
      'export const cartQuery = __kovoAssignDerivedQueryKey(query({ load: () => ({ count: 1 }), reads: [] }), "app-shell/cart-query")',
    );
    expect(transformed?.code).toContain(
      'export const auditQuery = __kovoAssignDerivedQueryKey(query({ load: () => ({ ok: true }), reads: [] }), "app-shell/audit-query")',
    );
    expect(transformed?.code).toContain(
      'export const sendReceipt = __kovoAssignDerivedTaskKey(task({ input: {}, run() {} }), "app-shell/send-receipt")',
    );
    expect(transformed?.code).toContain(
      'export const orderPaid = __kovoAssignDerivedWebhookName(webhook',
    );
    expect(transformed?.code).toContain('"app-shell/order-paid"');
  });

  it('blocks non-public Kovo subpath imports in non-component authored modules', async () => {
    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      include: ['src'],
    });

    expect(() =>
      plugin.transform(
        `
import { renderedHtml } from '@kovojs/server/internal/html';

export const rawUnescaped = (markup: string) => renderedHtml(markup);
`,
        'src/raw-helper.ts',
      ),
    ).toThrow(
      [
        'Kovo Vite transform failed with 1 error diagnostic.',
        [
          'KV235 src/raw-helper.ts:2:30 App source imports a non-public Kovo subpath; use a documented public entrypoint.',
          '  help: Blocked reason: app source imports non-public Kovo subpath `@kovojs/server/internal/html`.',
          '  help: Fixes: import Kovo packages through documented public entrypoints; generated ABI subpaths are reserved for compiler-emitted modules.',
          '  help: SPEC.md §5.2: app-authored source may import Kovo packages only through documented public entrypoints.',
        ].join('\n'),
      ].join('\n\n'),
    );
    expect(compileComponentModule).not.toHaveBeenCalled();
  });

  it('blocks authored live-target registration helpers instead of mistaking their names for emitted provenance', () => {
    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      include: ['src'],
    });

    expect(() =>
      plugin.transform(
        `
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';

const renderer = componentLiveTargetRenderer({});
registerGeneratedLiveTargetRenderer(renderer);
`,
        'src/forged-live-target.ts',
      ),
    ).toThrow(
      [
        'Kovo Vite transform failed with 1 error diagnostic.',
        [
          'KV235 src/forged-live-target.ts:2:82 App source imports a non-public Kovo subpath; use a documented public entrypoint.',
          '  help: Blocked reason: app source imports non-public Kovo subpath `@kovojs/server/internal/wire`.',
          '  help: Fixes: import Kovo packages through documented public entrypoints; generated ABI subpaths are reserved for compiler-emitted modules.',
          '  help: SPEC.md §5.2: app-authored source may import Kovo packages only through documented public entrypoints.',
        ].join('\n'),
      ].join('\n\n'),
    );
    expect(compileComponentModule).not.toHaveBeenCalled();
  });

  it('does not let an authored package name exempt source from the app security boundary', async () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'kovo-self-named-package-'));
    const packageRoot = join(appRoot, 'packages/server');
    const authoredModule = join(packageRoot, 'src/raw-helper.ts');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@kovojs/server', type: 'module' }),
    );

    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule);

    try {
      expect(() =>
        plugin.transform(
          `
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';

export const token = kovoTrustedHtmlContent;
`,
          authoredModule,
        ),
      ).toThrow('KV235');
      expect(compileComponentModule).not.toHaveBeenCalled();
    } finally {
      rmSync(appRoot, { force: true, recursive: true });
    }
  });

  it('compiles component source even when its authored package claims a Kovo package name', async () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'kovo-self-named-component-'));
    const packageRoot = join(appRoot, 'packages/core');
    const authoredModule = join(packageRoot, 'src/forged.tsx');
    mkdirSync(join(packageRoot, 'src'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@kovojs/core', type: 'module' }),
    );

    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule);

    try {
      await plugin.transform(
        `
import { component } from '@kovojs/core';

export const Forged = component(() => <div>authored</div>);
`,
        authoredModule,
      );
      expect(compileComponentModule).toHaveBeenCalledOnce();
    } finally {
      rmSync(appRoot, { force: true, recursive: true });
    }
  });

  it('lowers standalone source-derived aliased public query imports', async () => {
    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      include: ['src'],
    });
    const transformed = await plugin.transform(
      `
import { query as defineQuery } from '@kovojs/server';

export const cartQuery = defineQuery({ load: () => ({ count: 1 }), output: {}, reads: [] });
export const auditQuery = defineQuery({ load: () => ({ ok: true }), output: {}, reads: [] });
`,
      'src/app-shell.ts',
    );

    expect(compileComponentModule).not.toHaveBeenCalled();
    expect(transformed).toMatchObject({ map: null });
    expect(transformed?.code).toContain(
      "import { assignDerivedQueryKey as __kovoAssignDerivedQueryKey } from '@kovojs/server/internal/wire';",
    );
    expect(transformed?.code).toContain(
      'export const cartQuery = __kovoAssignDerivedQueryKey(defineQuery({ load: () => ({ count: 1 }), output: {}, reads: [] }), "app-shell/cart-query")',
    );
    expect(transformed?.code).toContain(
      'export const auditQuery = __kovoAssignDerivedQueryKey(defineQuery({ load: () => ({ ok: true }), output: {}, reads: [] }), "app-shell/audit-query")',
    );
  });

  it('lowers standalone source-derived component declarations before runtime rendering', () => {
    const transformed = lowerStandaloneSourceDerivedRegistryDeclarations({
      fileName: 'src/app-shell.tsx',
      source: `
import { component } from '@kovojs/core';

const LocalRegion = component({ queries: { cart: cartQuery }, render() { return '<section />'; } });
export const ExportedRegion = component({ queries: { cart: cartQuery }, render() { return '<article />'; } });
`,
    });

    expect(transformed).toContain(
      "import { assignDerivedComponentName as __kovoAssignDerivedComponentName } from '@kovojs/server/internal/wire';",
    );
    expect(transformed).toContain(
      `const LocalRegion = __kovoAssignDerivedComponentName(component({ queries: { cart: cartQuery }, render() { return '<section />'; } }), "app-shell/local-region")`,
    );
    expect(transformed).toContain(
      `export const ExportedRegion = __kovoAssignDerivedComponentName(component({ queries: { cart: cartQuery }, render() { return '<article />'; } }), "app-shell/exported-region")`,
    );
  });

  it('lowers standalone source-derived declarations through aliases and API subpaths', () => {
    const transformed = lowerStandaloneSourceDerivedRegistryDeclarations({
      fileName: 'src/app-shell.tsx',
      source: `
import { component as defineComponent } from '@kovojs/core';
import { domain as defineDomain, mutation as defineMutation, task as defineTask } from '@kovojs/server/api/data';
import * as data from '@kovojs/server/api/data';
import * as routing from '@kovojs/server/api/routing';

const ComponentAlias = defineComponent;
const DataQuery = data.query;

const LocalRegion = ComponentAlias({ render() { return '<section />'; } });
export const contact = defineDomain();
export const contactTag = data.tag();
export const addToCart = defineMutation({ handler() {}, input: {} });
export const cartQuery = DataQuery({ load: () => ({ count: 1 }), reads: [] });
export const auditQuery = DataQuery({ load: () => ({ ok: true }), reads: [] });
export const sendReceipt = defineTask({ input: {}, run() {} });
export const orderPaid = routing.webhook('/webhooks/order-paid', {
  handler() {},
  input: {},
  verify: 'none',
  verifyJustification: 'fixture',
});
`,
    });

    expect(transformed).toContain(
      'const LocalRegion = __kovoAssignDerivedComponentName(ComponentAlias({ render() { return \'<section />\'; } }), "app-shell/local-region")',
    );
    expect(transformed).toContain(
      'export const contact = __kovoAssignDerivedDomainKey(defineDomain(), "app-shell/contact")',
    );
    expect(transformed).toContain(
      'export const contactTag = __kovoAssignDerivedDomainKey(data.tag(), "app-shell/contact-tag")',
    );
    expect(transformed).toContain(
      'export const addToCart = __kovoAssignDerivedMutationKey(defineMutation({ handler() {}, input: {} }), "app-shell/add-to-cart")',
    );
    expect(transformed).toContain(
      'export const cartQuery = __kovoAssignDerivedQueryKey(DataQuery({ load: () => ({ count: 1 }), reads: [] }), "app-shell/cart-query")',
    );
    expect(transformed).toContain(
      'export const auditQuery = __kovoAssignDerivedQueryKey(DataQuery({ load: () => ({ ok: true }), reads: [] }), "app-shell/audit-query")',
    );
    expect(transformed).toContain(
      'export const sendReceipt = __kovoAssignDerivedTaskKey(defineTask({ input: {}, run() {} }), "app-shell/send-receipt")',
    );
    expect(transformed).toContain(
      `export const orderPaid = __kovoAssignDerivedWebhookName(routing.webhook('/webhooks/order-paid', {
  handler() {},
  input: {},
  verify: 'none',
  verifyJustification: 'fixture',
}), "app-shell/order-paid")`,
    );
  });

  it('does not lower local source-derived lookalikes', () => {
    const transformed = lowerStandaloneSourceDerivedRegistryDeclarations({
      fileName: 'src/app-shell.tsx',
      source: `
function component(value) { return value; }
function domain() { return {}; }
function mutation(value) { return value; }
function query(value) { return value; }
function task(value) { return value; }
const routing = { webhook(_path, value) { return value; } };

const LocalRegion = component({ render() { return '<section />'; } });
export const contact = domain();
export const addToCart = mutation({ handler() {}, input: {} });
export const cartQuery = query({ load: () => ({ count: 1 }), reads: [] });
export const sendReceipt = task({ input: {}, run() {} });
export const orderPaid = routing.webhook('/webhooks/order-paid', { handler() {} });
`,
    });

    expect(transformed).toBeNull();
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
        help: Would lower to: a client handler module whose captured imports and same-file module constants are explicitly proven client-safe before emission.
        help: Blocked reason: a client handler closure that captures a server-only binding (a secret/process.env-derived value, any cross-module import not provably client-safe, or a same-file literal not explicitly public) re-emits it verbatim into the client bundle, leaking confidential server state to the browser.
        help: Fixes: do not capture the server value in client code; pass a server-computed safe value as a prop, or use publishToClient(value, { reason }) as the audited escape, surfaced in kovo explain --capabilities.
        help: SPEC §6.6/§6.2 and secure-framework Phase 4/Tier 0: the emit filter is fail-closed whole-channel (a narrow process.env/brand-only gate is unsound — call-wrapped secrets escape).",
      ]
    `);
  });

  it('fails closed when app code selectively replaces the KV435 diagnostic filter', async () => {
    // SPEC §2/§5.2: compiler error diagnostics are build authority. An evaluated app shares
    // this realm and previously could make reportViteDiagnostics() drop this exact array through a
    // selective late Array.prototype.filter replacement, returning deployable server code.
    const diagnostics = [
      {
        code: 'KV435' as const,
        fileName: 'src/account.tsx',
        message: kv435.message,
        severity: 'error' as const,
      },
    ];
    const plugin = createKovoVitePlugin(() => ({
      diagnostics,
      files: [{ kind: 'server', source: 'export const leaked = account.adminToken;' }],
    }));
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    Array.prototype.filter = function poisonedDiagnosticFilter(
      callback: (value: unknown, index: number, array: unknown[]) => unknown,
      thisArg?: unknown,
    ): unknown[] {
      if (this === diagnostics) return [];
      return nativeApply(nativeFilter, this, [callback, thisArg]);
    };

    try {
      await expect(plugin.transform('component(', 'src/account.tsx')).rejects.toThrow(
        /KV435[\s\S]*Secret query value reaches the client wire/u,
      );
    } finally {
      Array.prototype.filter = nativeFilter;
    }
  });

  it('classifies KV435 before diagnostic observers can mutate compiler output', async () => {
    const diagnostics = [
      {
        code: 'KV311' as const,
        fileName: 'src/account.tsx',
        message: 'non-blocking diagnostic before the error',
        severity: 'warn' as const,
      },
      {
        code: 'KV435' as const,
        fileName: 'src/account.tsx',
        message: kv435.message,
        severity: 'error' as const,
      },
    ];
    const plugin = createKovoVitePlugin(
      () => ({
        diagnostics,
        files: [{ kind: 'server', source: 'export const leaked = account.adminToken;' }],
      }),
      {
        onDiagnostic() {
          diagnostics[1]!.severity = 'warn';
        },
        onModuleDiagnostics(event) {
          diagnostics[1]!.severity = 'warn';
          event.diagnostics[1]!.severity = 'warn';
        },
      },
    );

    await expect(plugin.transform('component(', 'src/account.tsx')).rejects.toThrow(
      /KV435[\s\S]*Secret query value reaches the client wire/u,
    );
  });

  it('selects emitted server bytes from the dense compile snapshot, not mutable Array controls', async () => {
    const files = [{ kind: 'server', source: 'export const reviewedServer = true;' }];
    const attackerFile = { kind: 'server', source: 'export const attackerServer = true;' };
    const plugin = createKovoVitePlugin(() => ({ diagnostics: [], files }));
    const nativeFind = Array.prototype.find;
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeApply = Reflect.apply;
    Array.prototype.find = function poisonedEmittedFileFind(
      callback: (value: unknown, index: number, array: unknown[]) => unknown,
      thisArg?: unknown,
    ): unknown {
      if (this === files) return attackerFile;
      return nativeApply(nativeFind, this, [callback, thisArg]);
    };
    Array.prototype[Symbol.iterator] =
      function poisonedEmittedFileIterator(): ArrayIterator<unknown> {
        if (this === files) return nativeApply(nativeIterator, [attackerFile], []);
        return nativeApply(nativeIterator, this, []);
      };

    try {
      await expect(plugin.transform('component(', 'src/reviewed.tsx')).resolves.toEqual({
        code: 'export const reviewedServer = true;',
        map: null,
      });
    } finally {
      Array.prototype.find = nativeFind;
      Array.prototype[Symbol.iterator] = nativeIterator;
    }
  });

  it('settles asynchronous compile diagnostics through the boot-captured Promise control', async () => {
    const real = {
      diagnostics: [
        {
          code: 'KV236' as const,
          fileName: 'src/unsafe-link.tsx',
          message: kv236.message,
          severity: 'error' as const,
        },
      ],
      files: [{ kind: 'server', source: 'export const unsafe = true;' }],
    };
    const forged = {
      diagnostics: [],
      files: [{ kind: 'server', source: 'export const forgedSafe = true;' }],
    };
    const plugin = createKovoVitePlugin(async () => real);
    const nativeThen = Promise.prototype.then;
    let pending: ReturnType<typeof plugin.transform>;
    try {
      Promise.prototype.then = function poisonedCompileSettlement() {
        return Promise.resolve(forged);
      } as typeof Promise.prototype.then;
      pending = plugin.transform('component(', 'src/unsafe-link.tsx');
    } finally {
      Promise.prototype.then = nativeThen;
    }

    await expect(pending!).rejects.toThrow(/KV236/u);
  });

  it('does not execute a compile-result then accessor while classifying asynchronous work', async () => {
    let thenGetterHits = 0;
    const compileResult = {
      diagnostics: [],
      files: [{ kind: 'server', source: 'export const reviewedServer = true;' }],
      get then(): never {
        thenGetterHits += 1;
        throw new Error('attacker-controlled then getter executed');
      },
    };
    const plugin = createKovoVitePlugin(() => compileResult);

    await expect(plugin.transform('component(', 'src/reviewed.tsx')).resolves.toEqual({
      code: 'export const reviewedServer = true;',
      map: null,
    });
    expect(thenGetterHits).toBe(0);
  });

  it('does not rewrite validated server render output through late String.replace', async () => {
    const serverSource =
      'export function renderSource() { return "export const reviewedServer = true;"; }';
    const plugin = createKovoVitePlugin(() => ({
      diagnostics: [],
      files: [{ kind: 'server', source: serverSource }],
    }));
    const nativeReplace = String.prototype.replace;
    const nativeToString = String.prototype.toString;
    try {
      String.prototype.replace = function poisonedValidatedServerReplace(
        this: string,
        searchValue: string | RegExp,
        replaceValue: string | ((substring: string, ...args: unknown[]) => string),
      ): string {
        const value = Reflect.apply(nativeToString, this, []);
        if (value === serverSource) {
          return 'function renderSource() { return "export const attackerServer = true;"; }';
        }
        return Reflect.apply(nativeReplace, this, [searchValue, replaceValue]);
      } as typeof String.prototype.replace;
      await expect(plugin.transform('component(', 'src/reviewed.tsx')).resolves.toEqual({
        code: 'export const reviewedServer = true;',
        map: null,
      });
    } finally {
      String.prototype.replace = nativeReplace;
    }
  });

  it('binds production client registration to the reviewed generated-runtime rewrite', async () => {
    const clientSource =
      "import { runQueryUpdatePlan } from '@kovojs/browser/generated';\nexport const reviewedClient = runQueryUpdatePlan;";
    const clientHref = clientModuleHrefForSourceFile(
      'src/reviewed.tsx',
      clientModuleContentVersion(clientSource),
    );
    const plugin = createKovoVitePlugin(() => ({
      clientExports: ['reviewedClient'],
      diagnostics: [],
      files: [
        { kind: 'server', source: 'export const reviewedServer = true;' },
        { kind: 'client', source: clientSource },
      ],
      hmrImpact: hmrMetadata({ clientHref }),
    }));
    const nativeReplace = String.prototype.replace;
    const nativeToString = String.prototype.toString;
    const nativeExec = RegExp.prototype.exec;
    try {
      String.prototype.replace = function poisonedProductionClientReplace(
        this: string,
        searchValue: string | RegExp,
        replaceValue: string | ((substring: string, ...args: unknown[]) => string),
      ): string {
        const value = Reflect.apply(nativeToString, this, []);
        if (value === clientSource) return 'export const attackerClient = globalThis.secret;';
        return Reflect.apply(nativeReplace, this, [searchValue, replaceValue]);
      } as typeof String.prototype.replace;
      RegExp.prototype.exec = function poisonedProductionClientExec(value: string) {
        if (value === clientSource) return null;
        return Reflect.apply(nativeExec, this, [value]);
      };
      await plugin.transform('component(', 'src/reviewed.tsx');
    } finally {
      String.prototype.replace = nativeReplace;
      RegExp.prototype.exec = nativeExec;
    }

    const [compiled] = plugin.getClientModules?.() ?? [];
    expect(compiled?.source).toContain('const runQueryUpdatePlan');
    expect(compiled?.source).toContain('export const reviewedClient = runQueryUpdatePlan;');
    expect(compiled?.source).not.toContain('attackerClient');
    expect(compiled?.version).toBe(clientModuleContentVersion(clientSource));
    expect(Reflect.set(compiled!, 'source', 'globalThis.pwned = true;')).toBe(false);
    expect(Reflect.set(compiled!, 'path', '/pwned.js')).toBe(false);
    const [reread] = plugin.getClientModules?.() ?? [];
    expect(reread?.source).toContain('export const reviewedClient = runQueryUpdatePlan;');
    expect(reread?.path).not.toBe('/pwned.js');
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
    expect(res.body).toContain("from '/@id/@kovojs/browser/generated'");
    expect(res.body).not.toContain("from '@kovojs/browser/generated'");
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

  it('rejects client-module resolution and loading outside Vite server.fs.allow roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-client-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-vite-client-outside-'));
    const sourceFile = join(outside, 'probe.tsx');
    const clientFile = join(outside, 'probe.client.js');
    const plugin = createKovoVitePlugin(() => ({
      files: [{ kind: 'client', source: 'export const leaked = true;' }],
    }));

    try {
      writeFileSync(sourceFile, 'component(');
      plugin.configResolved?.({ root, server: { fs: { allow: [root] } } });

      expect(await plugin.resolveId?.(clientFile)).toBeNull();
      expect(await plugin.load?.(clientFile)).toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('allows client modules from an explicit Vite server.fs.allow workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-client-root-'));
    const workspace = mkdtempSync(join(tmpdir(), 'kovo-vite-client-workspace-'));
    const sourceFile = join(workspace, 'probe.tsx');
    const clientFile = join(workspace, 'probe.client.js');
    const plugin = createKovoVitePlugin(() => ({
      files: [{ kind: 'client', source: 'export const workspaceModule = true;' }],
    }));

    try {
      writeFileSync(sourceFile, 'component(');
      plugin.configResolved?.({ root, server: { fs: { allow: [root, workspace] } } });

      expect(await plugin.resolveId?.(clientFile)).toBe(clientFile);
      expect(await plugin.load?.(clientFile)).toContain('workspaceModule');
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  it('rejects a client-module source symlink that escapes an allowed root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-client-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-vite-client-outside-'));
    const outsideSource = join(outside, 'probe.tsx');
    const clientFile = join(root, 'probe.client.js');
    const plugin = createKovoVitePlugin(() => ({
      files: [{ kind: 'client', source: 'export const leaked = true;' }],
    }));

    try {
      writeFileSync(outsideSource, 'component(');
      symlinkSync(outsideSource, join(root, 'probe.tsx'));
      plugin.configResolved?.({ root, server: { fs: { allow: [root] } } });

      expect(await plugin.resolveId?.(clientFile)).toBeNull();
      expect(await plugin.load?.(clientFile)).toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
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

  it('recompiles when an imported package manifest changes prefix in the same plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-prefix-change-'));
    const source = `
import { component } from '@kovojs/core';
import '@acme/primitives';
import '@other/widgets/menu';

export const Shell = component({
  render: () => <section></section>,
});
`;

    try {
      writePackageManifest(root, '@acme/primitives', {
        kovo: { prefix: 'acme-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/widgets', {
        kovo: { prefix: 'other-' },
        name: '@other/widgets',
      });

      const plugin = kovoVitePlugin();
      plugin.configResolved?.({ root });
      await expect(plugin.transform(source, join(root, 'src/shell.tsx'))).resolves.toMatchObject({
        map: null,
      });

      writePackageManifest(root, '@other/widgets', {
        kovo: { prefix: 'acme-' },
        name: '@other/widgets',
      });
      await expect(plugin.transform(source, join(root, 'src/shell.tsx'))).rejects.toThrow(
        'Effective package prefix "acme-" is claimed by @acme/primitives and @other/widgets.',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('retains only the current and previous versioned client modules after newer transforms', async () => {
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
    const previousClientRef = findVersionedClientRef(
      second?.code,
      'components/cart/cart-badge.client.js',
    );
    const third = await plugin.transform?.(source('addItem'), 'components/cart/cart-badge.tsx');
    const currentClientRef = findVersionedClientRef(
      third?.code,
      'components/cart/cart-badge.client.js',
    );
    const oldResponse = createMiddlewareResponse();
    const previousResponse = createMiddlewareResponse();
    const currentResponse = createMiddlewareResponse();
    const oldNext = vi.fn();

    expect(oldClientRef).toBeDefined();
    expect(previousClientRef).toBeDefined();
    expect(currentClientRef).toBeDefined();
    expect(previousClientRef).not.toBe(oldClientRef);
    expect(currentClientRef).not.toBe(previousClientRef);

    middlewares[0]?.({ url: oldClientRef ?? '' }, oldResponse, oldNext);
    middlewares[0]?.({ url: previousClientRef ?? '' }, previousResponse, vi.fn());
    middlewares[0]?.({ url: currentClientRef ?? '' }, currentResponse, vi.fn());

    expect(oldNext).toHaveBeenCalledTimes(1);
    expect(oldResponse.body).toBe('');
    expect(previousResponse.body).toContain('return clearCart(event, ctx);');
    expect(currentResponse.body).toContain('return addItem(event, ctx);');
  });

  it('evicts the least-recently compiled file when the dev client-module file bound is reached', async () => {
    const compileComponentModule = vi.fn(({ fileName }: { fileName: string }) => {
      const identifier = fileName.match(/bounded-(\d+)/)?.[1] ?? 'unknown';
      const clientSource = `export const bounded${identifier} = true;`;
      return {
        files: [
          { kind: 'server', source: `export const server${identifier} = true;` },
          { kind: 'client', source: clientSource },
        ],
      };
    });
    const plugin = createKovoVitePlugin(compileComponentModule);
    const middlewares: KovoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const firstFile = 'src/bounded-0.tsx';
    const lastFile = 'src/bounded-1024.tsx';
    for (let index = 0; index <= 1024; index += 1) {
      await plugin.transform('component(', `src/bounded-${index}.tsx`);
    }
    const firstHref = clientModuleHrefForSourceFile(
      firstFile,
      clientModuleContentVersion('export const bounded0 = true;'),
    );
    const lastHref = clientModuleHrefForSourceFile(
      lastFile,
      clientModuleContentVersion('export const bounded1024 = true;'),
    );
    const firstResponse = createMiddlewareResponse();
    const lastResponse = createMiddlewareResponse();
    const firstNext = vi.fn();
    const lastNext = vi.fn();

    middlewares[0]?.({ url: firstHref }, firstResponse, firstNext);
    middlewares[0]?.({ url: lastHref }, lastResponse, lastNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(firstResponse.body).toBe('');
    expect(lastNext).not.toHaveBeenCalled();
    expect(lastResponse.body).toBe('export const bounded1024 = true;');
  });

  it('charges retained source-file identifiers to the Vite state budget', async () => {
    const plugin = createKovoVitePlugin(() => ({
      cssAssets: [
        {
          componentName: 'bounded-id',
          criticalCss: '.bounded-id{display:block}',
          fragmentTargets: [],
          href: '/assets/bounded-id.css',
          sourceFileName: 'src/bounded-id.css',
        },
      ],
      files: [{ kind: 'server', source: 'export const boundedId = true;' }],
    }));
    plugin.configResolved?.({ command: 'build', root: process.cwd() });
    const oversizedFileName = `src/${'x'.repeat(16 * 1024 * 1024)}.tsx`;

    await expect(
      Promise.resolve(plugin.transform('component(', oversizedFileName)),
    ).rejects.toThrow(/one source file exceeds the bounded source limit/u);
    expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([]);
  });

  it('removes stale client and CSS build outputs when a file no longer emits them', async () => {
    const clientSource = 'export const staleClient = true;';
    const clientHref = clientModuleHrefForSourceFile(
      'src/stale.tsx',
      clientModuleContentVersion(clientSource),
    );
    let compileCount = 0;
    const plugin = createKovoVitePlugin(() => {
      compileCount += 1;
      if (compileCount > 1) {
        return { files: [{ kind: 'server', source: 'export const currentServer = true;' }] };
      }
      return {
        clientExports: ['staleClient'],
        cssAssets: [
          {
            componentName: 'stale',
            criticalCss: '.stale{color:red}',
            fragmentTargets: ['stale'],
            href: '/assets/stale.css',
            sourceFileName: 'src/stale.css',
          },
        ],
        files: [
          { kind: 'server', source: 'export const staleServer = true;' },
          { kind: 'client', source: clientSource },
        ],
        hmrImpact: hmrMetadata({ clientHref }),
      };
    });
    plugin.configResolved?.({ command: 'build', root: process.cwd() });

    await plugin.transform('component(', 'src/stale.tsx');
    expect(plugin.getClientModules?.()).toHaveLength(1);
    expect(plugin.getCssAssetManifest?.().stylesheets).toHaveLength(1);

    await plugin.transform('component(', 'src/stale.tsx');
    expect(plugin.getClientModules?.()).toEqual([]);
    expect(plugin.getCssAssetManifest?.().stylesheets).toEqual([]);
  });

  it('bounds CSS-only dev churn and fails loudly rather than truncating build output', async () => {
    const compileCss = ({ fileName }: { fileName: string }) => {
      const identifier = fileName.match(/css-only-(\d+)/)?.[1] ?? 'unknown';
      return {
        cssAssets: [
          {
            componentName: `css-only-${identifier}`,
            criticalCss: `.css-only-${identifier}{display:block}`,
            fragmentTargets: [],
            href: `/assets/css-only-${identifier}.css`,
            sourceFileName: `src/css-only-${identifier}.css`,
          },
        ],
        files: [{ kind: 'server', source: `export const cssOnly${identifier} = true;` }],
      };
    };
    const devPlugin = createKovoVitePlugin(compileCss);
    devPlugin.configureServer?.({ middlewares: { use() {} } });
    for (let index = 0; index <= 1024; index += 1) {
      await devPlugin.transform('component(', `src/css-only-${index}.tsx`);
    }
    const devStyles = devPlugin.getCssAssetManifest?.().stylesheets ?? [];
    expect(devStyles).toHaveLength(1024);
    expect(devStyles.some((asset) => asset.sourceFileName === 'src/css-only-0.css')).toBe(false);
    expect(devStyles.some((asset) => asset.sourceFileName === 'src/css-only-1024.css')).toBe(true);

    const buildPlugin = createKovoVitePlugin(compileCss);
    buildPlugin.configResolved?.({ command: 'build', root: process.cwd() });
    for (let index = 0; index < 1024; index += 1) {
      await buildPlugin.transform('component(', `src/css-only-${index}.tsx`);
    }
    await expect(
      Promise.resolve(buildPlugin.transform('component(', 'src/css-only-1024.tsx')),
    ).rejects.toThrow(/refusing incomplete output/u);
    expect(buildPlugin.getCssAssetManifest?.().stylesheets).toHaveLength(1024);
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
    const compileComponentModule = vi.fn(
      (_: Parameters<Parameters<typeof createKovoVitePlugin>[0]>[0]) => ({
        files: [{ kind: 'server', source: 'export function renderSource() {}' }],
      }),
    );
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

  it('does not let late Array.some replacement skip an included authored component', async () => {
    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      include: ['src/components'],
    });
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    try {
      Array.prototype.some = function poisonedViteFilterSome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        if (this[0] === 'src/components') return false;
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      await plugin.transform('component(', 'src/components/account.tsx');
    } finally {
      Array.prototype.some = nativeSome;
    }

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

  it('passes query-shape facts to the compile step', async () => {
    const compileComponentModule = vi.fn(() => ({
      files: [{ kind: 'server', source: 'export function renderSource() {}' }],
    }));
    const queryShapeFacts = [
      {
        query: 'cart',
        shape: { count: 'number' as const },
        source: 'src/cart.queries.ts:1',
      },
    ];
    const plugin = createKovoVitePlugin(compileComponentModule, { queryShapeFacts });

    await plugin.transform('component(', 'src/cart-badge.tsx');

    expect(compileComponentModule).toHaveBeenCalledWith(
      expect.objectContaining({ queryShapeFacts }),
    );
  });

  it('passes external query-shape facts through component-local aliases', async () => {
    const compileComponentModule = vi.fn(() => ({
      files: [{ kind: 'server', source: 'export function renderSource() {}' }],
    }));
    const queryShapeFacts = [
      {
        query: 'queries/products/products-query',
        shape: { name: 'string' as const },
        source: 'src/queries/products.ts:3',
      },
    ];
    const plugin = createKovoVitePlugin(compileComponentModule, { queryShapeFacts });

    await plugin.transform(
      `
import { component } from '@kovojs/core';
import { productsQuery as externalProducts } from '../queries/products';

export const ProductList = component({
  queries: { products: externalProducts },
  render: () => <span data-bind="products.name">Coffee</span>,
});
`,
      'src/components/product-list.tsx',
    );

    expect(compileComponentModule).toHaveBeenCalledWith(
      expect.objectContaining({
        queryShapeFacts: expect.arrayContaining([
          queryShapeFacts[0],
          {
            query: 'products',
            shape: { name: 'string' },
            source: 'src/queries/products.ts:3',
          },
        ]),
      }),
    );
  });

  it('does not suppress component-local query aliases through late Array.map replacement', async () => {
    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const queryShapeFacts = [
      {
        query: 'queries/products/products-query',
        shape: { token: { kind: 'secret' as const, shape: 'string' as const } },
        source: 'src/queries/products.ts:3',
      },
    ];
    const plugin = createKovoVitePlugin(compileComponentModule, { queryShapeFacts });
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    try {
      Array.prototype.map = function poisonedViteQueryAliasMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if ((this[0] as { key?: unknown } | undefined)?.key === 'products') return [];
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      await plugin.transform(
        `
import { component } from '@kovojs/core';
import { productsQuery as externalProducts } from '../queries/products';
export const ProductList = component({
  queries: { products: externalProducts },
  render: () => <span data-bind="products.token">x</span>,
});
`,
        'src/components/product-list.tsx',
      );
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(compileComponentModule).toHaveBeenCalledWith(
      expect.objectContaining({
        queryShapeFacts: expect.arrayContaining([
          expect.objectContaining({ query: 'products', source: 'src/queries/products.ts:3' }),
        ]),
      }),
    );
  });

  it('does not suppress imported query identity through late Array.find replacement', async () => {
    const compileComponentModule = vi.fn(() => ({ files: [] }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      queryShapeFacts: [
        {
          query: 'queries/products/products-query',
          shape: { name: 'string' },
          source: 'src/queries/products.ts:3',
        },
      ],
    });
    const nativeFind = Array.prototype.find;
    const nativeApply = Reflect.apply;
    try {
      Array.prototype.find = function poisonedViteNamedImportFind<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T | undefined {
        if ((this[0] as { localName?: unknown } | undefined)?.localName === 'externalProducts') {
          return undefined;
        }
        return nativeApply(nativeFind, this, [callback, thisArg]);
      };
      await plugin.transform(
        `
import { component } from '@kovojs/core';
import { productsQuery as externalProducts } from '../queries/products';
export const ProductList = component({
  queries: { products: externalProducts },
  render: () => <span data-bind="products.name">x</span>,
});
`,
        'src/components/product-list.tsx',
      );
    } finally {
      Array.prototype.find = nativeFind;
    }

    expect(compileComponentModule).toHaveBeenCalledWith(
      expect.objectContaining({
        queryShapeFacts: expect.arrayContaining([
          expect.objectContaining({ query: 'products', source: 'src/queries/products.ts:3' }),
        ]),
      }),
    );
  });

  it('deduplicates component-local query-shape aliases repeated across components', async () => {
    const compileComponentModule = vi.fn(
      (_: Parameters<Parameters<typeof createKovoVitePlugin>[0]>[0]) => ({
        files: [{ kind: 'server', source: 'export function renderSource() {}' }],
      }),
    );
    const queryShapeFacts = [
      {
        query: 'queries/product-grid-query',
        shape: { name: 'string' as const },
        source: 'src/queries.ts:63',
      },
    ];
    const plugin = createKovoVitePlugin(compileComponentModule, { queryShapeFacts });

    await plugin.transform(
      `
import { component } from '@kovojs/core';
import { productGridQuery } from '../queries';

export const ProductGrid = component({
  queries: { productGrid: productGridQuery },
  render: () => <span data-bind="productGrid.name">Coffee</span>,
});

export const FeaturedProductGrid = component({
  queries: { productGrid: productGridQuery },
  render: () => <strong data-bind="productGrid.name">Coffee</strong>,
});
`,
      'src/components/product-grid.tsx',
    );

    const passedFacts = compileComponentModule.mock.calls[0]?.[0]?.queryShapeFacts ?? [];
    expect(compileComponentModule).toHaveBeenCalledWith(
      expect.objectContaining({
        queryShapeFacts: expect.arrayContaining([
          queryShapeFacts[0],
          {
            query: 'productGrid',
            shape: { name: 'string' },
            source: 'src/queries.ts:63',
          },
        ]),
      }),
    );
    expect(passedFacts.filter((fact) => fact.query === 'productGrid')).toHaveLength(1);
  });

  it('passes external query-shape facts through aliases in every component in a module', async () => {
    const compileComponentModule = vi.fn(() => ({
      files: [{ kind: 'server', source: 'export function renderSource() {}' }],
    }));
    const queryShapeFacts = [
      {
        query: 'queries/dashboard/cart-query',
        shape: { count: 'number' as const },
        source: 'src/queries/dashboard.ts:3',
      },
      {
        query: 'queries/dashboard/meta-query',
        shape: { title: 'string' as const },
        source: 'src/queries/dashboard.ts:4',
      },
    ];
    const plugin = createKovoVitePlugin(compileComponentModule, { queryShapeFacts });

    await plugin.transform(
      `
import { component } from '@kovojs/core';
import { cartQuery, metaQuery } from '../queries/dashboard';

export const RegionA = component({
  queries: { cart: cartQuery },
  render: () => <span data-bind="cart.count">1</span>,
});

export const RegionB = component({
  queries: { meta: metaQuery },
  render: () => <span data-bind="meta.title">Ready</span>,
});
`,
      'src/components/dashboard.tsx',
    );

    expect(compileComponentModule).toHaveBeenCalledWith(
      expect.objectContaining({
        queryShapeFacts: expect.arrayContaining([
          queryShapeFacts[0],
          queryShapeFacts[1],
          {
            query: 'cart',
            shape: { count: 'number' },
            source: 'src/queries/dashboard.ts:3',
          },
          {
            query: 'meta',
            shape: { title: 'string' },
            source: 'src/queries/dashboard.ts:4',
          },
        ]),
      }),
    );
  });

  it('compiles repeated transforms fresh without retaining injected compiler output', async () => {
    const compileComponentModule = vi.fn(({ source }: { source: string }) => ({
      dependencyFootprint: {},
      files: [{ kind: 'server', source: `export const sourceLength = ${source.length};` }],
    }));
    const plugin = createKovoVitePlugin(compileComponentModule);
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-plugin-fresh-'));
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
      expect(compileComponentModule).toHaveBeenCalledTimes(3);

      const secondCompile = vi.fn(() => ({
        dependencyFootprint: {},
        files: [{ kind: 'server', source: 'export const sourceLength = -1;' }],
      }));
      const secondPlugin = createKovoVitePlugin(secondCompile);
      secondPlugin.configResolved?.({ root } as never);
      expect((await secondPlugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        'export const sourceLength = -1;',
      );
      expect(secondCompile).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not retain injected compiler footprint outputs across plugin instances', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-plugin-footprint-fresh-'));
    const cartInput = [
      {
        coercion: 'number' as const,
        defaulted: false,
        name: 'quantity',
        optional: false,
        provenance: 'registry' as const,
        required: true,
      },
    ];
    const compileComponentModule = vi.fn(({ registryFacts }) => ({
      dependencyFootprint: {
        reads: { mutationInputKeys: ['cart/add'] },
        registryFacts: { mutationInputs: { 'cart/add': cartInput } },
      },
      files: [
        {
          kind: 'server',
          source: `export const cartInput = ${JSON.stringify(
            registryFacts?.mutationInputs?.['cart/add'],
          )};`,
        },
      ],
    }));
    const plugin = createKovoVitePlugin(compileComponentModule, {
      registryFacts: {
        mutationInputs: {
          'cart/add': cartInput,
          'product/save': [],
        },
      },
    });
    plugin.configResolved?.({ root } as never);

    try {
      expect((await plugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        `export const cartInput = ${JSON.stringify(cartInput)};`,
      );
      expect(compileComponentModule).toHaveBeenCalledTimes(1);

      const secondCompile = vi.fn(() => ({
        dependencyFootprint: {},
        files: [{ kind: 'server', source: 'export const freshResult = true;' }],
      }));
      const secondPlugin = createKovoVitePlugin(secondCompile, {
        registryFacts: {
          mutationInputs: {
            'cart/add': cartInput,
            'product/save': [
              {
                coercion: 'string' as const,
                defaulted: false,
                name: 'ignored',
                optional: false,
                provenance: 'registry' as const,
                required: true,
              },
            ],
          },
        },
      });
      secondPlugin.configResolved?.({ root } as never);

      expect((await secondPlugin.transform('component(', 'src/cart-badge.tsx'))?.code).toBe(
        'export const freshResult = true;',
      );
      expect(secondCompile).toHaveBeenCalledTimes(1);
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
