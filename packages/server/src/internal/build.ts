import '../security-bootstrap.js';

import {
  runWithGeneratedLiveTargetRegistry,
  runWithGeneratedLiveTargetRegistryInCurrentContext,
} from '../live-target-registry.js';
import { withKovoBuildContext } from './build-context.js';

export { deriveClosedKovoApp } from '../app-snapshot.js';
export { runWithGeneratedLiveTargetRegistry };
export {
  writeKovoNeutralBuild,
  type KovoNeutralBuild,
  type WriteKovoNeutralBuildOptions,
} from '../neutral-build.js';

/** @internal Evaluate the build app under the exact server graph's unavailable-env posture. */
export async function runWithUnavailableBuildAppEnvironment<Value>(
  load: () => PromiseLike<Value>,
): Promise<Value> {
  // SPEC §6.6/§9.5: keep both async-context cells and the async wrapper in this module graph.
  // Loading build-context through a second absolute Vite id creates a distinct private cell, while
  // returning Vite's foreign thenable directly can close the lifecycle before evaluation settles.
  return await withKovoBuildContext(
    { appEnvironment: 'unavailable', graphDerivation: true },
    async () =>
      await runWithGeneratedLiveTargetRegistryInCurrentContext(async () => await load()),
  );
}
