// @internal package-private morph engine (SPEC §9.1). The live-DOM morph root,
// target, and keyed-fragment applier are framework white-box surface — NOT part
// of the public `./client` bootstrap surface. App entries build their root via
// `createBrowserKovoRoot` and apply deferred streams via the public `./generated`
// `applyDeferredStreamResponseToRuntime`; these raw engine symbols exist here only
// for framework-owned tests and emit tooling.
export { DomMorphRoot, DomMorphTarget, keyedDomMorph } from '../morph.js';
export type { MorphFragment, MorphRoot, MorphTarget } from '../morph.js';
