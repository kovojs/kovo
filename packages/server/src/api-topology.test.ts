import * as agentApi from '@kovojs/server/agent';
import * as clientModulesApi from '@kovojs/server/client-modules';
import * as commandApi from '@kovojs/server/command';
import * as confidentialApi from '@kovojs/server/confidential';
import * as customAdaptersApi from '@kovojs/server/custom-adapters';
import * as dataApi from '@kovojs/server/data';
import * as delegationApi from '@kovojs/server/delegation';
import * as derivedDataApi from '@kovojs/server/derived-data';
import * as diagnosticsApi from '@kovojs/server/diagnostics';
import * as egressApi from '@kovojs/server/egress';
import * as filesApi from '@kovojs/server/files';
import * as nodeApi from '@kovojs/server/node';
import * as passwordApi from '@kovojs/server/password';
import * as postgresApi from '@kovojs/server/postgres';
import * as principalEpochsApi from '@kovojs/server/principal-epochs';
import * as principalErasureApi from '@kovojs/server/principal-erasure';
import * as renderTreeApi from '@kovojs/server/render-tree';
import * as renderingApi from '@kovojs/server/rendering';
import * as replayApi from '@kovojs/server/replay';
import * as routingApi from '@kovojs/server/routing';
import * as secretReadingApi from '@kovojs/server/secret-reading';
import * as securityApi from '@kovojs/server/security';
import * as serverRoot from '@kovojs/server';
import * as signingApi from '@kovojs/server/signing';
import * as staticExportApi from '@kovojs/server/static-export';
import * as storageDownloadsApi from '@kovojs/server/storage-downloads';
import * as storageKeysApi from '@kovojs/server/storage-keys';
import * as tasksApi from '@kovojs/server/tasks';
import * as webhooksApi from '@kovojs/server/webhooks';
import * as writeSafetyApi from '@kovojs/server/write-safety';
import type { InferKovoAppTypes, KovoApp } from '@kovojs/server/custom-adapters';
import type { AppDbProvider, Reader, Writer } from '@kovojs/server/data';
import type { MutationReplayBody } from '@kovojs/server/replay';
import type { EndpointDefinition } from '@kovojs/server/routing';
import type { FileLike, FileSchema, StoredFileSchema, StoredFileUpload } from '@kovojs/server';
import { describe, expect, expectTypeOf, it } from 'vitest';

const taskValues = [
  agentApi.agent,
  agentApi.agentContent,
  agentApi.createAgentSession,
  agentApi.runAgentTurn,
  agentApi.tool,
  clientModulesApi.createMemoryVersionedClientModuleRegistry,
  commandApi.cmd,
  commandApi.commandAllowlist,
  commandApi.runCommand,
  confidentialApi.createConfidentialAtRestCipher,
  confidentialApi.decryptAtRest,
  confidentialApi.encryptAtRest,
  confidentialApi.rewrapAtRest,
  customAdaptersApi.createRequestHandler,
  dataApi.declarePublicRead,
  dataApi.readonlyDb,
  delegationApi.createDelegationAuthority,
  delegationApi.onBehalfOf,
  derivedDataApi.derived,
  egressApi.EgressBlockedError,
  egressApi.EgressConfigError,
  filesApi.rootedFiles,
  nodeApi.toNodeHandler,
  passwordApi.PASSWORD_ARGON2ID_DEFAULTS,
  passwordApi.hashPassword,
  passwordApi.isArgon2idPasswordDigest,
  passwordApi.verifyCredential,
  passwordApi.verifyPassword,
  postgresApi.checkPostgresAppDbPosture,
  postgresApi.createPostgresAppRuntimeDb,
  postgresApi.declarePublicRelation,
  postgresApi.migratePostgresAppDb,
  postgresApi.planPostgresAppDbMigration,
  postgresApi.postgresAppRuntimeOptions,
  postgresApi.postgresSchemaModule,
  postgresApi.provisionPostgresAppDb,
  principalEpochsApi.PrincipalEpochStaleError,
  principalEpochsApi.PrincipalEpochUnavailableError,
  principalEpochsApi.advancePrincipalEpoch,
  principalEpochsApi.createMemoryPrincipalEpochStore,
  principalEpochsApi.initializePrincipalEpoch,
  principalEpochsApi.tombstonePrincipalEpoch,
  principalErasureApi.PrincipalErasureIncompleteError,
  principalErasureApi.erasePrincipal,
  principalErasureApi.verifyPrincipalErasureReceipt,
  renderTreeApi.ComponentXmlError,
  renderTreeApi.parseComponentXml,
  renderTreeApi.renderRegistry,
  renderTreeApi.renderTree,
  renderingApi.renderRouteHtml,
  replayApi.createMemoryMutationReplayStore,
  replayApi.replayMutationWireBody,
  secretReadingApi.declareSecretReadCapability,
  securityApi.InlineUnverifiedUploadError,
  securityApi.RedosPatternError,
  securityApi.accept,
  securityApi.mintCsrfField,
  securityApi.mintCsrfToken,
  securityApi.unsafeCookie,
  securityApi.unsafeRegex,
  signingApi.createSigningKeyRing,
  staticExportApi.StaticExportError,
  staticExportApi.exportStaticApp,
  storageDownloadsApi.DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  storageDownloadsApi.createStorageDownloadEndpoint,
  storageKeysApi.scopedKey,
  tasksApi.createDurableTaskStatus,
  tasksApi.task,
  webhooksApi.createMemoryWebhookReplayStore,
  webhooksApi.webhook,
  webhooksApi.webhookReplayIdentity,
  writeSafetyApi.serverValue,
  writeSafetyApi.trustedAssign,
] as const;

describe('@kovojs/server public topology', () => {
  it('keeps daily app declaration at root and loads every advanced task path', () => {
    expectTypeOf<InferKovoAppTypes<KovoApp<{ readonly request: Request }>>>().toEqualTypeOf<{
      readonly request: Request;
    }>();
    expectTypeOf<MutationReplayBody>().toMatchTypeOf<string>();
    expectTypeOf<Reader<{ select(): unknown; insert(): unknown }>>().toHaveProperty('select');
    expectTypeOf<Reader<{ select(): unknown; insert(): unknown }>>().not.toHaveProperty('insert');
    expectTypeOf<Writer<{ select(): unknown; insert(): unknown }>>().toHaveProperty('insert');
    expectTypeOf<FileSchema['parseAsync']>().returns.toEqualTypeOf<Promise<FileLike>>();
    expectTypeOf<StoredFileSchema['parseAsync']>().returns.toEqualTypeOf<
      Promise<StoredFileUpload>
    >();
    expectTypeOf<{
      csrf?: true;
      handler(request: Request): Response;
      method: 'POST';
      reason: string;
      response: {
        appOwnedSafety: true;
        body: 'json';
        cache: 'no-store';
      };
    }>().toMatchTypeOf<EndpointDefinition<'POST'>>();
    expectTypeOf<{
      csrf: false;
      csrfJustification: string;
      handler(request: Request): Response;
      method: 'POST';
      reason: string;
      response: {
        appOwnedSafety: true;
        body: 'json';
        cache: 'no-store';
      };
    }>().toMatchTypeOf<EndpointDefinition<'POST'>>();
    expectTypeOf<{
      csrf: false;
      handler(request: Request): Response;
      method: 'POST';
      reason: string;
      response: {
        appOwnedSafety: true;
        body: 'json';
        cache: 'no-store';
      };
    }>().not.toMatchTypeOf<EndpointDefinition<'POST'>>();
    expectTypeOf<postgresApi.KovoPostgresAppRuntimeDb['db']>().toEqualTypeOf<
      AppDbProvider<postgresApi.KovoPostgresRuntimeDb>
    >();
    expect(serverRoot.defineKovo).toBeTypeOf('function');
    expect(serverRoot.route).toBeTypeOf('function');
    expect(serverRoot.mutation).toBeTypeOf('function');
    expect(serverRoot.query).toBeTypeOf('function');
    expect(serverRoot.tag).toBeTypeOf('function');
    expect(taskValues).not.toContain(undefined);

    // Type-only paths still need to resolve as explicit, documented entrypoints.
    expect(diagnosticsApi).toBeTypeOf('object');
    expect(routingApi).toBeTypeOf('object');
  });

  it('does not duplicate advanced authorities or framework carriers at root', () => {
    for (const name of [
      'agent',
      'createPostgresAppRuntimeDb',
      'createRequestHandler',
      'createSigningKeyRing',
      'derived',
      'exportStaticApp',
      'rootedFiles',
      'runCommand',
      'scopedKey',
      'task',
      'toNodeHandler',
      'trustedAssign',
      'webhook',
      'committedSecretWaiver',
      'FrameworkManagedDbProvider',
      'isKovoApp',
      'LiveTargetAttestationAuthority',
    ]) {
      expect(name in serverRoot, name).toBe(false);
    }
  });
});
