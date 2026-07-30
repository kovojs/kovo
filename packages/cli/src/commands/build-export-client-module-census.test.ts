import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { compilerOwnedViteClientModuleRole } from '@kovojs/compiler/internal';
import { describe, expect, it } from 'vitest';

import {
  assertCompilerClientModuleParityForTests,
  compilerClientModulesFromApprovedSourcesForTests,
  finalCompilerClientModulesFromBuildPassesForTests,
} from './build-export.js';

const componentSource = `
import { component } from '@kovojs/core';

export const Counter = component({
  state: () => ({ count: 0 }),
  render: () => (
    <button onClick={() => { state.count += 1; }}>{state.count}</button>
  ),
});
`;

describe('build compiler client-module census', () => {
  it('derives genuine build-mode modules from the authenticated in-memory source snapshot', async () => {
    const fixture = createFixture('snapshot');
    try {
      const modules = await compilerClientModulesFromApprovedSourcesForTests(
        fixture.appModulePath,
        fixture.root,
        [{ fileName: 'src/app.tsx', source: componentSource }],
      );

      expect(modules).toEqual([
        expect.objectContaining({
          path: '/c/src/app.client.js',
          source: expect.stringContaining('Counter$button_click'),
        }),
      ]);
      expect(
        modules.every((module) => compilerOwnedViteClientModuleRole(module) !== undefined),
      ).toBe(true);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it('keeps the final compilation exact and rejects source, path, and copied-provenance drift', async () => {
    const fixture = createFixture('drift');
    try {
      const approved = await compilerClientModulesFromApprovedSourcesForTests(
        fixture.appModulePath,
        fixture.root,
        [{ fileName: 'src/app.tsx', source: componentSource }],
      );
      const exactFinal = await compilerClientModulesFromApprovedSourcesForTests(
        fixture.appModulePath,
        fixture.root,
        [{ fileName: 'src/app.tsx', source: componentSource }],
      );
      expect(() => assertCompilerClientModuleParityForTests(approved, exactFinal)).not.toThrow();

      const sourceDrift = await compilerClientModulesFromApprovedSourcesForTests(
        fixture.appModulePath,
        fixture.root,
        [
          {
            fileName: 'src/app.tsx',
            source: componentSource.replace('state.count += 1', 'state.count += 2'),
          },
        ],
      );
      expect(() => assertCompilerClientModuleParityForTests(approved, sourceDrift)).toThrow(
        /changed the discovered client-module role census/u,
      );

      const pathDriftRoot = join(fixture.root, 'alternate');
      mkdirSync(pathDriftRoot, { recursive: true });
      const pathDrift = await compilerClientModulesFromApprovedSourcesForTests(
        join(pathDriftRoot, 'app.tsx'),
        fixture.root,
        [{ fileName: 'alternate/app.tsx', source: componentSource }],
      );
      expect(() => assertCompilerClientModuleParityForTests(approved, pathDrift)).toThrow(
        /changed the discovered client-module role census/u,
      );

      expect(() =>
        assertCompilerClientModuleParityForTests(
          approved,
          exactFinal.map((module) => ({ ...module })),
        ),
      ).toThrow(/refused unproven final compiler client modules/u);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it('rejects a final SSR omission hidden by a genuine module from the earlier browser pass', async () => {
    const fixture = createFixture('ssr-omission');
    try {
      const earlierBrowserAndDiscoveryModule =
        await compilerClientModulesFromApprovedSourcesForTests(
          fixture.appModulePath,
          fixture.root,
          [{ fileName: 'src/app.tsx', source: componentSource }],
        );

      // This is the masking shape that aggregate union parity alone cannot distinguish:
      // discovery union = browser A + SSR A, final union = browser A + SSR [].
      expect(() =>
        assertCompilerClientModuleParityForTests(
          earlierBrowserAndDiscoveryModule,
          earlierBrowserAndDiscoveryModule,
        ),
      ).not.toThrow();
      expect(
        finalCompilerClientModulesFromBuildPassesForTests(
          earlierBrowserAndDiscoveryModule,
          earlierBrowserAndDiscoveryModule,
          earlierBrowserAndDiscoveryModule,
        ),
      ).toEqual(earlierBrowserAndDiscoveryModule);
      expect(() =>
        finalCompilerClientModulesFromBuildPassesForTests(
          earlierBrowserAndDiscoveryModule,
          earlierBrowserAndDiscoveryModule,
          [],
        ),
      ).toThrow(/changed the discovered client-module role census/u);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it('rejects source identities that escape or omit the selected app module', async () => {
    const fixture = createFixture('boundary');
    try {
      await expect(
        compilerClientModulesFromApprovedSourcesForTests(fixture.appModulePath, fixture.root, [
          { fileName: '../escape.tsx', source: componentSource },
        ]),
      ).rejects.toThrow(/escapes the build root/u);
      await expect(
        compilerClientModulesFromApprovedSourcesForTests(fixture.appModulePath, fixture.root, [
          { fileName: 'src/other.tsx', source: componentSource },
        ]),
      ).rejects.toThrow(/omitted the selected app module/u);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });
});

function createFixture(label: string): { appModulePath: string; root: string } {
  const root = mkdtempSync(join(process.cwd(), `.tmp-build-client-census-${label}-`));
  const appModulePath = join(root, 'src/app.tsx');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(appModulePath, componentSource, 'utf8');
  return { appModulePath, root };
}
