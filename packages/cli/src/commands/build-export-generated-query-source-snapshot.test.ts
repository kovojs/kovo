import { describe, expect, it } from 'vitest';

import { snapshotBuildPreEvaluationTrustForTests } from './build-export.js';

describe('generated performance-corpus query source snapshot', () => {
  it('retains the exact app.query root through the prepared build compiler project', async () => {
    const result = await snapshotBuildPreEvaluationTrustForTests('src/app.tsx', [
      {
        fileName: 'src/kovo.ts',
        source: `
          import { defineKovo, s } from '@kovojs/server';

          export const app = defineKovo({
            appId: '03a0649a-09f2-4f3a-881b-000000000024',
            document: { lang: 'en-US' },
            renderRoute(value) { return typeof value === 'string' ? value : String(value ?? ''); },
          });

          export const benchmarkRefreshQuery = app.query({
            access: app.publicAccess('generated equal-shape refresh-surface query'),
            load: () => ({ label: 'ready' }),
            output: s.object({ label: s.string() }),
          });
        `,
      },
      {
        fileName: 'src/app.tsx',
        source: `
          /** @jsxImportSource @kovojs/server */
          import { app, benchmarkRefreshQuery } from './kovo.js';

          export default app.assemble({
            queries: [benchmarkRefreshQuery],
            routes: [],
          });
        `,
      },
    ]);

    expect(result.files).toEqual(['src/app.tsx', 'src/kovo.ts']);
    expect(result.unregisteredSinks).toEqual([]);
  });
});
