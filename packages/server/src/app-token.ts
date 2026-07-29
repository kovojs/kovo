import type { KovoApp as RuntimeKovoApp } from './app-types.js';
import {
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessWeakMapGet,
  witnessWeakMapHas,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

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

const runtimeApps = createWitnessWeakMap<object, RuntimeKovoApp>();

/** @internal Close one normalized runtime aggregate behind an opaque public token. */
export function createKovoAppToken(app: RuntimeKovoApp): KovoApp<never> {
  const token = witnessFreeze(witnessCreateNullRecord());
  witnessWeakMapSet(runtimeApps, token, app);
  return token as unknown as KovoApp<never>;
}

/** Test exact opaque-token identity without reflecting over caller-owned properties. */
export function isKovoApp(value: unknown): value is KovoApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakMapHas(runtimeApps, value)
  );
}

/**
 * @internal Resolve an opaque token for a framework-owned adapter/build boundary.
 *
 * A token produced by another physical `@kovojs/server` copy has no entry in this map and fails
 * with the duplicate-package diagnostic rather than becoming a structural capability.
 */
export function resolveKovoAppToken(value: unknown, consumer: string): RuntimeKovoApp {
  if (typeof value !== 'object' || value === null) {
    throw invalidTokenError(consumer);
  }
  const app = witnessWeakMapGet(runtimeApps, value);
  if (app === undefined) throw invalidTokenError(consumer);
  return app;
}

function invalidTokenError(consumer: string): TypeError {
  return new TypeError(
    `${consumer} requires the exact opaque KovoApp returned by app.assemble(). ` +
      'A structural copy or a token from a duplicate @kovojs/server package instance is not ' +
      'accepted (KOVO_APP_PACKAGE_INSTANCE_MISMATCH; SPEC §6.2.1/§9.5).',
  );
}
