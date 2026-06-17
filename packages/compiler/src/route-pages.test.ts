import { describe, expect, it } from 'vitest';

import { compileRouteModule } from './route-pages.js';

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
      `page: __kovoDefineCompiledRoutePage({"components":[{"localName":"QuestionListRegion","props":[],"propsExpression":"{}","serializedPropsExpression":"JSON.stringify({})"}],"fileName":"src/routes.tsx","navigationSegments":[{"components":["QuestionListRegion"],"id":"page:/","kind":"page","localName":"page"}],"route":"/"}, () => <QuestionListRegion />)`,
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
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. app-local generated component import \'./generated/question-list.js\' in route/layout source.',
        help: expect.stringContaining('Route/layout source should import the authored component'),
      }),
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
