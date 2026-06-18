import {
  applyDeferredStreamResponseToRuntime,
  createQueryStore,
  DomMorphRoot,
  keyedDomMorph,
} from '@kovojs/runtime/client';

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
