import { describe, expect, it } from 'vitest';

import { compileRouteModule } from './scan/route-pages.js';

describe('compileRouteModule', () => {
  it('extracts component calls from JSX-authored route pages', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';
import { QuestionListRegion } from './components/question-list.js';

export const home = route('/', {
  page: () => <QuestionListRegion />,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.routePageFacts).toEqual([
      {
        components: [
          {
            localName: 'QuestionListRegion',
            props: [],
            propsExpression: '{}',
            serializedPropsExpression: 'JSON.stringify({})',
          },
        ],
        css: {
          sourceFileNames: ['src/components/question-list.css'],
        },
        fileName: 'src/routes.tsx',
        navigationSegments: [
          {
            components: ['QuestionListRegion'],
            id: 'page:/',
            kind: 'page',
            localName: 'page',
          },
        ],
        route: '/',
      },
    ]);
    expect(result.files[0]).toMatchObject({
      fileName: 'src/routes.kovo-route.tsx',
      kind: 'route',
    });
    expect(result.files[0]?.source).toContain(
      "import { defineCompiledRoutePage as __kovoDefineCompiledRoutePage } from '@kovojs/server/internal/route';",
    );
    expect(result.files[0]?.source).toContain(
      `page: __kovoDefineCompiledRoutePage({"css":{"sourceFileNames":["src/components/question-list.css"]},"components":[{"localName":"QuestionListRegion","props":[],"propsExpression":"{}","serializedPropsExpression":"JSON.stringify({})"}],"fileName":"src/routes.tsx","navigationSegments":[{"components":["QuestionListRegion"],"id":"page:/","kind":"page","localName":"page"}],"route":"/"}, () => <QuestionListRegion />)`,
    );
  });

  it('extracts page segments from JSX-authored route pages without component calls', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const home = route('/', {
  page: () => <main>Home</main>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.routePageFacts).toEqual([
      {
        components: [],
        fileName: 'src/routes.tsx',
        navigationSegments: [
          {
            components: [],
            id: 'page:/',
            kind: 'page',
            localName: 'page',
          },
        ],
        route: '/',
      },
    ]);
    expect(result.files[0]?.source).toContain(
      `page: __kovoDefineCompiledRoutePage({"components":[],"fileName":"src/routes.tsx","navigationSegments":[{"components":[],"id":"page:/","kind":"page","localName":"page"}],"route":"/"}, () => <main>Home</main>)`,
    );
  });

  it('records compiler-derived layout chains for JSX-authored route pages', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { layout, route } from '@kovojs/server';
import { QuestionListRegion } from './components/question-list.js';

const AppLayout = layout({
  queries: { viewer: viewerQuery, cart: cartQuery },
  render: (_queries, _state, { children }) => <main>{children}</main>,
});

const AdminLayout = layout({
  parent: AppLayout,
  queries: { permissions: permissionQuery },
  render: (_queries, _state, { children }) => <section>{children}</section>,
});

export const home = route('/', {
  layout: AdminLayout,
  page: () => <QuestionListRegion />,
});
`,
    });

    expect(result.routePageFacts).toEqual([
      expect.objectContaining({
        layouts: [
          { localName: 'AppLayout', queries: ['viewer', 'cart'] },
          { localName: 'AdminLayout', queries: ['permissions'] },
        ],
        navigationSegments: [
          {
            id: 'layout:AppLayout',
            kind: 'layout',
            localName: 'AppLayout',
            queries: ['viewer', 'cart'],
          },
          {
            id: 'layout:AdminLayout',
            kind: 'layout',
            localName: 'AdminLayout',
            queries: ['permissions'],
          },
          {
            components: ['QuestionListRegion'],
            id: 'page:/',
            kind: 'page',
            localName: 'page',
          },
        ],
        route: '/',
      }),
    ]);
    expect(result.files[0]?.source).toContain(
      `"layouts":[{"localName":"AppLayout","queries":["viewer","cart"]},{"localName":"AdminLayout","queries":["permissions"]}]`,
    );
  });

  it('threads route and layout access posture through JSX-authored route page facts', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { guards, layout, publicAccess, route, verifiedAccess } from '@kovojs/server';

const authed = guards.authed();
const AdminLayout = layout({
  access: { guards: [{ name: 'admin' }], kind: 'guard-chain' },
  guard: authed,
  render: (_queries, _state, { children }) => <main>{children}</main>,
});

export const docs = route('/docs', {
  access: publicAccess('public docs'),
  page: () => <DocsPage />,
});

export const admin = route('/admin', {
  layout: AdminLayout,
  page: () => <AdminPage />,
});

export const signed = route('/signed', {
  access: verifiedAccess,
  page: () => <SignedPage />,
});

export const missing = route('/missing', {
  page: () => <MissingPage />,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(
      result.routePageFacts.map((fact) => ({
        access: fact.access,
        guards: fact.guards,
        route: fact.route,
      })),
    ).toEqual([
      { access: { kind: 'public', reason: 'public docs' }, guards: undefined, route: '/docs' },
      {
        access: { guards: [{ name: 'admin' }], kind: 'guard-chain' },
        guards: ['authed'],
        route: '/admin',
      },
      { access: { kind: 'verified-machine-auth' }, guards: undefined, route: '/signed' },
      { access: undefined, guards: undefined, route: '/missing' },
    ]);
    expect(result.files[0]?.source).toContain('"access":{"kind":"public","reason":"public docs"}');
    expect(result.files[0]?.source).toContain('"guards":["authed"]');
  });

  it('lowers route-level parallel regions to compiler-owned navigation segment metadata', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { layout, route } from '@kovojs/server';
import { DocsPage } from './components/docs-page.js';
import { DocsSidebar } from './components/docs-sidebar.js';

const DocsLayout = layout({
  render: (_queries, _state, { regions }) => (
    <main>
      {regions.page}
      {regions.sidebar}
    </main>
  ),
});

export const guide = route('/guides/:slug', {
  layout: DocsLayout,
  regions: {
    page: ({ params }) => <DocsPage slug={params.slug} />,
    sidebar: ({ params }) => <DocsSidebar activePath={params.slug} />,
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.routePageFacts).toEqual([
      expect.objectContaining({
        components: [
          expect.objectContaining({ localName: 'DocsPage' }),
          expect.objectContaining({ localName: 'DocsSidebar' }),
        ],
        layouts: [{ localName: 'DocsLayout', queries: [] }],
        navigationSegments: [
          {
            id: 'layout:DocsLayout',
            kind: 'layout',
            localName: 'DocsLayout',
            queries: [],
          },
          {
            components: ['DocsPage'],
            id: 'page:/guides/:slug',
            kind: 'page',
            localName: 'page',
          },
          {
            components: ['DocsSidebar'],
            id: 'region:sidebar',
            kind: 'region',
            localName: 'sidebar',
          },
        ],
        regions: [
          {
            components: [expect.objectContaining({ localName: 'DocsPage' })],
            name: 'page',
          },
          {
            components: [expect.objectContaining({ localName: 'DocsSidebar' })],
            name: 'sidebar',
          },
        ],
        route: '/guides/:slug',
      }),
    ]);
    expect(result.files[0]?.source).toContain(
      '"navigationSegments":[{"id":"layout:DocsLayout","kind":"layout","localName":"DocsLayout","queries":[]},{"components":["DocsPage"],"id":"page:/guides/:slug","kind":"page","localName":"page"},{"components":["DocsSidebar"],"id":"region:sidebar","kind":"region","localName":"sidebar"}]',
    );
    expect(result.files[0]?.source).toContain('page: __kovoDefineCompiledRoutePage(');
  });

  it('reports KV303 when a route layout cannot resolve to a local layout declaration', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';
import { QuestionListRegion } from './components/question-list.js';

export const home = route('/', {
  layout: MissingLayout,
  page: () => <QuestionListRegion />,
});
`,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV303',
        message: expect.stringContaining(
          "Route layout 'MissingLayout' does not resolve to a local layout() declaration.",
        ),
      }),
    ]);
    expect(result.routePageFacts[0]?.layouts).toBeUndefined();
  });

  it('reports KV303 when local layout parent chains are cyclic', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { layout, route } from '@kovojs/server';
import { QuestionListRegion } from './components/question-list.js';

const AppLayout = layout({
  parent: AdminLayout,
  render: (_queries, _state, { children }) => <main>{children}</main>,
});

const AdminLayout = layout({
  parent: AppLayout,
  render: (_queries, _state, { children }) => <section>{children}</section>,
});

export const home = route('/', {
  layout: AdminLayout,
  page: () => <QuestionListRegion />,
});
`,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV303',
        message: expect.stringContaining("Cyclic layout parent chain at 'AdminLayout'."),
      }),
    ]);
    expect(result.routePageFacts[0]?.layouts).toBeUndefined();
  });

  it('emits executable route IR after jsx import-source pragmas', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { route } from '@kovojs/server';

export const detail = route('/questions/:id', {
  page: ({ params }) => <QuestionDetail key={params.id} questionId={params.id} />,
});
`,
    });

    expect(result.files).toEqual([
      {
        fileName: 'src/routes.kovo-route.tsx',
        kind: 'route',
        source: `// @kovojs-ir - lowered route module generated by @kovojs/compiler (SPEC.md section 4.5). Do not edit.
/** @jsxImportSource @kovojs/server */
import { defineCompiledRoutePage as __kovoDefineCompiledRoutePage } from '@kovojs/server/internal/route';
import { route } from '@kovojs/server';

export const detail = route('/questions/:id', {
  page: __kovoDefineCompiledRoutePage({"components":[{"keyExpression":"params.id","localName":"QuestionDetail","props":[{"expression":"params.id","name":"questionId","propertyAccesses":["params.id"]}],"propsExpression":"{ questionId: params.id }","serializedPropsExpression":"JSON.stringify({ questionId: params.id })"}],"fileName":"src/routes.tsx","navigationSegments":[{"components":["QuestionDetail"],"id":"page:/questions/:id","kind":"page","localName":"page"}],"route":"/questions/:id"}, ({ params }) => <QuestionDetail key={params.id} questionId={params.id} />),
});
`,
      },
    ]);
  });

  it('rebases relative imports when emitting route IR into generated artifacts', () => {
    const result = compileRouteModule({
      artifactFileName: 'examples/app/src/generated/routes.kovo-route.tsx',
      componentImportRewrites: [
        { localName: 'QuestionListRegion', specifier: './question-list.js' },
      ],
      fileName: 'examples/app/src/routes.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { route } from '@kovojs/server';
import { Shell } from './components/shell.js';
import { QuestionListRegion } from './components/question-list.js';
export { shared } from './shared.js';

export const home = route('/', {
  page: () => <Shell><QuestionListRegion /></Shell>,
});
`,
    });

    expect(result.files[0]?.fileName).toBe('examples/app/src/generated/routes.kovo-route.tsx');
    expect(result.files[0]?.source).toContain('import { Shell } from "../components/shell.js";');
    expect(result.files[0]?.source).toContain(
      'import { QuestionListRegion } from "./question-list.js";',
    );
    expect(result.files[0]?.source).toContain('export { shared } from "../shared.js";');
  });

  it('reports KV235 for app-local generated imports in route source', () => {
    const result = compileRouteModule({
      fileName: 'examples/app/src/routes.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { route } from '@kovojs/server';
import { QuestionListRegion } from './generated/question-list.js';

export const home = route('/', {
  page: () => <QuestionListRegion />,
});
`,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV235',
        message:
          "App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. app-local generated component import './generated/question-list.js' in route/layout source.",
        help: expect.stringContaining('Route/layout source should import the authored component'),
      }),
    ]);
  });

  it('reports KV235 for hand-authored navigation segment stamps in route JSX', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { route } from '@kovojs/server';

export const home = route('/', {
  page: () => (
    <main
      kovo-nav-components="HomePage"
      kovo-nav-kind="page"
      kovo-nav-name="page"
      kovo-nav-queries="viewer"
      kovo-nav-segment="page:/"
    >
      Home
    </main>
  ),
});
`,
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. hand-authored navigation segment stamp kovo-nav-components.',
      'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. hand-authored navigation segment stamp kovo-nav-kind.',
      'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. hand-authored navigation segment stamp kovo-nav-name.',
      'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. hand-authored navigation segment stamp kovo-nav-queries.',
      'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. hand-authored navigation segment stamp kovo-nav-segment.',
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV235',
          help: expect.stringContaining('route({ regions })'),
        }),
      ]),
    );
  });

  it('reports KV244 for defer() used directly as a route JSX child', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `/** @jsxImportSource @kovojs/server */
import { Defer, defer, route } from '@kovojs/server';

export const home = route('/', {
  page: () => (
    <main>
      {defer({ target: 'panel', priority: 'after-paint', render: () => '<section>Ready</section>' })}
      <Defer target="safe" render={() => <section>Ready</section>} />
    </main>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV244')).toMatchObject([
      {
        code: 'KV244',
        message: 'defer() used as a JSX child; use <Defer> instead.',
        severity: 'lint',
      },
    ]);
  });

  it('reports KV303 for spread props in route component calls', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const detail = route('/questions/:id', {
  page: ({ params }) => <QuestionDetail {...params} />,
});
`,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV303',
        help: expect.stringContaining('Route component props must be statically reconstructible'),
        message: expect.stringContaining(
          "Route component 'QuestionDetail' uses spread props that cannot be represented in generated route metadata.",
        ),
      }),
    ]);
    expect(result.routePageFacts[0]?.components).toEqual([
      {
        localName: 'QuestionDetail',
        props: [],
        propsExpression: '{}',
        serializedPropsExpression: 'JSON.stringify({})',
      },
    ]);
  });

  it('records route param props passed to parameterized component pages', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const detail = route('/questions/:id', {
  page: ({ params }) => <QuestionDetail key={params.id} questionId={params.id} featured={true} pageSize={20} />,
});
`,
    });

    expect(result.routePageFacts).toEqual([
      {
        components: [
          {
            keyExpression: 'params.id',
            localName: 'QuestionDetail',
            props: [
              {
                expression: 'params.id',
                name: 'questionId',
                propertyAccesses: ['params.id'],
              },
              { expression: 'true', name: 'featured', staticValue: true },
              { expression: '20', name: 'pageSize', staticValue: 20 },
            ],
            propsExpression: '{ questionId: params.id, featured: true, pageSize: 20 }',
            serializedPropsExpression:
              'JSON.stringify({ questionId: params.id, featured: true, pageSize: 20 })',
          },
        ],
        fileName: 'src/routes.tsx',
        navigationSegments: [
          {
            components: ['QuestionDetail'],
            id: 'page:/questions/:id',
            kind: 'page',
            localName: 'page',
          },
        ],
        route: '/questions/:id',
      },
    ]);
  });

  it('records keyed repeated component route facts', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const products = route('/products', {
  page: ({ loaderData }) => (
    <ProductShell>
      {loaderData.products.map((product) => (
        <ProductCard key={product.id} productId={product.id} featured={product.featured} />
      ))}
    </ProductShell>
  ),
});
`,
    });

    expect(result.routePageFacts).toEqual([
      {
        components: [
          {
            localName: 'ProductShell',
            props: [],
            propsExpression: '{}',
            serializedPropsExpression: 'JSON.stringify({})',
          },
          {
            keyExpression: 'product.id',
            localName: 'ProductCard',
            props: [
              {
                expression: 'product.id',
                name: 'productId',
                propertyAccesses: ['product.id'],
              },
              {
                expression: 'product.featured',
                name: 'featured',
                propertyAccesses: ['product.featured'],
              },
            ],
            propsExpression: '{ productId: product.id, featured: product.featured }',
            serializedPropsExpression:
              'JSON.stringify({ productId: product.id, featured: product.featured })',
          },
        ],
        fileName: 'src/routes.tsx',
        navigationSegments: [
          {
            components: ['ProductShell', 'ProductCard'],
            id: 'page:/products',
            kind: 'page',
            localName: 'page',
          },
        ],
        route: '/products',
      },
    ]);
  });

  it('extracts nested layout and region component composition', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const home = route('/', {
  page: () => (
    <SoShell section="questions">
      <QuestionListRegion />
    </SoShell>
  ),
});
`,
    });

    expect(result.routePageFacts).toEqual([
      {
        components: [
          {
            localName: 'SoShell',
            props: [{ expression: '"questions"', name: 'section', staticValue: 'questions' }],
            propsExpression: '{ section: "questions" }',
            serializedPropsExpression: 'JSON.stringify({ section: "questions" })',
          },
          {
            localName: 'QuestionListRegion',
            props: [],
            propsExpression: '{}',
            serializedPropsExpression: 'JSON.stringify({})',
          },
        ],
        fileName: 'src/routes.tsx',
        navigationSegments: [
          {
            components: ['SoShell', 'QuestionListRegion'],
            id: 'page:/',
            kind: 'page',
            localName: 'page',
          },
        ],
        route: '/',
      },
    ]);
  });

  it('extracts component composition passed through shell helper calls', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const home = route('/', {
  page: () => renderShell(<QuestionListRegion />),
});
`,
    });

    expect(result.routePageFacts).toEqual([
      {
        components: [
          {
            localName: 'QuestionListRegion',
            props: [],
            propsExpression: '{}',
            serializedPropsExpression: 'JSON.stringify({})',
          },
        ],
        fileName: 'src/routes.tsx',
        navigationSegments: [
          {
            components: ['QuestionListRegion'],
            id: 'page:/',
            kind: 'page',
            localName: 'page',
          },
        ],
        route: '/',
      },
    ]);
    expect(result.files[0]?.source).toContain(
      'page: __kovoDefineCompiledRoutePage({"components":[{"localName":"QuestionListRegion","props":[],"propsExpression":"{}","serializedPropsExpression":"JSON.stringify({})"}],"fileName":"src/routes.tsx","navigationSegments":[{"components":["QuestionListRegion"],"id":"page:/","kind":"page","localName":"page"}],"route":"/"}, () => renderShell(<QuestionListRegion />))',
    );
  });

  it('lowers method-shorthand page handlers into compiled page properties', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.tsx',
      source: `
import { route } from '@kovojs/server';

export const detail = route('/questions/:id', {
  page({ params }: { params: { id: string } }) {
    return renderShell(<QuestionDetail questionId={params.id} />);
  },
});
`,
    });

    expect(result.routePageFacts[0]?.components).toEqual([
      {
        localName: 'QuestionDetail',
        props: [
          {
            expression: 'params.id',
            name: 'questionId',
            propertyAccesses: ['params.id'],
          },
        ],
        propsExpression: '{ questionId: params.id }',
        serializedPropsExpression: 'JSON.stringify({ questionId: params.id })',
      },
    ]);
    expect(result.files[0]?.source).toContain(
      'page: __kovoDefineCompiledRoutePage({"components":[{"localName":"QuestionDetail","props":[{"expression":"params.id","name":"questionId","propertyAccesses":["params.id"]}],"propsExpression":"{ questionId: params.id }","serializedPropsExpression":"JSON.stringify({ questionId: params.id })"}],"fileName":"src/routes.tsx","navigationSegments":[{"components":["QuestionDetail"],"id":"page:/questions/:id","kind":"page","localName":"page"}],"route":"/questions/:id"}, function page({ params }: { params: { id: string } }) {',
    );
  });

  it('ignores routes whose pages return non-JSX strings', () => {
    const result = compileRouteModule({
      fileName: 'src/routes.ts',
      source: `
import { route } from '@kovojs/server';

export const legacy = route('/legacy', {
  page: () => '<main>Legacy</main>',
});
`,
    });

    expect(result.routePageFacts).toEqual([]);
    expect(result.files).toEqual([]);
  });
});
