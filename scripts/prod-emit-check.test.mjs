import { describe, expect, it } from 'vitest';

import { generatedProdEmitInput } from './generated-artifacts.mjs';
import { runProdEmitCheck } from './prod-emit-check.mjs';

describe('prod-emit-check gate', () => {
  it('runs the shared generated-artifact emit contract with an injected compiler', async () => {
    let receivedInput;
    const stdout = bufferedStdout();
    const code = await runProdEmitCheck({
      compileComponentModule(input) {
        receivedInput = input;
        return { files: validProdEmitFiles() };
      },
      stdout,
    });

    expect(code).toBe(0);
    expect(receivedInput).toBe(generatedProdEmitInput);
    expect(stdout.output).toBe('prod-emit-check/v1\nOK\n');
  });

  it('fails through the shared emit contract when generated sources drift', async () => {
    await expect(
      runProdEmitCheck({
        compileComponentModule() {
          return {
            files: [
              {
                fileName: 'routes/products/product-card.server.js',
                kind: 'server',
                source: '<button>Add</button>',
              },
              {
                fileName: 'routes/products/product-card.client.js',
                kind: 'client',
                source: 'export const ProductCard$button_click = handler;',
              },
              {
                fileName: 'generated/registries.d.ts',
                kind: 'registry',
                source: 'export interface Registries {}',
              },
            ],
          };
        },
        stdout: bufferedStdout(),
      }),
    ).rejects.toMatchObject({
      actual: expect.arrayContaining([
        expect.stringContaining('product-card.server.js missing stable source-derived handler'),
      ]),
    });
  });
});

function bufferedStdout() {
  return {
    output: '',
    write(chunk) {
      this.output += chunk;
      return true;
    },
  };
}

function validProdEmitFiles() {
  return [
    {
      fileName: 'routes/products/product-card.server.js',
      kind: 'server',
      source:
        '<button on:click="/c/__v/0123456789abcdef-1234567812345678123456781234567812345678123456781234567812345678/routes/products/product-card.client.js#ProductCard$button_click">Add</button>',
    },
    {
      fileName: 'routes/products/product-card.client.js',
      kind: 'client',
      source: 'export const ProductCard$button_click = handler;',
    },
    {
      fileName: 'generated/registries.d.ts',
      kind: 'registry',
      source: 'export interface Registries {}',
    },
  ];
}
