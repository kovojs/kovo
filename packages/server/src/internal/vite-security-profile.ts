import type { KovoVitePlugin, KovoVitePluginOptions } from '../vite.js';
import { kovo } from '../vite.js';
import { createKovoAppShellViteDevIntegration } from '../vite-dev.js';
import {
  trustedViteSecurityProfileIntegrationSentinel,
  trustedViteSecurityProfileSentinel,
} from './vite-security-sentinel.js';

/**
 * Construct the Vite plugin posture used only by the supported `kovo dev` runner.
 *
 * @internal The module-private sentinel selects the statically bound request-shell integration
 * captured by the bootstrap graph before authored config/plugin evaluation (SPEC §6.6 rule 6).
 */
export function trustedKovoVitePlugin(options: KovoVitePluginOptions): KovoVitePlugin {
  return kovo({
    ...options,
    [trustedViteSecurityProfileSentinel]: trustedViteSecurityProfileSentinel,
    [trustedViteSecurityProfileIntegrationSentinel]: createKovoAppShellViteDevIntegration,
  } as KovoVitePluginOptions);
}
