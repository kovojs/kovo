import { describe, expect, it } from 'vitest';

import { cssSourceDirectives, projectSourceSiteFact } from './source-fixtures.js';

describe('@jiso/test source fixture seam', () => {
  it('extracts Tailwind source directives without keeping a local fw-check parser', () => {
    expect(
      cssSourceDirectives(
        [
          '@import "tailwindcss";',
          '  @source "../index.html";',
          '@source inline("bg-emerald-50 text-emerald-700");',
        ].join('\n'),
      ),
    ).toEqual(['"../index.html"', 'inline("bg-emerald-50 text-emerald-700")']);
  });

  it('turns generated graph source sites into path and line facts', () => {
    expect(projectSourceSiteFact('examples/commerce/src/app.ts:42')).toEqual({
      line: 42,
      path: 'examples/commerce/src/app.ts',
    });
    expect(() => projectSourceSiteFact('examples/commerce/src/app.ts')).toThrow(
      'Project source site includes a line number: examples/commerce/src/app.ts',
    );
    expect(() => projectSourceSiteFact('examples/commerce/src/app.ts:0')).toThrow(
      'Project source site line is positive: examples/commerce/src/app.ts:0',
    );
  });
});
