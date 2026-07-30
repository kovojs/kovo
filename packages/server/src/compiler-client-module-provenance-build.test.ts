import { compilerViteClientModuleRoleProtocol } from '@kovojs/compiler/internal';
import { describe, expect, it } from 'vitest';

import { computeRenderPlanFingerprint } from './client-modules.js';
import { claimCompilerClientModuleBuildInstaller } from './compiler-client-module-provenance-build.js';

describe('isolated compiler client-module build adopter', () => {
  it('poisons the one-shot adopter after a duplicate registration failure', () => {
    const installer = claimCompilerClientModuleBuildInstaller(compilerViteClientModuleRoleProtocol);
    const module = Object.freeze({
      path: '/c/src/card.client.js',
      renderPlanFingerprint: computeRenderPlanFingerprint({}),
      source: 'export const card = true;',
    });
    installer.adoptComponentClient(module);

    expect(() => installer.adoptComponentClient(module)).toThrow(/installed twice/u);
    expect(() =>
      installer.adoptComponentClient(
        Object.freeze({
          path: '/c/src/other.client.js',
          renderPlanFingerprint: computeRenderPlanFingerprint({}),
          source: 'export const other = true;',
        }),
      ),
    ).toThrow(/permanently closed/u);
    expect(() => installer.seal()).toThrow(/permanently closed/u);
  });
});
