import { createQueryStore } from '@kovojs/browser/client';
import { applyDeferredStreamResponseToRuntime } from '@kovojs/test/internal/integration/fixture-browser-abi';
import { DomMorphRoot, keyedDomMorph } from '@kovojs/test/internal/integration/fixture-browser-abi';

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
