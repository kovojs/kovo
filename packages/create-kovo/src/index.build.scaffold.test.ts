import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import { linkStarterBuildDependencies, resolveBin } from './index.test-support.js';
import { buildProductionArtifact } from './index.build.test-support.js';

describe('create-kovo starter (build integration: scaffold)', () => {
  it('typechecks the generated app with starter dependencies', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-tsc-'));

    try {
      writeKovoProject(root, { name: 'Tsc Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--types',
          'node',
          'src/schema.ts',
          'src/db.ts',
          'src/auth.ts',
          'src/queries.ts',
          'src/mutations.ts',
          'src/components/contacts.tsx',
          'src/components/auth-forms.tsx',
          'src/app.tsx',
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('typechecks the generated SQLite app variant', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-sqlite-tsc-'));

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Sqlite Tsc Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--types',
          'node',
          'src/schema.ts',
          'src/db.ts',
          'src/auth.ts',
          'src/queries.ts',
          'src/mutations.ts',
          'src/components/contacts.tsx',
          'src/components/auth-forms.tsx',
          'src/app.tsx',
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs vp check in the generated SQLite app', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-sqlite-check-'));

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Sqlite Check Proof' });
      execFileSync(process.execPath, ['scripts/link-local-kovo.mjs', root, process.cwd()], {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
      execFileSync('pnpm', ['install', '--ignore-workspace'], {
        cwd: root,
        stdio: 'pipe',
      });

      execFileSync(resolveBin('vp'), ['check'], {
        cwd: root,
        stdio: 'inherit',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 90_000);

  it('runs the generated in-app tests (data layer + request shell)', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-vitest-'));

    try {
      writeKovoProject(root, { name: 'Vitest Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(resolveBin('vitest'), ['--run', 'src/app.test.ts'], {
        cwd: root,
        stdio: 'pipe',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 90_000);

  it('runs the generated production build graph gate', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-prod-'));

    try {
      writeKovoProject(root, { name: 'Build Prod Proof' });
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('rebuilds production artifacts from current source when cache is warm', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-source-proof-'));

    try {
      writeKovoProject(root, { name: 'Build Source Proof' });
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);
      const firstHandler = readFileSync(join(root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(firstHandler).toContain('Contacts');

      const contactsPath = join(root, 'src/components/contacts.tsx');
      writeFileSync(
        contactsPath,
        readFileSync(contactsPath, 'utf8').replace('Contacts</h1>', 'Current Source Contacts</h1>'),
        'utf8',
      );

      buildProductionArtifact(root);
      const secondHandler = readFileSync(join(root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(secondHandler).toContain('Current Source Contacts');
      expect(secondHandler).not.toBe(firstHandler);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});
