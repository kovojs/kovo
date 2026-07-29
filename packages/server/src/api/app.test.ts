import { describe, expect, it } from 'vitest';

// This mixed public/internal package-boundary test must install the Node SQL parser authority
// before the ordinary root seals late authority mutation.
import '../sql-parser-authority-bootstrap.js';
import { trustedHtml, trustedUrl } from '@kovojs/browser';
import {
  createFileSystemStorage as coreCreateFileSystemStorage,
  createMemoryStorage as coreCreateMemoryStorage,
  createS3CompatibleStorage as coreCreateS3CompatibleStorage,
} from '@kovojs/core/storage';
import {
  customVerifier as coreCustomVerifier,
  hmacSignature as coreHmacSignature,
  standardWebhooks as coreStandardWebhooks,
} from '@kovojs/core/webhooks';
import { type SecretValue } from '@kovojs/core/security';

import * as packageRootApi from '@kovojs/server';
import * as packageViteApi from '@kovojs/server/vite';
import * as packageInternalAuditFactsApi from '@kovojs/server/internal/audit-facts';
import * as packageInternalCapabilitiesApi from '@kovojs/server/internal/capabilities';
import * as packageInternalClientModulesApi from '@kovojs/server/internal/client-modules';
import * as packageInternalCspApi from '@kovojs/server/internal/csp';
import * as packageInternalCsrfApi from '@kovojs/server/internal/csrf';
import * as packageInternalEgressApi from '@kovojs/server/internal/egress';
import * as packageInternalEscapeApi from '@kovojs/server/internal/escape';
import * as packageInternalExecutionApi from '@kovojs/server/internal/execution';
import * as packageInternalHtmlApi from '@kovojs/server/internal/html';
import * as packageInternalManagedDbCapabilitiesApi from '@kovojs/server/internal/managed-db-capabilities';
import * as packageInternalManagedDbApi from '@kovojs/server/internal/managed-db';
import * as packageInternalPostgresCapabilityApi from '@kovojs/server/internal/postgres-capability';
import * as packageInternalRouteApi from '@kovojs/server/internal/route';
import * as packageInternalStaticExportApi from '@kovojs/server/internal/static-export';
import * as packageInternalWireApi from '@kovojs/server/internal/wire';
import serverPackage from '../../package.json' with { type: 'json' };
import * as agentApi from '../agent.js';
import * as appApi from '../app.js';
import * as appGuardsApi from '../app-guards.js';
import { isKovoApp as isKovoAppToken, resolveKovoAppToken } from '../app-token.js';
import * as writeGovernanceApi from '../write-governance.js';
import * as confidentialAtRestApi from '../confidential-at-rest.js';
import * as capabilityUrlApi from '../capability-url.js';
import * as capabilityRouteApi from '../capability-route.js';
import * as commandApi from '../command.js';
import * as egressApi from '../egress.js';
import * as egressBootstrapApi from '../egress-bootstrap.js';
import * as egressCredentialsApi from '../egress-credentials.js';
import * as envApi from '../env.js';
import * as fileApi from '../file.js';
import * as keyringApi from '../keyring.js';
import * as managedDbApi from '../managed-db.js';
import * as sqlSafeHandleApi from '../sql-safe-handle.js';
import * as passwordApi from '../password.js';
import * as postgresRuntimeApi from '../postgres-runtime.js';
import * as principalEpochApi from '../principal-epoch.js';
import * as componentRenderApi from '../component-render.js';
import * as cspApi from '../csp.js';
import * as deferredStreamApi from '../deferred-stream.js';
import * as delegationApi from '../delegation.js';
import * as publicApi from '../index.js';
import * as requestHandlerApi from '../request-handler.js';
import * as internalClientModulesApi from '../internal/client-modules.js';
import * as internalAuditFactsApi from '../internal/audit-facts.js';
import * as internalCapabilitiesApi from '../internal/capabilities.js';
import * as internalCspApi from '../internal/csp.js';
import * as internalCsrfApi from '../internal/csrf.js';
import * as internalEgressApi from '../internal/egress.js';
import * as internalEscapeApi from '../internal/escape.js';
import * as internalExecutionApi from '../internal/execution.js';
import * as internalHtmlApi from '../internal/html.js';
import * as internalManagedDbCapabilitiesApi from '../internal/managed-db-capabilities.js';
import * as internalManagedDbApi from '../internal/managed-db.js';
import * as internalPostgresCapabilityApi from '../internal/postgres-capability.js';
import * as internalRouteApi from '../internal/route.js';
import * as mutationApi from '../mutation.js';
import * as nodeSourceApi from '../node.js';
import * as queryApi from '../query.js';
import * as dataApi from './data.js';
import * as documentCoreApi from '../document-core.js';
import * as documentDiagnosticsApi from '../document-diagnostics.js';
import * as documentStructuredApi from '../document-structured.js';
import * as hintsApi from '../hints.js';
import * as internalStaticExportApi from '../internal/static-export.js';
import * as renderingApi from './rendering.js';
import * as routingApi from './routing.js';
import * as responseApi from '../response.js';
import * as routeApi from '../route.js';
import * as redosApi from '../redos.js';
import * as secretReadBoundaryApi from '../secret-read-boundary.js';
import * as staticExportDiagnosticsApi from '../static-export-diagnostics.js';
import * as staticExportOrchestratorApi from '../static-export-public.js';
import * as staticExportOutputApi from '../static-export-output.js';
import * as staticExportResultApi from '../static-export-result.js';
import * as taskObservabilityApi from '../task-observability.js';
import * as uploadSniffApi from '../upload-sniff.js';
import * as viteApi from '../vite.js';
import * as viteDevApi from '../vite-dev.js';
import * as internalWireApi from '../internal/wire.js';
import * as liveTargetAppAttestationApi from '../live-target-app-attestation.js';
import * as mutationWireApi from '../mutation-wire.js';
import * as wireHtmlApi from '../wire-html.js';

// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppDocumentOptions = import('../index.js').AppDocumentOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppResponseHeaderName = import('@kovojs/server').AppResponseHeaderName;
const rootAppResponseHeaders: import('@kovojs/server').AppResponseHeaders = {
  'Cache-Control': 'private, no-store',
  'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
  Vary: 'Accept-Encoding',
};
void rootAppResponseHeaders;
const rejectedRootAppResponseHeaders: import('@kovojs/server').AppResponseHeaders = {
  // @ts-expect-error SPEC §9.1.1 exposes only the direct structured metadata allowlist.
  'X-Accel-Redirect': '/internal/admin',
};
void rejectedRootAppResponseHeaders;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootKovoPostgresSystemDb =
  // @ts-expect-error SPEC §10.3 keeps framework-system database capabilities out of app APIs.
  import('@kovojs/server').KovoPostgresSystemDb;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootUsePostgresSystemDb =
  // @ts-expect-error SPEC §6.6/§10.3: raw capability consumers are package-internal.
  typeof import('@kovojs/server').usePostgresSystemDb;
// eslint-disable-next-line no-unused-vars -- compile-time egress authority-boundary assertion only.
type RemovedRootDatabaseEgressSocketFactory =
  // @ts-expect-error SPEC §6.6/§10.3: only the framework Postgres adapter may mint this carrier.
  typeof import('@kovojs/server').createDatabaseEgressSocket;
// eslint-disable-next-line no-unused-vars -- compile-time egress authority-boundary assertion only.
type RemovedInternalDatabaseEgressSocketFactory =
  // @ts-expect-error The manifest-declared internal egress API exposes install/credentials, not DB authority.
  typeof import('@kovojs/server/internal/egress').createDatabaseEgressSocket;
// eslint-disable-next-line no-unused-vars -- compile-time authority-boundary assertion only.
type RemovedPublishedEndpointBrowserCredentialWitness =
  // @ts-expect-error SPEC §6.6/§9.1: app-authored modules cannot mint the private witness.
  typeof import('@kovojs/server/internal/execution').pinEndpointBrowserCredentialDelegation;
// eslint-disable-next-line no-unused-vars -- compile-time authority-boundary assertion only.
type RemovedPublishedBetterAuthEndpointWitness =
  // @ts-expect-error SPEC §6.6/§9.1: the generic Better Auth witness constructor is private.
  typeof import('@kovojs/server/internal/execution').frameworkBetterAuthEndpoint;
// eslint-disable-next-line no-unused-vars -- compile-time narrow bridge assertion only.
type InternalBetterAuthMountEndpoint =
  typeof import('@kovojs/server/internal/better-auth').createBetterAuthMountEndpoint;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppErrorShellOptions = import('../index.js').AppErrorShellOptions;
const removedRootLiveTargetRendererOption: import('../index.js').CreateAppOptions = {
  // @ts-expect-error SPEC §9.1/§9.5 makes live-target registry assembly compiler-owned.
  liveTargetRenderers: [],
};
void removedRootLiveTargetRendererOption;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootAppMutationResponseContext =
  // @ts-expect-error SPEC §9.1 forbids an app-authored mutation response switch.
  import('../index.js').AppMutationResponseContext;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootAppMutationResponseOptions =
  // @ts-expect-error SPEC §9.1 makes response selection generated and deterministic.
  import('../index.js').AppMutationResponseOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootAppMutationResponseResolver =
  // @ts-expect-error SPEC §9.1 forbids arbitrary app-authored response callbacks.
  import('../index.js').AppMutationResponseResolver;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootAppRouteRenderContext = import('../index.js').AppRouteRenderContext;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootErrorShellRenderer = import('../index.js').ErrorShellRenderer;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootRequestHandler = import('../index.js').RequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootNodeHandlerOptions = import('../index.js').NodeHandlerOptions;
const fixedNodeOrigin: RootNodeHandlerOptions = { origin: 'https://app.example' };
void fixedNodeOrigin;
const removedDynamicNodeOrigin: RootNodeHandlerOptions = {
  // @ts-expect-error SPEC §9.5: request-derived origin selection is not an adapter authority door.
  origin: (_request: unknown) => 'https://attacker.example',
};
void removedDynamicNodeOrigin;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootNodeRequestHandler = import('../index.js').NodeRequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportOptions = import('../index.js').StaticExportOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportResult = import('../index.js').StaticExportResult;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportDiagnostic = import('../index.js').StaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStaticExportDiagnosticSeverity = import('../index.js').StaticExportDiagnosticSeverity;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootEncryptedAtRest = import('../index.js').EncryptedAtRest;
type RootSigningKeyRing = import('../index.js').SigningKeyRing;

function assertOpaqueSigningRingSurface(opaqueSigningRing: RootSigningKeyRing): void {
  // @ts-expect-error SPEC §6.6: public rings configure roots; they never expose generic signing.
  opaqueSigningRing.sign({ audience: 'attacker', payload: 'payload', purpose: 'attacker' });
  // @ts-expect-error SPEC §6.6: public rings never expose generic verification.
  opaqueSigningRing.verify({
    audience: 'attacker',
    payload: 'payload',
    purpose: 'attacker',
    signature: 'forged',
  });
}
void assertOpaqueSigningRingSurface;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootEncryptAtRestOptions = import('../index.js').EncryptAtRestOptions;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevPluginFactory =
  typeof import('@kovojs/server/internal/app-shell-vite').kovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevIntegrationFactory =
  typeof import('@kovojs/server/internal/app-shell-vite').createKovoAppShellViteDevIntegration;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteCompilerModuleDiagnosticReport =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteCompilerModuleDiagnosticReport;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevIntegration =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteDevIntegration;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevPlugin =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteDevPlugin;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalKovoAppShellViteDevPluginOptions =
  import('@kovojs/server/internal/app-shell-vite').KovoAppShellViteDevPluginOptions;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalMemoryRegistryOptions =
  import('@kovojs/server/internal/client-modules').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleRegistryType =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleStoreType =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleStore;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleInputType =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleInput;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootIsKovoApp = typeof import('@kovojs/server').isKovoApp;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootStylesheet = typeof import('@kovojs/server').stylesheet;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDefer = typeof import('@kovojs/server').Defer;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDeferProps = import('@kovojs/server').DeferProps;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootRegionPriority = import('@kovojs/server').RegionPriority;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootServerRenderable = import('@kovojs/server').ServerRenderable;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentConfig = import('@kovojs/server').DocumentConfig;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentDeclaration = import('@kovojs/server').DocumentDeclaration;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentAuthoringContext = import('@kovojs/server').DocumentAuthoringContext;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentShellAttributes = import('@kovojs/server').DocumentShellAttributes;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDocumentShellAttributeValue = import('@kovojs/server').DocumentShellAttributeValue;
if (false) {
  // @ts-expect-error - SPEC.md §9.5 document customization uses structured primitives, not string templates.
  publicApi.createApp({ document: { template: () => '<html></html>' } });

  // SPEC §5.2.1: the public helper returns a framework-owned registry whose private witness lets
  // createApp safely reuse its closed store; a structurally forged facade still fails at runtime.
  publicApi.createApp({
    clientModules: publicApi.createMemoryVersionedClientModuleRegistry(),
  });

  const closedApp = publicApi.createApp();
  // @ts-expect-error - SPEC.md §9.5 closes the app aggregate after construction.
  closedApp.routes = [];
  // @ts-expect-error - SPEC.md §9.5 closes the app aggregate after construction.
  closedApp.clientModules = publicApi.createMemoryVersionedClientModuleRegistry();
  // @ts-expect-error SPEC §6.6/§9.5: no-schema apps expose no ambient environment keys.
  void closedApp.env.UNDECLARED_OPERATOR_SECRET;

  const appWithEnv = publicApi.createApp({
    env: publicApi.s.object({
      API_TOKEN: publicApi.s.secret(publicApi.s.string()),
      PUBLIC_ORIGIN: publicApi.s.string(),
    }),
    envSource: {
      API_TOKEN: 'sk_live_type_fixture',
      PUBLIC_ORIGIN: 'https://example.test',
      UNDECLARED_OPERATOR_SECRET: 'absent from app.env',
    },
  });
  const configSecret: SecretValue<string> = appWithEnv.env.API_TOKEN;
  const publicOrigin: string = appWithEnv.env.PUBLIC_ORIGIN;
  void configSecret;
  void publicOrigin;

  const appWithSessionAndEnv = publicApi.createApp<
    { userId: string },
    never,
    Request,
    Request & { session: { userId: string } | null },
    { API_TOKEN: SecretValue<string> }
  >({
    env: publicApi.s.object({ API_TOKEN: publicApi.s.secret(publicApi.s.string()) }),
    envSource: { API_TOKEN: 'sk_live_explicit_session_fixture' },
  });
  const sessionAppConfigSecret: SecretValue<string> = appWithSessionAndEnv.env.API_TOKEN;
  void sessionAppConfigSecret;

  // @ts-expect-error SPEC §6.6/§9.5: app.env is a frozen read-only projection.
  appWithEnv.env.PUBLIC_ORIGIN = 'https://attacker.test';
  // @ts-expect-error SPEC §6.6/§9.5: undeclared raw environment keys are absent.
  void appWithEnv.env.UNDECLARED_OPERATOR_SECRET;
}
// SPEC.md §9.5: client-module storage input and the framework-owned registry facade are distinct.
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootCreateMemoryVersionedClientModuleRegistry =
  typeof import('@kovojs/server').createMemoryVersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootMemoryVersionedClientModuleRegistryOptions =
  import('@kovojs/server').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleActiveSnapshot =
  import('@kovojs/server').VersionedClientModuleActiveSnapshot;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleRegistry = import('@kovojs/server').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleStore = import('@kovojs/server').VersionedClientModuleStore;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootVersionedClientModuleInput = import('@kovojs/server').VersionedClientModuleInput;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootCreateElement =
  // @ts-expect-error SPEC §5.2/§9.5: classic JSX ABI stays on @kovojs/server/jsx-runtime, not the root.
  typeof import('@kovojs/server').createElement;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootMeta =
  // @ts-expect-error SPEC §6.4: route metadata is a route definition shape; the root keeps metaFromQuery only.
  typeof import('@kovojs/server').meta;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootGuardFailure =
  // @ts-expect-error SPEC §6.5: GuardDenial is the app-facing guard rejection type.
  import('@kovojs/server').GuardFailure;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootEndpointReason =
  // @ts-expect-error SPEC §9.1: endpoint definitions require a `reason` field, not an exported reason alias.
  import('@kovojs/server').EndpointReason;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootMutationResponseHeaderValue =
  // @ts-expect-error SPEC §9.1: mutation response header aliases are internal; use ResponseHeaderValue.
  import('@kovojs/server').MutationResponseHeaderValue;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootMutationResponseHeaders =
  // @ts-expect-error SPEC §9.1: mutation response header aliases are internal; use ResponseHeaders.
  import('@kovojs/server').MutationResponseHeaders;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootDeferredQueryChunk =
  // @ts-expect-error SPEC §8/§9: deferred stream chunks are framework wire internals.
  import('@kovojs/server').DeferredQueryChunk;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootDeferredFragmentChunk =
  // @ts-expect-error SPEC §8/§9: deferred stream chunks are framework wire internals.
  import('@kovojs/server').DeferredFragmentChunk;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootDeferredStreamChunk =
  // @ts-expect-error SPEC §8/§9: deferred stream chunks are framework wire internals.
  import('@kovojs/server').DeferredStreamChunk;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootDeferredPriority =
  // @ts-expect-error SPEC §8/§9: deferred stream chunk priority is framework wire internal.
  import('@kovojs/server').DeferredPriority;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootCapabilityClaims =
  // @ts-expect-error SPEC §6.6: raw capability signing claims live on an internal subpath.
  import('@kovojs/server').CapabilityClaims;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootTrustedAssignFact =
  // @ts-expect-error SPEC §6.6: audit-fact accumulator payloads are CLI/internal plumbing.
  import('@kovojs/server').TrustedAssignFact;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootUnverifiedMimeFact =
  // @ts-expect-error SPEC §6.6: upload audit facts are internal audit plumbing.
  import('@kovojs/server').UnverifiedMimeFact;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootUnsafeRegexFact =
  // @ts-expect-error SPEC §6.6: ReDoS audit facts are internal audit plumbing.
  import('@kovojs/server').UnsafeRegexFact;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootContentSecurityPolicyOptions =
  // @ts-expect-error SPEC §6.6/§9.5: CSP render helpers are internal render plumbing.
  import('@kovojs/server').ContentSecurityPolicyOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootEgressFloorInstall =
  // @ts-expect-error SPEC §6.6: egress floor bootstrap handles are internal runtime plumbing.
  import('@kovojs/server').EgressFloorInstall;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootCredentialProvider =
  // @ts-expect-error SPEC §6.6: cloud metadata credential frames live on the internal egress subpath.
  import('@kovojs/server').CredentialProvider;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootDeclaredSecretReadCapability = import('@kovojs/server').DeclaredSecretReadCapability;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootPostgresRlsSilentDenyDiagnostic =
  // @ts-expect-error SPEC §10.3: Postgres runtime diagnostic facts are internal adapter plumbing.
  import('@kovojs/server').PostgresRlsSilentDenyDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedRootPostgresPostureCheckOptOutFact =
  // @ts-expect-error SPEC §10.3: Postgres runtime opt-out facts are internal audit plumbing.
  import('@kovojs/server').PostgresPostureCheckOptOutFact;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalCapabilityClaims = import('@kovojs/server/internal/capabilities').CapabilityClaims;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootCapabilityMethod = import('@kovojs/server').CapabilityMethod;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootCapabilityReplayStore = import('@kovojs/server').CapabilityReplayStore;
// eslint-disable-next-line no-unused-vars -- compile-time public-boundary assertion only.
type RootCspInlineMetadata = import('@kovojs/server').CspInlineMetadata;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalTrustedAssignFact = import('@kovojs/server/internal/audit-facts').TrustedAssignFact;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalContentSecurityPolicyOptions =
  import('@kovojs/server/internal/csp').ContentSecurityPolicyOptions;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalEgressFloorInstall = import('@kovojs/server/internal/egress').EgressFloorInstall;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalDeclaredSecretReadCapability =
  import('@kovojs/server/internal/managed-db').DeclaredSecretReadCapability;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedCreateApp =
  // @ts-expect-error SPEC.md §9.5: createApp now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').createApp;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedCreateRequestHandler =
  // @ts-expect-error SPEC.md §9.5: createRequestHandler now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').createRequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedIsKovoApp =
  // @ts-expect-error SPEC.md §9.5: the dynamic app guard now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').isKovoApp;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedLayout =
  // @ts-expect-error SPEC.md §9.5: layout now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').layout;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedRespond =
  // @ts-expect-error SPEC.md §9.5: respond now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').respond;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedRoute =
  // @ts-expect-error SPEC.md §9.5: route now has the root @kovojs/server
  // canonical home, not the app-shell/core subpath.
  typeof import('./app-shell/core.js').route;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedCreateMemoryVersionedClientModuleRegistry =
  // @ts-expect-error SPEC.md §9.5: memory client-module registry construction now
  // has the root @kovojs/server canonical home.
  typeof import('./app-shell/client-modules.js').createMemoryVersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedToNodeHandler =
  // @ts-expect-error SPEC.md §9.5: toNodeHandler now has the root
  // @kovojs/server canonical home.
  typeof import('./app-shell/node.js').toNodeHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedExportStaticApp =
  // @ts-expect-error SPEC.md §9.5: exportStaticApp now has the root
  // @kovojs/server canonical home.
  typeof import('./app-shell/static-export.js').exportStaticApp;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppDocumentOptions =
  // @ts-expect-error SPEC.md §9.5: app document options now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppDocumentOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppErrorShellOptions =
  // @ts-expect-error SPEC.md §9.5: app error shell options now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppErrorShellOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppMutationResponseContext =
  // @ts-expect-error SPEC.md §9.5: mutation response context now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppMutationResponseContext;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppMutationResponseOptions =
  // @ts-expect-error SPEC.md §9.5: mutation response options now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppMutationResponseOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppMutationResponseResolver =
  // @ts-expect-error SPEC.md §9.5: mutation response resolvers now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppMutationResponseResolver;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedAppRouteRenderContext =
  // @ts-expect-error SPEC.md §9.5: route render context now has the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').AppRouteRenderContext;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedErrorShellRenderer =
  // @ts-expect-error SPEC.md §9.5: error shell renderers now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').ErrorShellRenderer;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedRequestHandler =
  // @ts-expect-error SPEC.md §9.5: request-handler types now have the root
  // @kovojs/server canonical home, not the app-shell/core subpath.
  import('./app-shell/core.js').RequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedMemoryRegistryOptions =
  // @ts-expect-error SPEC.md §9.5: versioned client-module registry option types
  // now have the root @kovojs/server canonical home.
  import('./app-shell/client-modules.js').MemoryVersionedClientModuleRegistryOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleRegistry =
  // @ts-expect-error SPEC.md §9.5: versioned client-module registry types now have
  // the root @kovojs/server canonical home.
  import('./app-shell/client-modules.js').VersionedClientModuleRegistry;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleInput =
  // @ts-expect-error SPEC.md §9.5: versioned client-module input types now have
  // the root @kovojs/server canonical home.
  import('./app-shell/client-modules.js').VersionedClientModuleInput;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleRequest =
  // @ts-expect-error SPEC.md §9.5: client-module request helpers are framework
  // support internals, not public app-shell/client-modules API.
  import('./app-shell/client-modules.js').VersionedClientModuleRequest;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedVersionedClientModuleResponse =
  // @ts-expect-error SPEC.md §9.5: client-module response helpers are framework
  // support internals, not public app-shell/client-modules API.
  import('./app-shell/client-modules.js').VersionedClientModuleResponse;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleRequest =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleRequest;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalVersionedClientModuleResponse =
  import('@kovojs/server/internal/client-modules').VersionedClientModuleResponse;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalRenderMutationCsrfField =
  typeof import('@kovojs/server/internal/csrf').renderMutationCsrfField;
// eslint-disable-next-line no-unused-vars -- compile-time internal test/bootstrap boundary.
type InternalCsrfToken = typeof import('@kovojs/server/internal/csrf').csrfToken;
// eslint-disable-next-line no-unused-vars -- compile-time internal test/bootstrap boundary.
type InternalCsrfField = typeof import('@kovojs/server/internal/csrf').csrfField;
// eslint-disable-next-line no-unused-vars -- compile-time compiler-only boundary assertion.
type InternalRenderGeneratedMutationFormFields =
  typeof import('@kovojs/server/internal/csrf').renderGeneratedMutationFormFields;
// eslint-disable-next-line no-unused-vars -- compile-time internal-boundary assertion only.
type InternalFrameworkCsrfRequestSnapshot =
  typeof import('@kovojs/server/internal/csrf').frameworkCsrfRequestSnapshot;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedNodeHandlerOptions =
  // @ts-expect-error SPEC.md §9.5: Node adapter companion types now have the root
  // @kovojs/server canonical home.
  import('./app-shell/node.js').NodeHandlerOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedNodeRequestHandler =
  // @ts-expect-error SPEC.md §9.5: Node request handler types now have the root
  // @kovojs/server canonical home.
  import('./app-shell/node.js').NodeRequestHandler;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportOptions =
  // @ts-expect-error SPEC.md §9.5: static-export result/config types now have the
  // root @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportOptions;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportResult =
  // @ts-expect-error SPEC.md §9.5: static-export result/config types now have the
  // root @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportResult;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnostic =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostics now have the root
  // @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticSeverity =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostics now have the root
  // @kovojs/server canonical home.
  import('./app-shell/static-export.js').StaticExportDiagnosticSeverity;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportManifestHelper =
  // @ts-expect-error SPEC.md §9.5: static-export manifest helpers are framework
  // export-task internals, not public app-shell/static-export helpers.
  typeof import('./app-shell/static-export.js').staticExportManifest;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportInventoryHelper =
  // @ts-expect-error SPEC.md §9.5: static-export inventory helpers are framework
  // export-task internals, not public app-shell/static-export helpers.
  typeof import('./app-shell/static-export.js').staticExportInventory;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportOutputPlanHelper =
  // @ts-expect-error SPEC.md §9.5: static-export output planning is framework
  // export-task plumbing, not a public app-shell/static-export helper.
  typeof import('./app-shell/static-export.js').staticExportOutputPlan;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportManifestAssertion =
  // @ts-expect-error SPEC.md §9.5: static-export manifest assertions stay behind
  // an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').assertStaticExportManifestMatchesResult;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDirectoryIndexAssertion =
  // @ts-expect-error SPEC.md §9.5: static-export manifest assertions stay behind
  // an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').assertStaticExportManifestUsesDirectoryIndexDocuments;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticFormatter =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic rendering is framework
  // tooling support, not a public app-shell/static-export helper.
  typeof import('./app-shell/static-export.js').formatStaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticsFormatter =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic rendering is framework
  // tooling support, not a public app-shell/static-export helper.
  typeof import('./app-shell/static-export.js').formatStaticExportDiagnostics;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticGuard =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic shape guards stay
  // behind an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').isStaticExportDiagnostic;
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedStaticExportDiagnosticErrorGuard =
  // @ts-expect-error SPEC.md §9.5: static-export diagnostic shape guards stay
  // behind an internal server export-task subpath.
  typeof import('./app-shell/static-export.js').isStaticExportDiagnosticError;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedFocusedWriteWebResponseToNodeOptions =
  // @ts-expect-error SPEC.md §9.5: raw Node response writer options stay inside the node adapter
  // implementation; public app-shell/node consumers receive only the closed adapter entrypoint.
  import('./app-shell/node.js').WriteWebResponseToNodeOptions;

// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedViteDevPluginFactory =
  // @ts-expect-error SPEC.md §9.5: Vite build/export replay helpers moved behind
  // `kovo export --vite`; the former public subpath is removed.
  typeof import('@kovojs/server/app-shell/vite');

function aggregateValueKeys(...modules: readonly Record<string, unknown>[]): string[] {
  return [...new Set(modules.flatMap((module) => Object.keys(module)))].sort();
}

function moduleValueKeys(module: Record<string, unknown>): string[] {
  return Object.keys(module).sort();
}

describe('server app-shell public API barrels', () => {
  it('keeps the root focused on ordinary app declaration', () => {
    const expectedRootValues = [
      'BodyAttrs',
      'BodyEnd',
      'BodyStart',
      'CreateAppBootError',
      'Defer',
      'Document',
      'FontPreload',
      'Head',
      'HtmlAttrs',
      'InlineScript',
      'InlineStyle',
      'Meta',
      'ModulePreload',
      'SchemaValidationError',
      'StaleVersionError',
      'StylesheetLink',
      'defineKovo',
      'domain',
      'endpoint',
      'errorBoundary',
      'guard',
      'guards',
      'i18n',
      'isCreateAppBootError',
      'layout',
      'metaFromQuery',
      'mutation',
      'mutationFormAttributes',
      'notFound',
      'publicAccess',
      'query',
      'queue',
      'respond',
      'route',
      's',
      'safeRichHtml',
      'session',
      'stream',
      'stylesheet',
      't',
      'tag',
      'unsafeInline',
      'verifiedAccess',
    ];

    expect(moduleValueKeys(publicApi)).toEqual(expectedRootValues);
    expect(moduleValueKeys(packageRootApi)).toEqual(expectedRootValues);
    expect(publicApi.defineKovo).toBe(packageRootApi.defineKovo);
    expect(publicApi.route).toBe(routeApi.route);
    expect(publicApi.layout).toBe(routeApi.layout);
    expect(publicApi.respond).toBe(responseApi.respond);
    expect(publicApi.stylesheet).toBe(hintsApi.stylesheet);
    expect(Object.keys(staticExportOrchestratorApi).sort()).toEqual(['exportStaticApp']);

    for (const moved of [
      'agent',
      'createApp',
      'createPostgresAppRuntimeDb',
      'createRequestHandler',
      'exportStaticApp',
      'isKovoApp',
      'task',
      'toNodeHandler',
      'webhook',
      'webhookReplayIdentity',
    ]) {
      expect(publicApi).not.toHaveProperty(moved);
      expect(packageRootApi).not.toHaveProperty(moved);
    }
    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./app-shell');
  });

  it('exposes path-first webhook authoring through public routing barrels', () => {
    const replayIdentity = routingApi.webhookReplayIdentity('evt_public', Date.now());
    const taskWebhook = routingApi.webhook('/webhooks/public-order-paid', {
      handler: () => undefined,
      input: publicApi.s.object({ id: publicApi.s.string() }),
      verify: 'none',
      verifyJustification: 'public API fixture',
    });
    const routingWebhook = routingApi.webhook('/webhooks/routing-order-paid', {
      handler: () => undefined,
      input: dataApi.s.object({ id: dataApi.s.string() }),
      verify: 'none',
      verifyJustification: 'public API fixture',
    });
    const removedOptionsPath = () =>
      routingApi.webhook('/webhooks/public-path-first-only', {
        handler: () => undefined,
        input: publicApi.s.object({ id: publicApi.s.string() }),
        // @ts-expect-error Phase 1 path-first API removed public options.path.
        path: '/webhooks/legacy-options-path',
        verify: 'none',
        verifyJustification: 'compile-time fixture only',
      });

    expect(taskWebhook.name).toBe('/webhooks/public-order-paid');
    expect(taskWebhook.path).toBe('/webhooks/public-order-paid');
    expect(taskWebhook.reason).toBe('webhook:/webhooks/public-order-paid');
    expect(replayIdentity).toMatchObject({
      key: 'evt_public',
      occurredAtMs: expect.any(Number),
      expiresAtMs: expect.any(Number),
    });
    expect(routingWebhook.name).toBe('/webhooks/routing-order-paid');
    expect(publicApi).not.toHaveProperty('webhook');
    expect(publicApi).not.toHaveProperty('webhookReplayIdentity');
    expect(removedOptionsPath).toBeTypeOf('function');
  });

  it('exposes the split app-shell package subpaths for R5/R6/R7 consumers', () => {
    // SPEC.md §9.5 keeps request-shell extension points declared and printable; the public
    // app-shell subpaths stay focused so Vite, static export, and outside adoption paths do not
    // regain an aggregate compatibility surface by accident.
    expect(moduleValueKeys(packageInternalClientModulesApi)).toEqual([
      // D1/DEPLOY-3: the render-plan fingerprint folds in grammar + query-shape facts and remains
      // separate from the app-build token derived by the registry facade.
      'RENDER_PLAN_GRAMMAR_VERSION',
      'commitVersionedClientModuleStaging',
      'computeRenderPlanFingerprint',
      'createMemoryVersionedClientModuleRegistry',
      'createMemoryVersionedClientModuleStore',
      'finalizeVersionedClientModuleBuild',
      'isVersionedClientModuleBuildSealed',
      'renderVersionedClientModuleResponse',
      'replaceVersionedClientModuleBuildSnapshot',
      'snapshotVersionedClientModuleRegistry',
      'versionedClientModuleHref',
    ]);
    // A2: the per-submit Kovo-Idem hidden field is minted/rendered through the internal csrf subpath.
    expect(moduleValueKeys(packageInternalCsrfApi)).toEqual([
      'KOVO_IDEM_FIELD_NAME',
      'csrfField',
      'csrfToken',
      'frameworkCsrfRequestSnapshot',
      'mintIdemToken',
      'renderGeneratedMutationFormFields',
      'renderMutationCsrfField',
      'renderMutationIdemField',
    ]);
    expect(packageInternalCsrfApi).toEqual(internalCsrfApi);
    expect(moduleValueKeys(packageInternalEscapeApi)).toEqual([
      'escapeAttribute',
      'escapeHtml',
      'escapeScriptJson',
      'escapeText',
      'kovoSafeJsxSpread',
      'safeUrlAttribute',
    ]);
    expect(packageInternalEscapeApi).toEqual(internalEscapeApi);
    expect(moduleValueKeys(packageInternalExecutionApi)).toEqual([
      // The CLI's exact build graph consumes the same pinned access/guard classifiers through the
      // platform-neutral internal execution subpath (SPEC §6.6/§10.2). Managed DB composition is
      // isolated on internal/managed-db so generated registry imports cannot retain Node VM.
      'accessDecisionFor',
      'accessFactsFromApp',
      'appEgressPosture',
      'appendFrameworkRuntimeArrayValue',
      'authorizationCorrespondenceFactsFromApp',
      'createMemoryMutationReplayStore',
      'createRuntimeAttestationVerificationHandle',
      'createSecurityEventRecordVerifier',
      'endpointMatches',
      'escapeCensusReviewPayload',
      'escapeObligationReviewPayload',
      'explainGuard',
      'exportSecurityEvents',
      'extractCompilerBoundKovoRuntimeDbMetadata',
      'guardAuditName',
      'installGeneratedTableSecurityManifestForCommand',
      'invalidate',
      'registerGeneratedBrowserPostureManifest',
      'registerGeneratedCacheInfluenceManifest',
      'registerGeneratedMutationTouchRegistry',
      'registerGeneratedQueryReadRegistry',
      'registerGeneratedRuntimePostureManifest',
      'registerGeneratedTableSecurityManifest',
      'registeredGeneratedTableSecurityManifest',
      'registeredRuntimePostureManifest',
      'resolveLifecycleRequest',
      'runEndpoint',
      'runMutation',
      'runQuery',
      'runRoutePage',
      'runtimeAttestationPayloadSource',
      'snapshotEscapeCensusReviewSubject',
      'verifyEscapeCensusReviewEnvelope',
      'verifyEscapeCensusReviewSet',
      'verifyEscapeObligationReviewEnvelope',
    ]);
    expect(packageInternalExecutionApi).not.toHaveProperty('managedDb');
    expect(packageInternalExecutionApi).not.toHaveProperty(
      'pinEndpointBrowserCredentialDelegation',
    );
    expect(packageInternalExecutionApi).not.toHaveProperty(
      'createFrameworkManagedSqlDispatchProxy',
    );
    expect(packageInternalManagedDbApi.managedDb).toBe(managedDbApi.managedDb);
    expect(packageInternalManagedDbApi.readonlyDb).toBe(managedDbApi.readonlyDb);
    expect(packageInternalManagedDbApi.createFrameworkManagedSqlDispatchProxy).toBe(
      sqlSafeHandleApi.createFrameworkManagedSqlDispatchProxy,
    );
    expect(packageInternalExecutionApi).toEqual(internalExecutionApi);
    expect(moduleValueKeys(packageViteApi)).toEqual(['kovo']);
    // The workspace export owns the source-loader boundary; published packages
    // replace it with the built vite.mjs entry. Both must expose the same public
    // plugin contract without requiring function-object identity (SPEC §9.5).
    expect(packageViteApi.kovo).not.toBe(viteApi.kovo);
    expect(packageViteApi.kovo({ app: './src/app.tsx' }).name).toBe('kovo');
    expect(viteApi.kovo({ app: './src/app.tsx' }).name).toBe('kovo');
    expect(serverPackage.exports as Record<string, string>).toMatchObject({
      './generated/db-capabilities': './src/generated-db-capabilities.ts',
      './internal/testing': './src/internal/testing.ts',
      './runtime-bootstrap': './src/runtime-bootstrap.ts',
      './vite': './src/vite-source.ts',
    });
    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./app-shell/vite');
    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty('./testing');

    expect(packageRootApi.defineKovo).toBe(publicApi.defineKovo);
    expect(packageRootApi).not.toHaveProperty('createApp');
    expect(packageRootApi).not.toHaveProperty('createRequestHandler');
    expect(packageRootApi).not.toHaveProperty('exportStaticApp');
    expect(packageRootApi).not.toHaveProperty('isKovoApp');
    expect(packageRootApi.layout).toBe(routeApi.layout);
    expect(packageRootApi.respond).toBe(responseApi.respond);
    expect(packageRootApi.route).toBe(routeApi.route);
    expect(packageRootApi.stylesheet).toBe(hintsApi.stylesheet);
    expect(packageRootApi).not.toHaveProperty('toNodeHandler');
    expect(packageInternalClientModulesApi.renderVersionedClientModuleResponse).toBe(
      internalClientModulesApi.renderVersionedClientModuleResponse,
    );
    expect(packageInternalClientModulesApi.versionedClientModuleHref).toBe(
      internalClientModulesApi.versionedClientModuleHref,
    );
    expect(packageInternalClientModulesApi.createMemoryVersionedClientModuleRegistry).toBe(
      internalClientModulesApi.createMemoryVersionedClientModuleRegistry,
    );
    expect(packageInternalStaticExportApi.staticExportInventory).toBe(
      staticExportResultApi.staticExportInventory,
    );
    expect(packageInternalStaticExportApi.staticExportManifest).toBe(
      staticExportResultApi.staticExportManifest,
    );
    expect(packageInternalStaticExportApi.assertStaticExportManifestMatchesResult).toBe(
      staticExportResultApi.assertStaticExportManifestMatchesResult,
    );
    expect(
      packageInternalStaticExportApi.assertStaticExportManifestUsesDirectoryIndexDocuments,
    ).toBe(staticExportResultApi.assertStaticExportManifestUsesDirectoryIndexDocuments);
    expect(packageInternalStaticExportApi.staticExportOutputPlan).toBe(
      staticExportOutputApi.staticExportOutputPlan,
    );
    expect(packageInternalStaticExportApi.formatStaticExportDiagnostic).toBe(
      staticExportDiagnosticsApi.formatStaticExportDiagnostic,
    );
    expect(packageInternalStaticExportApi.formatStaticExportDiagnostics).toBe(
      staticExportDiagnosticsApi.formatStaticExportDiagnostics,
    );
    expect(packageInternalStaticExportApi.isStaticExportDiagnostic).toBe(
      staticExportDiagnosticsApi.isStaticExportDiagnostic,
    );
    expect(packageInternalStaticExportApi.isStaticExportDiagnosticError).toBe(
      staticExportDiagnosticsApi.isStaticExportDiagnosticError,
    );
    expect(packageInternalStaticExportApi.staticExportManifest).toBe(
      internalStaticExportApi.staticExportManifest,
    );
    const appShellPackageExports = Object.fromEntries(
      Object.entries(serverPackage.exports as Record<string, string>).filter(([subpath]) =>
        subpath.startsWith('./app-shell'),
      ),
    );
    // Phase 9A removed the redundant `./app-shell/static-export` subpath; its 5 types
    // stay public via the root barrel through StaticExportResult/StaticExportOptions.
    expect(appShellPackageExports).toEqual({});
    expect(serverPackage.exports as Record<string, string>).not.toHaveProperty(
      './app-shell/static-export',
    );
    expect(serverPackage.exports as Record<string, string>).toMatchObject({
      './internal/audit-facts': './src/internal/audit-facts.ts',
      './internal/better-auth': './src/internal/better-auth.ts',
      './internal/capabilities': './src/internal/capabilities.ts',
      './internal/client-modules': './src/internal/client-modules.ts',
      './internal/csp': './src/internal/csp.ts',
      './internal/csrf': './src/internal/csrf.ts',
      './internal/egress': './src/internal/egress.ts',
      './internal/escape': './src/internal/escape.ts',
      './internal/execution': './src/internal/execution.ts',
      './internal/managed-db-capabilities': './src/internal/managed-db-capabilities.ts',
      './internal/managed-db': './src/internal/managed-db.ts',
    });
    expect(moduleValueKeys(packageInternalManagedDbCapabilitiesApi)).toEqual([
      'createFrameworkManagedSqlDispatchProxy',
      'kovoDeclaredWriteDbHandle',
      'kovoReadonlyDbHandle',
      'registerFrameworkManagedDbHooks',
    ]);
    expect(packageInternalManagedDbCapabilitiesApi).toEqual(internalManagedDbCapabilitiesApi);
  });

  it('keeps assembled app state behind an exact opaque token', () => {
    const app = publicApi.defineKovo({});
    const token = app.assemble({});

    expect(isKovoAppToken(token)).toBe(true);
    expect(Object.isFrozen(token)).toBe(true);
    expect(Reflect.ownKeys(token)).toEqual([]);
    expect(resolveKovoAppToken(token, 'API topology test')).toMatchObject({
      endpoints: [],
      mutations: [],
      queries: [],
      routes: [],
    });
    expect(isKovoAppToken({ ...token })).toBe(false);
    expect(isKovoAppToken(new Proxy(token, {}))).toBe(false);
    expect(() => resolveKovoAppToken({ ...token }, 'API topology test')).toThrow(
      'requires the exact opaque KovoApp',
    );
  });
});
