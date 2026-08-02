import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  kovoCliTestTimeoutMs,
  KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
  runBoundedKovoCli,
} from '../test/bounded-cli.js';

const repoRoot = process.cwd();
const CHECK_THEN_BUILD_TIMEOUT_MS = kovoCliTestTimeoutMs(
  KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
  KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
);

describe('kovo build SQLite advisory presentation', { concurrent: false }, () => {
  it(
    'keeps both per-table KV447 warnings visible after source check then build',
    async () => {
      const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-sqlite-warnings-'));
      try {
        linkWorkspacePackages(root, ['browser', 'core', 'drizzle', 'server']);
        symlinkSync(
          join(repoRoot, 'packages/drizzle/node_modules/drizzle-orm'),
          join(root, 'node_modules/drizzle-orm'),
        );
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
          join(root, 'kovo.config.ts'),
          [
            "import { defineConfig, node } from '@kovojs/server/build';",
            '',
            'export default defineConfig({',
            '  preset: node({',
            '    retention: {',
            '      hours: 24,',
            "      immutableClientModules: 'retained',",
            "      priorTokenQueryReads: 'retained',",
            '    },',
            '  }),',
            '});',
            '',
          ].join('\n'),
          'utf8',
        );
        writeFileSync(
          join(root, 'app.mjs'),
          [
            "import './src/schema.ts';",
            "import { defineKovo } from '@kovojs/server';",
            '',
            "const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });",
            '',
            'export default app.assemble({',
            '  routes: [',
            "    app.route('/', {",
            "      access: app.publicAccess('SQLite warning presentation fixture'),",
            "      page: () => '<main>SQLite warning fixture</main>',",
            '    }),',
            '  ],',
            '});',
            '',
          ].join('\n'),
          'utf8',
        );
        writeFileSync(
          join(root, 'index.html'),
          '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
          'utf8',
        );
        writeFileSync(join(root, 'src/client.ts'), "import './style.css';\n", 'utf8');
        writeFileSync(join(root, 'src/style.css'), 'main { color: rebeccapurple; }\n', 'utf8');
        writeFileSync(
          join(root, 'src/schema.ts'),
          [
            "import { kovo } from '@kovojs/drizzle';",
            "import { sqliteTable, text } from 'drizzle-orm/sqlite-core';",
            '',
            "export const session = sqliteTable('session', {",
            "  id: text('id').primaryKey(),",
            "  userId: text('user_id').notNull(),",
            "}, kovo((columns) => ({ domain: 'session', key: columns.id, owner: columns.userId })));",
            '',
            "export const account = sqliteTable('account', {",
            "  id: text('id').primaryKey(),",
            "  userId: text('user_id').notNull(),",
            "}, kovo((columns) => ({ domain: 'account', key: columns.id, owner: columns.userId })));",
            '',
          ].join('\n'),
          'utf8',
        );

        const sourceCheck = await runBoundedKovoCli({
          args: ['check', 'source', './app.mjs'],
          cwd: root,
          deadlineMs: KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
        });
        expect(sourceCheck.exitCode, sourceCheck.stderr).toBe(0);
        expectKv447TableWarnings(`${sourceCheck.stdout}\n${sourceCheck.stderr}`);

        const build = await runBoundedKovoCli({
          args: ['build', './app.mjs'],
          cwd: root,
          deadlineMs: KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
        });
        expect(build.exitCode, build.stderr).toBe(0);
        expectKv447TableWarnings(`${build.stdout}\n${build.stderr}`);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    CHECK_THEN_BUILD_TIMEOUT_MS,
  );
});

function expectKv447TableWarnings(output: string): void {
  const warningLines = output.match(/^WARN KV447 .*$/gmu) ?? [];
  expect(warningLines).toHaveLength(2);
  expect(warningLines).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/Table session declares owner scoping/u),
      expect.stringMatching(/Table account declares owner scoping/u),
    ]),
  );
}

function linkWorkspacePackages(root: string, packages: readonly string[]): void {
  const scopeRoot = join(root, 'node_modules/@kovojs');
  mkdirSync(scopeRoot, { recursive: true });
  for (const name of packages) {
    symlinkSync(join(repoRoot, 'packages', name), join(scopeRoot, name));
  }
}
