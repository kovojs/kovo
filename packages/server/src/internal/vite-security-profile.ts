import type { ServerResponse } from 'node:http';

import type { KovoVitePlugin, KovoVitePluginOptions } from '../vite.js';
import type { KovoApp } from '../app-types.js';
import { frameworkManagedDbProviderDevelopmentPosture } from '../guards.js';
import { runWithGeneratedLiveTargetRegistry } from '../live-target-registry.js';
import { bindServerLoopbackDevelopmentOrigin } from '../runtime-environment-authority.js';
import { kovo } from '../vite.js';
import {
  createKovoAppShellViteDevIntegration,
  dispatchKovoAppShellViteDevRequest,
  prepareKovoAppShellViteDevGeneration,
} from '../vite-dev.js';
export {
  claimCompilerClientModuleViteInstaller,
  compilerClientModuleViteEpoch,
  type CompilerClientModuleViteInstaller,
  type CompilerClientModuleViteRecord,
  type CompilerClientModuleViteSnapshotInstaller,
} from '../compiler-client-module-provenance-vite.js';
export { nodeRequestPreloadIngressRejection, rejectNodeRequestPreloadIngress } from '../node.js';
import {
  trustedViteSecurityProfileIntegrationSentinel,
  trustedViteSecurityProfileParanoidSentinel,
  trustedViteSecurityProfileResponseCookiesSentinel,
  trustedViteSecurityProfileRunnerGenerationsSentinel,
  trustedViteSecurityProfileSentinel,
} from './vite-security-sentinel.js';

// The supported runner imports this already-authenticated profile in every fresh HMR generation.
// Keep its generation-only controls here so SPEC §6.2.1's fresh closed graph does not also link
// the production build/static-export surface from the broad internal/app-shell-vite barrel.
export {
  dispatchKovoAppShellViteDevRequest,
  prepareKovoAppShellViteDevGeneration,
  runWithGeneratedLiveTargetRegistry,
};

interface TrustedKovoViteRunnerGenerationBroker {
  activateInitial(): Promise<void>;
  bindOrigin(origin: string): void;
  close(): Promise<void>;
  configure(server: unknown, hooks: object): void;
  prepareInitial(): Promise<void>;
  stage(token?: object): Promise<void>;
  withLease<T>(
    operation: (server: { ssrLoadModule<TModule>(id: string): Promise<TModule> }) => Promise<T>,
  ): Promise<T>;
}

interface TrustedKovoVitePluginOptions extends KovoVitePluginOptions {
  appShellModuleId?: string;
  nodeDataPlaneBootstrapModuleId?: string;
  paranoidStaticAdvisory: boolean;
  responseSetCookieValues?(response: ServerResponse): readonly string[];
  runnerGenerations?: TrustedKovoViteRunnerGenerationBroker;
  securityProfileModuleId?: string;
  serverRootModuleId?: string;
}

/**
 * Bind the actual loopback origin after the supported development server owns its socket.
 *
 * @internal This entry is intentionally available only through the trusted live SSR profile.
 */
export function bindKovoDevLoopbackOrigin(origin: string): void {
  bindServerLoopbackDevelopmentOrigin(origin);
}

/** @internal Stable readiness labels projected only from the active app's pinned DB provider. */
export function kovoDevDatabasePosture(app: KovoApp): string {
  if (app.db === undefined) return 'none configured';
  const posture = frameworkManagedDbProviderDevelopmentPosture(app.db);
  if (posture === 'postgres-pglite') return 'Postgres (PGlite embedded development driver)';
  if (posture === 'postgres-external') return 'Postgres (external node-postgres driver)';
  if (posture === 'sqlite') {
    return 'SQLite (experimental single-principal driver; KV447 owner annotations are audit-only)';
  }
  return 'application-defined (active driver not introspectable)';
}

/**
 * Construct the Vite plugin posture used only by the supported `kovo dev` runner.
 *
 * @internal The module-private sentinel selects the statically bound request-shell integration
 * captured by the bootstrap graph before authored config/plugin evaluation (SPEC §6.6 rule 6).
 */
export function trustedKovoVitePlugin(options: TrustedKovoVitePluginOptions): KovoVitePlugin {
  return kovo({
    app: options.app,
    [trustedViteSecurityProfileSentinel]: trustedViteSecurityProfileSentinel,
    [trustedViteSecurityProfileIntegrationSentinel]: createKovoAppShellViteDevIntegration,
    [trustedViteSecurityProfileParanoidSentinel]: options.paranoidStaticAdvisory,
    ...(options.responseSetCookieValues === undefined
      ? {}
      : {
          // oxlint-disable-next-line typescript/unbound-method -- This callback is transported as a value and invoked without a receiver.
          [trustedViteSecurityProfileResponseCookiesSentinel]: options.responseSetCookieValues,
        }),
    ...(options.runnerGenerations === undefined
      ? {}
      : {
          [trustedViteSecurityProfileRunnerGenerationsSentinel]: Object.freeze({
            appShellModuleId: options.appShellModuleId,
            nodeDataPlaneBootstrapModuleId: options.nodeDataPlaneBootstrapModuleId,
            runnerGenerations: options.runnerGenerations,
            securityProfileModuleId: options.securityProfileModuleId,
            serverRootModuleId: options.serverRootModuleId,
          }),
        }),
  } as KovoVitePluginOptions);
}
