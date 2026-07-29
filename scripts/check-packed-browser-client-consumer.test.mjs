import { describe, expect, it } from 'vitest';

import {
  assertPackedBrowserClientDeclarations,
  assertPackedBrowserClientManifest,
  assertPackedBrowserModulesHaveNoNodeBuiltins,
  packedBrowserClientDeclarationExports,
} from './check-packed-browser-client-consumer.mjs';

const declaration = `
interface InstallKovoClientOptions { root?: EventTarget & ParentNode }
interface KovoClient { ready: Promise<void>; dispose(mode?: 'abort' | 'drain'): Promise<void> }
declare function installKovoClient(options?: InstallKovoClientOptions): KovoClient;
export { type InstallKovoClientOptions, type KovoClient, installKovoClient };
`;

describe('packed browser client consumer proof', () => {
  it('accepts only the narrow custom-shell manifest and declarations', () => {
    expect(() =>
      assertPackedBrowserClientManifest({
        dependencies: { '@kovojs/core': '0.2.0' },
        exports: {
          '.': {
            default: './dist/index.mjs',
            types: './dist/index.d.mts',
          },
          './client': {
            default: './dist/client.mjs',
            types: './dist/client.d.mts',
          },
        },
        name: '@kovojs/browser',
        version: '0.2.0',
      }),
    ).not.toThrow();
    expect(packedBrowserClientDeclarationExports(declaration)).toEqual([
      'InstallKovoClientOptions',
      'KovoClient',
      'installKovoClient',
    ]);
    expect(() => assertPackedBrowserClientDeclarations(declaration)).not.toThrow();
  });

  it('rejects retired assembly values, public any, and Node builtins', () => {
    expect(() =>
      assertPackedBrowserClientDeclarations(
        `${declaration}\nexport declare function createQueryStore(): any;\n`,
      ),
    ).toThrow();
    expect(() =>
      assertPackedBrowserModulesHaveNoNodeBuiltins([
        {
          data: Buffer.from("import 'node:fs';"),
          name: 'package/dist/client.mjs',
        },
      ]),
    ).toThrow('Node builtins');
  });
});
