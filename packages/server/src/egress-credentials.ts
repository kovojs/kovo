import { runWithMetadataAccess } from './egress.js';

/**
 * Per-cloud credential factories (SPEC §6.6; `plans/secure-framework.md` Phase 5). These are
 * the ONLY entry points into the module-private `metadataAllowed` AsyncLocalStorage frame that
 * makes the cloud instance-metadata endpoint reachable. There is deliberately NO generic
 * `withMetadataAccess` helper: the capability is granted only by wrapping a real cloud-SDK
 * credential provider, so a reflected SSRF — which never calls one of these factories — never
 * enters the frame and the metadata endpoint stays denied at the very same IP.
 *
 * Each factory wraps the SDK's credential *provider function* (the thing the SDK calls to fetch
 * or refresh a token off the metadata endpoint). The wrapper runs the provider inside the
 * metadata frame. Because the frame is `AsyncLocalStorage`, it survives the `await`/timer
 * boundaries inside the provider — and an SDK *refresh*, which calls the wrapped provider again,
 * re-enters the frame each time. The token theft an SSRF wants requires *calling the provider*,
 * which app code does intentionally; the SSRF cannot.
 *
 * Honesty (SPEC §6.6 rule 3): this is runtime defense-in-depth, not a by-construction proof.
 * Same-process code that already holds a credential provider can call it; the floor only
 * guarantees the *metadata transport* is gated to provider-call provenance, raising the bar
 * from "any SSRF steals managed-identity tokens" to "only code that runs a credential factory
 * reaches metadata."
 */

/** A cloud-SDK credential provider: an async function returning the resolved credentials. */
export type CredentialProvider<C> = () => Promise<C>;

/**
 * Wrap an AWS credential provider (e.g. `fromInstanceMetadata()` / `fromNodeProviderChain()`
 * from `@aws-sdk/credential-providers`) so that fetching/refreshing credentials runs inside the
 * metadata-allowed frame, permitting the IMDS reach the deny floor otherwise blocks. The
 * returned provider has the same shape, so it drops into `new S3Client({ credentials: kovo.aws...})`.
 *
 * @example
 *   import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
 *   const credentials = kovo.awsCredential(fromNodeProviderChain());
 *   const s3 = new S3Client({ credentials });
 */
export function awsCredential<C>(provider: CredentialProvider<C>): CredentialProvider<C> {
  return () => runWithMetadataAccess(() => provider());
}

/**
 * Wrap a GCP credential/token provider (e.g. the auth client's `getAccessToken` /
 * `getClient().getAccessToken` from `google-auth-library`) so refresh from the GCE metadata
 * server reaches the deny floor.
 */
export function gcpCredential<C>(provider: CredentialProvider<C>): CredentialProvider<C> {
  return () => runWithMetadataAccess(() => provider());
}

/**
 * Wrap an Azure credential provider (e.g. `ManagedIdentityCredential.getToken` bound, from
 * `@azure/identity`) so a managed-identity token fetch from IMDS / the `IDENTITY_ENDPOINT`
 * loopback reaches the deny floor.
 */
export function azureCredential<C>(provider: CredentialProvider<C>): CredentialProvider<C> {
  return () => runWithMetadataAccess(() => provider());
}
