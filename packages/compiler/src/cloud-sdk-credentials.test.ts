import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule, deriveAppGraph } from './index.js';

const kv427 = diagnosticDefinitions.KV427;

describe('compiler cloud SDK credential diagnostics', () => {
  it('derives cloud metadata providers from createApp cloud shell config', () => {
    const appShell = compileComponentModule({
      fileName: 'app.ts',
      source: `
import { createApp } from '@kovojs/server';

export const app = createApp({
  cloud: { aws: 'instance-role', gcp: 'metadata' },
});
`,
    });
    const client = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: deriveAppGraph({ components: [appShell] }).registryFacts,
      source: `
import { S3Client } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';

export const s3 = new S3Client({ region: 'us-east-1' });
export const gcs = new Storage({ projectId: 'demo' });
`,
    });

    expect(appShell.cloudMetadataProviders).toEqual(['aws', 'gcp']);
    expect(deriveAppGraph({ components: [appShell] }).registryFacts.cloudMetadataProviders).toEqual(
      ['aws', 'gcp'],
    );
    expect(client.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toHaveLength(2);
  });

  it('reports KV427 for declared cloud SDK clients with no credential option', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['aws', 'gcp', 'azure'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';
import { Storage as GcpStorage } from '@google-cloud/storage';
import * as AzureStorage from '@azure/storage-blob';

export const s3 = new S3Client({ region: 'us-east-1' });
export const gcs = new GcpStorage({ projectId: 'demo' });
export const blob = new AzureStorage.BlobServiceClient(accountUrl);
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV427',
        fileName: 'cloud-clients.ts',
        length: 8,
        message: `${kv427.message} S3Client is imported from @aws-sdk/client-s3; add the declared cloud.aws credential via credentials, credential, authClient, or the provider-specific credential option.`,
        severity: kv427.severity,
        start: { column: 23, line: 6 },
      },
      {
        code: 'KV427',
        fileName: 'cloud-clients.ts',
        length: 10,
        message: `${kv427.message} Storage is imported from @google-cloud/storage; add the declared cloud.gcp credential via credentials, credential, authClient, or the provider-specific credential option.`,
        severity: kv427.severity,
        start: { column: 24, line: 7 },
      },
      {
        code: 'KV427',
        fileName: 'cloud-clients.ts',
        length: 30,
        message: `${kv427.message} BlobServiceClient is imported from @azure/storage-blob; add the declared cloud.azure credential via credentials, credential, authClient, or the provider-specific credential option.`,
        severity: kv427.severity,
        start: { column: 25, line: 8 },
      },
    ]);
  });

  it('does not report KV427 without a matching cloud metadata declaration', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['gcp'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({ region: 'us-east-1' });
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toEqual([]);
  });

  it('accepts explicit credential and provider-specific auth options', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['aws', 'gcp', 'azure'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';
import { BlobServiceClient, QueueClient } from '@azure/storage-blob';

export const s3 = new S3Client({ credentials: cloud.aws, region: 'us-east-1' });
export const gcs = new Storage({ authClient: cloud.gcp });
export const gcsKey = new Storage({ keyFilename: '/var/run/key.json' });
export const blob = new BlobServiceClient(accountUrl, cloud.azure);
export const queue = new QueueClient(queueUrl, { credential: cloud.azure });
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toEqual([]);
  });

  it('reports KV427 when cloud credentials are used without declaring that provider', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['gcp'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({ credentials: cloud.aws, region: 'us-east-1' });
export const gcs = new Storage({ authClient: cloud.gcp });
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toMatchObject([
      {
        code: 'KV427',
        fileName: 'cloud-clients.ts',
        length: 9,
        message: `${kv427.message} cloud.aws is only available when the app shell declares createApp({ cloud: { aws: ... } }). Add the provider declaration or use an explicit non-metadata credential.`,
        severity: kv427.severity,
        start: { column: 47, line: 4 },
      },
    ]);
  });

  it('keeps the gate high-confidence by ignoring local constructor indirection', () => {
    const result = compileComponentModule({
      fileName: 'cloud-clients.ts',
      registryFacts: { cloudMetadataProviders: ['aws'] },
      source: `
import { S3Client } from '@aws-sdk/client-s3';

const Client = S3Client;
export const s3 = new Client({ region: 'us-east-1' });
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV427')).toEqual([]);
  });
});
