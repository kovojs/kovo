/**
 * Private runtime receipts for endpoint authentication (SPEC §6.6/§9.1).
 *
 * A declaration's public `auth` metadata is audit information, not proof that a verifier ran.
 * Browser-state responses therefore consume either an exact request/declaration receipt minted
 * after an executable verifier succeeds, or a framework-only self-verifying handler witness.
 *
 * @internal
 */

const executedVerifierRequests = new WeakMap<object, WeakSet<Request>>();
const selfVerifyingDeclarations = new WeakSet<object>();

/** Mint an exact request/declaration receipt after an executable verifier returns true. */
export function markEndpointVerifierExecuted(declaration: object, request: Request): void {
  let requests = executedVerifierRequests.get(declaration);
  if (requests === undefined) {
    requests = new WeakSet<Request>();
    executedVerifierRequests.set(declaration, requests);
  }
  requests.add(request);
}

/** Pin a framework-owned declaration whose handler verifies before producing any response. */
export function markEndpointSelfVerifying(declaration: object): void {
  selfVerifyingDeclarations.add(declaration);
}

/** Whether browser-state output has a private, runtime-backed authentication proof. */
export function endpointBrowserStateAuthExecuted(
  declaration: object,
  request: Request | undefined,
): boolean {
  return (
    selfVerifyingDeclarations.has(declaration) ||
    (request !== undefined && executedVerifierRequests.get(declaration)?.has(request) === true)
  );
}
