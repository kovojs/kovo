import './security-bootstrap.js';

declare const kovoAppTokenBrand: unique symbol;

/**
 * Opaque application token returned by `app.assemble()` (SPEC §6.2.1/§9.5).
 *
 * Runtime providers, registries, declarations, and framework authorities live in a module-private
 * WeakMap. The private symbol is an author-time guardrail only; exact map membership is the runtime
 * proof.
 */
export interface KovoApp<AppTypes = unknown> {
  readonly [kovoAppTokenBrand]: AppTypes;
}

/**
 * Extract the author-usable contract and exact declaration-handle unions retained by an opaque
 * {@link KovoApp}. Runtime providers, registries, and assembly arrays are deliberately absent.
 */
export type InferKovoAppTypes<App extends KovoApp> =
  App extends KovoApp<infer AppTypes> ? AppTypes : never;

export { createRequestHandler } from './request-handler.js';
export type { AppMutationAdapter } from './app-mutation-adapter.js';
export type { RequestHandler } from './app-types.js';
