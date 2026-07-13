import type { KovoVitePlugin, KovoVitePluginOptions } from '../vite.js';
import { kovo } from '../vite.js';
import { createKovoAppShellViteDevIntegration } from '../vite-dev.js';
import {
  trustedViteSecurityProfileIntegrationSentinel,
  trustedViteSecurityProfileParanoidSentinel,
  trustedViteSecurityProfileSentinel,
} from './vite-security-sentinel.js';

interface TrustedKovoVitePluginOptions extends KovoVitePluginOptions {
  paranoidStaticAdvisory: boolean;
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
  } as KovoVitePluginOptions);
}
