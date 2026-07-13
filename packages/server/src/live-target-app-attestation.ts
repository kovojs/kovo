import { isKovoApp } from './app-guards.js';
import type { KovoApp } from './app-types.js';
import {
  appLiveTargetAttestationAuthority,
  createLiveTargetAttestationWithAuthority,
} from './live-target-app-identity.js';
import type { MutationLiveTargetDescriptor } from './mutation-wire.js';

/**
 * @internal Mint a descriptor only through the closed app that owns its audience and signing
 * posture. The package subpath deliberately does not expose the lower-level raw-audience signer:
 * otherwise evaluated code in one cohosted app could use it as an oracle for another app.
 */
export function createAppLiveTargetAttestation<Request>(
  app: KovoApp<any, any, any, Request>,
  descriptor: Omit<MutationLiveTargetDescriptor, 'attestation'>,
  request: Request,
): string {
  if (!isKovoApp(app)) {
    throw new TypeError('Live-target attestation requires a closed Kovo app owner.');
  }
  return createLiveTargetAttestationWithAuthority(
    appLiveTargetAttestationAuthority(app),
    descriptor,
    request,
  );
}
