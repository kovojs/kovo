import { describe, expect, it } from 'vitest';

import {
  emissionDoorPath,
  evaluateEmissionConstructorClosure,
  loadEmissionClosureSources,
} from './emission-constructor-closure-gate.mjs';

function sourcesWith(overrides = {}) {
  return { ...loadEmissionClosureSources(), ...overrides };
}

describe('structural emission constructor closure gate', () => {
  it('accepts the exact reviewed shared door and consumer set', () => {
    expect(evaluateEmissionConstructorClosure(loadEmissionClosureSources())).toMatchObject({
      consumers: 2,
      constructors: 4,
      findings: [],
      ok: true,
    });
  });

  it('fails when the queue migration regresses to direct interpolation', () => {
    const file = 'packages/drizzle/src/derive-codegen.ts';
    const source = loadEmissionClosureSources()[file];
    const mutated = source.replace('jsStringLiteral(options.queue)', 'options.queue');
    expect(mutated).not.toBe(source);

    expect(evaluateEmissionConstructorClosure(sourcesWith({ [file]: mutated }))).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.stringContaining(
          'required constructor call is missing: jsStringLiteral(options.queue)',
        ),
      ]),
    });
  });

  it('fails when the registry recreates an ad hoc string-literal helper', () => {
    const file = 'packages/compiler/src/emit/registry.ts';
    const source = loadEmissionClosureSources()[file];
    const mutated = `${source}\nfunction registryStringLiteral(value: string): string { return value; }\n`;

    expect(evaluateEmissionConstructorClosure(sourcesWith({ [file]: mutated }))).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.stringContaining('legacy structural emission bypass remains'),
      ]),
    });
  });

  it('keeps emitDerive outside the shared constructor migration kill-list boundary', () => {
    const file = 'packages/compiler/src/lower/structural-jsx.ts';
    const source = loadEmissionClosureSources()[file];
    const mutated = `import { jsStringLiteral } from '${'@kovojs/core/internal/emission'}';\n${source}`;

    expect(evaluateEmissionConstructorClosure(sourcesWith({ [file]: mutated }))).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.stringContaining(`structural emission consumers: unexpected ${file}`),
      ]),
    });
    expect(loadEmissionClosureSources()).toHaveProperty(emissionDoorPath);
  });

  it('fails when a Core module reaches the door through a relative import', () => {
    const file = 'packages/core/src/internal/json.ts';
    const source = loadEmissionClosureSources()[file];
    const mutated = `import { jsStringLiteral } from './emission.js';\n${source}`;

    expect(evaluateEmissionConstructorClosure(sourcesWith({ [file]: mutated }))).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.stringContaining(`structural emission consumers: unexpected ${file}`),
      ]),
    });
  });

  it('fails when another module defines or re-exports a constructor lookalike', () => {
    const file = 'packages/core/src/internal/json.ts';
    const source = loadEmissionClosureSources()[file];
    const mutated = `${source}\nexport const jsStringLiteral = (value: string): string => value;\nexport { jsStringLiteral };\n`;
    const result = evaluateEmissionConstructorClosure(sourcesWith({ [file]: mutated }));

    expect(result).toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.stringContaining(`jsStringLiteral production definitions: unexpected ${file}`),
        expect.stringContaining('structural emission constructors must not be re-exported'),
      ]),
    });
  });
});
