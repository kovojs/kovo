import { describe, expect, it } from 'vitest';

import {
  blessedSinkKindsReferencedByFile,
  checkSinkPolicyGate,
  exportedNames,
  extractRegisteredBlessedSinkKinds,
} from './check-sink-policy-gate.mjs';

const validPolicy = `
export const FRAMEWORK_BLESSED_SINK_KINDS = [
  'core:route-redirect',
  'parameterized-sql',
] as const;
export type Blessed<Sink extends string> = { readonly __brand?: Sink };
export function blessSink(sink, value) { return value; }
export function isBlessedSink(sink, value) { return true; }
`;

function runFixture(files) {
  return checkSinkPolicyGate({
    blessedSinkFiles: Object.keys(files).filter((file) => file !== 'public.ts'),
    exists: (file) => Object.hasOwn(files, file),
    publicEntrypointFiles: Object.hasOwn(files, 'public.ts') ? ['public.ts'] : [],
    readText: (file) => files[file],
    sinkPolicyPath: 'sink-policy.ts',
  });
}

describe('sink-policy gate', () => {
  it('extracts the central blessed sink registry', () => {
    expect([...extractRegisteredBlessedSinkKinds(validPolicy)]).toEqual([
      'core:route-redirect',
      'parameterized-sql',
    ]);
  });

  it('collects literal, const-backed, and typed-union blessed sink use', () => {
    expect([
      ...blessedSinkKindsReferencedByFile(`
        type SqlBlessedSink = 'parameterized-sql' | 'static-sql';
        const ROUTE_REDIRECT_SINK = 'core:route-redirect';
        blessSink(ROUTE_REDIRECT_SINK, value);
        isBlessedSink('server:redirect-location', value);
      `),
    ]).toEqual([
      'parameterized-sql',
      'static-sql',
      'core:route-redirect',
      'server:redirect-location',
    ]);
  });

  it('rejects blessed sink use that is not centrally declared', () => {
    expect(
      runFixture({
        'sink-policy.ts': validPolicy,
        'uses.ts': `blessSink('server:redirect-location', response);`,
      }),
    ).toEqual([
      'uses.ts: blessed sink kind "server:redirect-location" is used but not declared in FRAMEWORK_BLESSED_SINK_KINDS',
    ]);
  });

  it('rejects Symbol.for witnesses in the shared substrate', () => {
    expect(
      runFixture({
        'sink-policy.ts': `${validPolicy}\nconst witness = Symbol.for('kovo.bless.any');`,
      }),
    ).toEqual(['sink-policy.ts: shared Blessed<Sink> witness substrate must not use Symbol.for()']);
  });

  it('rejects new generic trust or bless exports', () => {
    expect(exportedNames('export { hidden as trustSink };')).toEqual(new Set(['trustSink']));
    expect(
      runFixture({
        'sink-policy.ts': `${validPolicy}\nexport function trustSink(value) { return value; }`,
        'public.ts': 'export { blessSink } from "./internal/sink-policy.js";',
      }),
    ).toEqual([
      'sink-policy.ts: unexpected sink-policy export trustSink; avoid generic trust/bless escape hatches',
      'public.ts: public export blessSink would create a generic blessed-sink escape hatch',
    ]);
  });
});
