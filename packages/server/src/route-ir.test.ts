import { describe, expect, it } from 'vitest';

import { defineCompiledRoutePage } from './route-ir.js';

describe('compiled route page metadata', () => {
  it('attaches non-enumerable compiler-derived route metadata to page handlers', () => {
    const page = ({ params }: { params: { id: string } }) => `<main>${params.id}</main>`;
    const compiled = defineCompiledRoutePage(
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
            ],
            propsExpression: '{ questionId: params.id }',
            serializedPropsExpression: 'JSON.stringify({ questionId: params.id })',
          },
        ],
        fileName: 'src/routes.tsx',
        route: '/questions/:id',
      },
      page,
    );

    expect(compiled).toBe(page);
    expect(compiled.kovoRoutePage).toMatchObject({
      fileName: 'src/routes.tsx',
      route: '/questions/:id',
    });
    expect(Object.keys(compiled)).not.toContain('kovoRoutePage');
  });
});
