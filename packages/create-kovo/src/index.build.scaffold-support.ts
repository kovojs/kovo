import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import { installedPackageJson } from './index.test-support.js';

export function expectPackedKovoPackageShape(root: string): void {
  expect(installedPackageJson(root, '@kovojs/core')).toMatchObject({
    exports: {
      '.': {
        default: './dist/index.mjs',
        types: './dist/index.d.mts',
      },
    },
  });
  expect(installedPackageJson(root, '@kovojs/server')).toMatchObject({
    exports: {
      './jsx-runtime': {
        default: './dist/jsx-runtime.mjs',
        types: './dist/jsx-runtime.d.mts',
      },
    },
  });
  expect(installedPackageJson(root, '@kovojs/cli')).toMatchObject({
    bin: {
      kovo: './dist/bin.mjs',
    },
    exports: {
      '.': {
        default: './dist/api.mjs',
        types: './dist/api.d.mts',
      },
    },
  });
}

export function addSqliteDurableTaskRegistration(root: string): void {
  writeFileSync(
    join(root, 'src/sqlite-durable-task-proof.ts'),
    [
      "import { s, task } from '@kovojs/server';",
      '',
      "export const sqliteDurableTaskProof = task('sqlite-durable-task-proof', {",
      '  input: s.object({}),',
      '  run() {},',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const appSource = readFileSync(appPath, 'utf8')
    .replace(
      "import { contactsQuery } from './queries.js';",
      [
        "import { contactsQuery } from './queries.js';",
        "import { sqliteDurableTaskProof } from './sqlite-durable-task-proof.js';",
      ].join('\n'),
    )
    .replace('routes: [', 'tasks: [sqliteDurableTaskProof],\n  routes: [');
  writeFileSync(appPath, appSource, 'utf8');
}

export function execFileFailureOutput(error: unknown): string {
  if (error && typeof error === 'object') {
    const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown };
    const chunks = [stdout, stderr]
      .map((chunk) =>
        Buffer.isBuffer(chunk) ? chunk.toString('utf8') : typeof chunk === 'string' ? chunk : '',
      )
      .filter(Boolean);
    if (chunks.length > 0) return chunks.join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}
