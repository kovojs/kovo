import { describe, expect, it } from 'vitest';

import {
  RENDER_PLAN_GRAMMAR_VERSION,
  computeRenderPlanFingerprint,
  type RenderPlanFingerprintInput,
} from '@kovojs/core/internal/render-plan-token';

import { computeCompilerRenderPlanFingerprint } from './compile.js';

// CAP6 (plans/compiler-refactoring.md): drift-proof render-plan token contract.
//
// SPEC.md §5.2.1 mandates ONE opaque build-stable render-plan token, and KV416
// fails the build on token/grammar drift between the producer (compiler) and the
// consumer (server). FN1 hoisted the grammar version + fingerprint to a single
// `@kovojs/core/internal/render-plan-token` module that BOTH @kovojs/compiler
// (`computeCompilerRenderPlanFingerprint`) and @kovojs/server (`client-modules.ts`
// re-export) delegate to. This contract test locks the compiler wrapper to the
// shared core source so a re-introduced local implementation would fail loudly.
// (@kovojs/server re-exports the same core function verbatim, so compiler == core
// == server transitively; a 3-way corpus test that also imports the server lives in
// tests/integration where both packages are deps.)

describe('CAP6: render-plan token cross-package contract', () => {
  const corpus: RenderPlanFingerprintInput[] = [
    {},
    { cart: 'shape:{count:number}' },
    { cart: 'shape:{count:number}', product: 'shape:{id:string,stock:number}' },
    { product: 'shape:{id:string,stock:number}', cart: 'shape:{count:number}' },
    { a: '1', b: '2', c: '3' },
  ];

  it('compiler fingerprint equals the shared core fingerprint over a corpus', () => {
    for (const input of corpus) {
      expect(computeCompilerRenderPlanFingerprint(input)).toBe(computeRenderPlanFingerprint(input));
    }
  });

  it('is order-insensitive in query keys (projected-shape identity, not key order)', () => {
    const a = computeCompilerRenderPlanFingerprint({ cart: 'x', product: 'y' });
    const b = computeCompilerRenderPlanFingerprint({ product: 'y', cart: 'x' });
    expect(a).toBe(b);
  });

  it('moves the token when any projected query shape changes (KV416 monotonicity)', () => {
    const base = computeCompilerRenderPlanFingerprint({ cart: 'shape:{count:number}' });
    const changed = computeCompilerRenderPlanFingerprint({ cart: 'shape:{count:string}' });
    expect(changed).not.toBe(base);
  });

  it('is deterministic for a fixed input', () => {
    const input = { cart: 'shape:{count:number}', product: 'shape:{id:string}' };
    expect(computeCompilerRenderPlanFingerprint(input)).toBe(
      computeCompilerRenderPlanFingerprint(input),
    );
  });

  it('pins the shared grammar version constant', () => {
    expect(RENDER_PLAN_GRAMMAR_VERSION).toBe('kovo-render-plan/1');
  });
});
