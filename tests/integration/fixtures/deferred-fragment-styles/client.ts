import { createQueryStore } from '@kovojs/browser/client';
import { applyDeferredStreamResponseToRuntime } from '@kovojs/browser/generated';
import { DomMorphRoot, keyedDomMorph } from '@kovojs/browser/internal/morph';

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
