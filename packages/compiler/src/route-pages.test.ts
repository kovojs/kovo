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
        route: '/',
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
        route: '/',
      },
    ]);
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
  });
});
