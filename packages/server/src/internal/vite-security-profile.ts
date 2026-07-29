import type { ServerResponse } from 'node:http';

import type { KovoVitePlugin, KovoVitePluginOptions } from '../vite.js';
import type { KovoApp } from '../app-types.js';
import { frameworkManagedDbProviderDevelopmentPosture } from '../guards.js';
import { kovo } from '../vite.js';
import { createKovoAppShellViteDevIntegration } from '../vite-dev.js';
export { nodeRequestPreloadIngressRejection, rejectNodeRequestPreloadIngress } from '../node.js';
import {
  trustedViteSecurityProfileIntegrationSentinel,
  trustedViteSecurityProfileParanoidSentinel,
  trustedViteSecurityProfileResponseCookiesSentinel,
  trustedViteSecurityProfileSentinel,
} from './vite-security-sentinel.js';

interface TrustedKovoVitePluginOptions extends KovoVitePluginOptions {
  paranoidStaticAdvisory: boolean;
  responseSetCookieValues?(response: ServerResponse): readonly string[];
}

/** @internal Stable readiness labels projected only from the active app's pinned DB provider. */
export function kovoDevDatabasePosture(app: KovoApp): string {
  if (app.db === undefined) return 'none configured';
  const posture = frameworkManagedDbProviderDevelopmentPosture(app.db);
  if (posture === 'postgres-pglite') return 'Postgres (PGlite embedded development driver)';
  if (posture === 'postgres-external') return 'Postgres (external node-postgres driver)';
  if (posture === 'sqlite') return 'SQLite (experimental single-principal driver)';
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
  } as KovoVitePluginOptions);
}
