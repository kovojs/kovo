import { AsyncLocalStorage } from 'node:async_hooks';

/** @internal Scoped build/export state shared by CLI-controlled Vite loads. */
export interface KovoBuildContext {
  /**
   * True while the CLI is loading app source only to derive the build graph. The Vite plugin may
   * skip redundant full static data-plane facts in this context because the CLI runs the
   * fail-closed check authoritatively before emitting artifacts.
   */
  readonly graphDerivation?: boolean;
}

const kovoBuildContextStorage = new AsyncLocalStorage<KovoBuildContext>();

/** @internal Return the current scoped Kovo build context, if any. */
export function currentKovoBuildContext(): KovoBuildContext | undefined {
  return kovoBuildContextStorage.getStore();
}

/** @internal Run async work under a scoped Kovo build context. */
export async function withKovoBuildContext<T>(
  context: KovoBuildContext,
  fn: () => Promise<T>,
): Promise<T> {
  return await kovoBuildContextStorage.run(context, fn);
}
