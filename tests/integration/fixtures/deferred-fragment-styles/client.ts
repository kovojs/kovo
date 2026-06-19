import { createQueryStore } from '@kovojs/runtime/client';
import { applyDeferredStreamResponseToRuntime } from '@kovojs/runtime/generated';
import { DomMorphRoot, keyedDomMorph } from '@kovojs/runtime/internal/morph';

const store = createQueryStore();
const fixtureGlobal = globalThis as typeof globalThis & {
  applyDeferredCssStream?: (body: string) => unknown;
};

fixtureGlobal.applyDeferredCssStream = (body: string) => {
  return applyDeferredStreamResponseToRuntime({
    body,
    morph: keyedDomMorph,
    root: new DomMorphRoot(document),
    store,
  });
};
