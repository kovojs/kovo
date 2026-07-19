import { AsyncLocalStorage } from 'node:async_hooks';

/** @internal Scoped build/export state shared by CLI-controlled Vite loads. */
export interface KovoBuildContext {
  /**
   * True while the CLI is loading app source only to derive the build graph. The Vite plugin may
   * skip redundant full static data-plane facts in this context because the CLI runs the
   * fail-closed check authoritatively before emitting artifacts.
   */
  readonly graphDerivation?: boolean;
  /**
   * Framework-owned posture used only while `kovo build` evaluates an app to derive its closed
   * registry. Declared environment values exist as non-coercible unavailable sentinels in this
   * posture; real operator values are parsed only when the emitted server boots (SPEC §6.6/§9.5).
   */
  readonly appEnvironment?: 'unavailable';
}

const kovoBuildContextStorage = new AsyncLocalStorage<KovoBuildContext>();

/** @internal Return the current scoped Kovo build context, if any. */
export function currentKovoBuildContext(): KovoBuildContext | undefined {
  return kovoBuildContextStorage.getStore();
}

/** @internal Run work under a scoped Kovo build context. Async results retain the context. */
export function withKovoBuildContext<T>(context: KovoBuildContext, fn: () => T): T {
  return kovoBuildContextStorage.run(context, fn);
}
