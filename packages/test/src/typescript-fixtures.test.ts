import { describe, expect, it } from 'vitest';

import {
  assertTypeScriptProgramHasNoDiagnostics,
  typeScriptInterfaceMemberTypes,
} from './typescript-fixtures.js';

describe('@kovojs/test TypeScript fixture seam', () => {
  it('asserts clean virtual programs through a reusable helper', async () => {
    await expect(
      assertTypeScriptProgramHasNoDiagnostics(
        {
          'clean.ts': 'export const count: number = 1;\n',
        },
        {
          compilerOptions: {
            types: [],
          },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('reports formatted virtual-program diagnostics', async () => {
    await expect(
      assertTypeScriptProgramHasNoDiagnostics(
        {
          'broken.ts': 'const count: number = "one";\n',
        },
        {
          compilerOptions: {
            types: [],
          },
        },
      ),
    ).rejects.toThrow("2322 broken.ts:1:7 Type 'string' is not assignable to type 'number'.");
  });

  it('extracts sorted interface member type facts', async () => {
    await expect(
      typeScriptInterfaceMemberTypes(
        'registry.d.ts',
        [
          'export interface FragmentTargets {',
          '  "cart-row": { rowId: string };',
          '  summary: { count: number };',
          '}',
        ].join('\n'),
        'FragmentTargets',
      ),
    ).resolves.toEqual({
      'cart-row': '{ rowId: string; }',
      summary: '{ count: number; }',
    });
  });
});
