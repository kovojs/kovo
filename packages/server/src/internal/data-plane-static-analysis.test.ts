import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type DataPlaneStaticAnalysisModule = typeof import('./data-plane-static-analysis.js');

const RELEVANT_DRIZZLE_SOURCE = {
  fileName: 'src/schema.ts',
  source: [
    'import { sql } from "@kovojs/drizzle";',
    '',
    'export async function unsafe(db: any, input: { id: string }) {',
    '  await db.execute(sql.raw(input.id));',
    '}',
  ].join('\n'),
};

describe('data-plane static analysis aggregate ABI', () => {
  afterEach(() => {
    vi.doUnmock('@kovojs/drizzle/internal/static');
    vi.resetModules();
  });

  it('fails closed instead of recomposing old analyzer entrypoints when the aggregate ABI is missing', async () => {
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      analyzeSqlSafetyFromProject: () => [
        {
          code: 'KV422',
          message: 'legacy SQL diagnostic',
          severity: 'error',
          site: 'src/schema.ts:4',
        },
      ],
      deriveMutationTouchRegistry: () => ({}),
      diagnosticsForQueryFacts: () => [],
      extractQueryFactsFromProject: () => [],
      extractToctouFromProject: () => [],
      extractTouchGraphFromProject: () => ({}),
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: false }),
    ).rejects.toThrow(
      /KV245[\s\S]*aggregate @kovojs\/drizzle analyzer ABI is required[\s\S]*src\/schema\.ts[\s\S]*extractStaticBuildAnalysisFactsFromProject/,
    );
  });

  it('fails closed with KV context when the aggregate analyzer throws during parse or ts-morph analysis', async () => {
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject: () => {
        throw new Error('ts-morph parse exploded');
      },
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: false }),
    ).rejects.toThrow(
      /KV245[\s\S]*failed closed[\s\S]*src\/schema\.ts[\s\S]*ts-morph parse exploded/,
    );
  });

  it('keeps projects with no relevant Drizzle or DB source empty and safe', async () => {
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts(
        [
          {
            fileName: 'src/status-card.tsx',
            source: [
              'import { component } from "@kovojs/core";',
              '',
              'export const StatusCard = component({',
              '  render: () => <p>ready</p>,',
              '});',
            ].join('\n'),
          },
        ],
        { cache: false },
      ),
    ).resolves.toEqual({
      massAssignmentFacts: [],
      ownerDomains: [],
      queries: [],
      queryShapeFacts: [],
      queryWriteReachability: [],
      scopeAudits: [],
      sqlSafetyDiagnostics: [],
      toctouFacts: [],
      touchGraph: {},
    });
  });

  it('runs aggregate analysis for app source even when aliases and wrappers avoid text relevance regexes', async () => {
    const extractStaticBuildAnalysisFactsFromProject = vi.fn(() => ({
      queries: [],
      sqlSafetyDiagnostics: [
        {
          code: 'KV422',
          message: 'wrapper SQL text reaches a managed sink',
          severity: 'error',
          site: 'src/search.js:5',
        },
      ],
      toctouFacts: [],
      touchGraph: {},
    }));
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject,
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    const facts = await staticDataPlaneBuildFacts(
      [
        {
          fileName: 'src/search.js',
          source: [
            'export function search(input, database) {',
            '  const runner = database;',
            '  const method = "execute";',
            '  return runner[method]("select * from products where id = " + input.id);',
            '}',
          ].join('\n'),
        },
      ],
      { cache: false },
    );

    expect(extractStaticBuildAnalysisFactsFromProject).toHaveBeenCalledWith({
      files: [
        expect.objectContaining({
          fileName: 'src/search.js',
        }),
      ],
    });
    expect(facts.sqlSafetyDiagnostics).toEqual([
      expect.objectContaining({ code: 'KV422', site: 'src/search.js:5' }),
    ]);
  });

  it('uses one app source discovery policy for JS/JSX extensions and generated/test/setup exclusions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-source-'));
    const srcDir = join(root, 'src');
    try {
      await mkdir(join(srcDir, 'generated'), { recursive: true });
      await mkdir(join(srcDir, 'components'), { recursive: true });
      await Promise.all([
        writeFile(join(srcDir, 'query.js'), 'export const querySource = true;\n', 'utf8'),
        writeFile(
          join(srcDir, 'components/card.jsx'),
          'export const Card = () => <p />;\n',
          'utf8',
        ),
        writeFile(join(srcDir, 'ignored.test.ts'), 'export const ignored = true;\n', 'utf8'),
        writeFile(join(srcDir, 'app.setup.js'), 'export const setup = true;\n', 'utf8'),
        writeFile(join(srcDir, 'generated/query.ts'), 'export const generated = true;\n', 'utf8'),
      ]);
      const { buildCheckSourceFiles, dataPlaneSourceFiles, isDataPlaneSourceFile } =
        await loadSubject();

      expect(
        dataPlaneSourceFiles(srcDir, root)
          .map((file) => file.fileName)
          .sort(),
      ).toEqual(['src/components/card.jsx', 'src/query.js']);
      expect(
        buildCheckSourceFiles(join(srcDir, 'app.tsx'))
          .map((file) => file.fileName)
          .sort(),
      ).toEqual(['components/card.jsx', 'query.js']);
      expect(isDataPlaneSourceFile(join(srcDir, 'query.js'), srcDir)).toBe(true);
      expect(isDataPlaneSourceFile(join(srcDir, 'components/card.jsx'), srcDir)).toBe(true);
      expect(isDataPlaneSourceFile(join(srcDir, 'app.setup.js'), srcDir)).toBe(false);
      expect(isDataPlaneSourceFile(join(srcDir, 'generated/query.ts'), srcDir)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('scopes build graph derivation to KovoBuildContext instead of process env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-context-'));
    const srcDir = join(root, 'src');
    const previous = process.env.KOVO_BUILD_GRAPH_DERIVATION;
    process.env.KOVO_BUILD_GRAPH_DERIVATION = '1';
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject: () => ({
        queries: [
          {
            query: 'staticContact',
            shape: 'string',
            site: 'src/schema.ts:2',
          },
        ],
        sqlSafetyDiagnostics: [],
        toctouFacts: [],
        touchGraph: {},
      }),
    }));

    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        join(srcDir, 'schema.ts'),
        'import { sql } from "@kovojs/drizzle";\nexport const marker = sql`select 1`;\n',
        'utf8',
      );
      const [{ withKovoBuildContext }, { collectCompilerQueryShapeFacts }] = await Promise.all([
        import('./build-context.js'),
        loadSubject(),
      ]);

      await expect(collectCompilerQueryShapeFacts({ appSourceDir: srcDir, root })).resolves.toEqual(
        [
          {
            query: 'staticContact',
            shape: 'string',
            source: 'src/schema.ts:2',
          },
        ],
      );
      await expect(
        withKovoBuildContext({ graphDerivation: true }, () =>
          collectCompilerQueryShapeFacts({ appSourceDir: srcDir, root }),
        ),
      ).resolves.toEqual([]);
      await expect(collectCompilerQueryShapeFacts({ appSourceDir: srcDir, root })).resolves.toEqual(
        [
          {
            query: 'staticContact',
            shape: 'string',
            source: 'src/schema.ts:2',
          },
        ],
      );
    } finally {
      if (previous === undefined) delete process.env.KOVO_BUILD_GRAPH_DERIVATION;
      else process.env.KOVO_BUILD_GRAPH_DERIVATION = previous;
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function loadSubject(): Promise<DataPlaneStaticAnalysisModule> {
  return import('./data-plane-static-analysis.js');
}
