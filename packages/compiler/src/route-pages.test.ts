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
        components: [{ localName: 'QuestionListRegion', props: [] }],
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
  page: ({ params }) => <QuestionDetail questionId={params.id} featured={true} pageSize={20} />,
});
`,
    });

    expect(result.routePageFacts).toEqual([
      {
        components: [
          {
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
          },
        ],
        fileName: 'src/routes.tsx',
        route: '/questions/:id',
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
          },
          { localName: 'QuestionListRegion', props: [] },
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
