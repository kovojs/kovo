/**
 * Private runtime receipts for endpoint authentication (SPEC §6.6/§9.1).
 *
 * A declaration's public `auth` metadata is audit information, not proof that a verifier ran.
 * Browser-state responses therefore consume either an exact request/declaration receipt minted
 * after an executable verifier succeeds, or a framework-only self-verifying handler witness.
 *
 * @internal
 */
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const executedVerifierRequests = createWitnessWeakMap<object, WeakSet<Request>>();
const selfVerifyingDeclarations = createWitnessWeakSet<object>();
const browserCredentialDelegatingDeclarations = createWitnessWeakSet<object>();

/** Mint an exact request/declaration receipt after an executable verifier returns true. */
export function markEndpointVerifierExecuted(declaration: object, request: Request): void {
  let requests = witnessWeakMapGet(executedVerifierRequests, declaration);
  if (requests === undefined) {
    requests = createWitnessWeakSet<Request>();
    witnessWeakMapSet(executedVerifierRequests, declaration, requests);
  }
  witnessWeakSetAdd(requests, request);
}

/** Pin a framework-owned declaration whose handler verifies before producing any response. */
export function markEndpointSelfVerifying(declaration: object): void {
  witnessWeakSetAdd(selfVerifyingDeclarations, declaration);
}

/**
 * Pin a framework-owned self-verifying adapter that must consume the browser credential carrier it
 * validates itself. This is deliberately separate from the general self-verifying witness: signed
 * webhooks remain credential-neutral, while an OAuth/session protocol adapter can receive the
 * Cookie and Authorization headers its own state/session verifier consumes (SPEC §6.6/§9.1).
 *
 * @internal
 */
export function markEndpointBrowserCredentialDelegation(declaration: object): void {
  witnessWeakSetAdd(browserCredentialDelegatingDeclarations, declaration);
}

/** Whether the exact canonical declaration owns the private credential-delegation witness. */
export function endpointBrowserCredentialDelegationPinned(declaration: object): boolean {
  return (
    witnessWeakSetHas(selfVerifyingDeclarations, declaration) &&
    witnessWeakSetHas(browserCredentialDelegatingDeclarations, declaration)
  );
}

/** Whether browser-state output has a private, runtime-backed authentication proof. */
export function endpointBrowserStateAuthExecuted(
  declaration: object,
  request: Request | undefined,
): boolean {
  const requests = witnessWeakMapGet(executedVerifierRequests, declaration);
  return (
    witnessWeakSetHas(selfVerifyingDeclarations, declaration) ||
    (request !== undefined && requests !== undefined && witnessWeakSetHas(requests, request))
  );
}
