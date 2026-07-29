import { describe, expect, it } from 'vitest';

import { extractTouchGraphFromProject } from '@kovojs/drizzle/internal/static';
import { createKovoProject } from '../../create-kovo/src/index.js';

const generatedProject = createKovoProject({
  dialect: 'sqlite',
  name: 'generated-auth-runtime-proof',
});
const generatedSources = new Map(
  generatedProject.files.map((file) => [file.path, file.source] as const),
);
const sqliteRuntimeSource = generatedSources.get('src/_kovo/app-runtime-db.ts');
if (sqliteRuntimeSource === undefined) {
  throw new Error('create-kovo omitted the generated SQLite runtime proof source');
}
const supportingSourcePaths = ['src/auth.ts', 'src/model.ts', 'src/schema.ts'] as const;

function generatedSqliteAuthGraph(runtimeSource = sqliteRuntimeSource) {
  return extractTouchGraphFromProject({
    files: [
      ...supportingSourcePaths.map((fileName) => {
        const source = generatedSources.get(fileName);
        if (source === undefined) throw new Error(`create-kovo omitted ${fileName}`);
        return { fileName, source };
      }),
      { fileName: 'src/_kovo/app-runtime-db.ts', source: runtimeSource },
    ],
  });
}

describe('generated Better Auth managed-runtime handoff', () => {
  it('accepts the exact pristine generated SQLite app-binding door', () => {
    const unresolved = Object.values(generatedSqliteAuthGraph()).flatMap(
      (entry) => entry.unresolved,
    );
    expect(unresolved).not.toContainEqual(
      expect.objectContaining({
        code: 'KV406',
        site: 'src/_kovo/app-runtime-db.ts:70',
      }),
    );
  });

  it('keeps forged and opaque binding doors visible as KV406', () => {
    const forged = sqliteRuntimeSource.replace(
      "import { createBetterAuthSqliteAppBindings } from '@kovojs/better-auth/sqlite';",
      'function createBetterAuthSqliteAppBindings(...args: unknown[]) { return args; }',
    );
    const opaque = sqliteRuntimeSource
      .replace(
        "import { createBetterAuthSqliteAppBindings } from '@kovojs/better-auth/sqlite';",
        [
          "import { createBetterAuthSqliteAppBindings } from '@kovojs/better-auth/sqlite';",
          'function opaqueAuthOptions<Value>(value: Value): Value { return value; }',
        ].join('\n'),
      )
      .replace(
        'return createBetterAuthSqliteAppBindings(appDatabase, {',
        'return createBetterAuthSqliteAppBindings(appDatabase, opaqueAuthOptions({',
      )
      .replace(
        '    signInAccess: options.signInAccess,\n  });',
        '    signInAccess: options.signInAccess,\n  }));',
      );

    for (const source of [forged, opaque]) {
      expect(generatedSqliteAuthGraph(source).createAppAuthBindings?.unresolved, source).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'KV406',
            message: 'Statically un-analyzable write site; manual touches required.',
          }),
        ]),
      );
    }
  });
});
