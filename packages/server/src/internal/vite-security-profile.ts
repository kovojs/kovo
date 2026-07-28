import type { ServerResponse } from 'node:http';

import type { KovoVitePlugin, KovoVitePluginOptions } from '../vite.js';
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
